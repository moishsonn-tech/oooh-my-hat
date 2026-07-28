// Zero-dependency Node proxy. Holds secrets server-side, gates /api/* behind verified
// auth, encrypts sensitive state at rest. Run behind nginx+TLS via pm2. See SETUP.md.
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Secrets: from env or a 0600 file — NEVER hardcode in a committed file ────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || '';
const APP_ORIGIN    = process.env.APP_ORIGIN || 'https://app.your-domain.com'; // lock CORS to this
const STATE_FILE    = process.env.STATE_FILE || '/var/www/state.json';
const STATE_KEY_FILE= process.env.STATE_KEY_FILE || '/var/www/.state-key';

// ── Encryption at rest (AES-256-GCM) for any sensitive tokens we persist ─────────
// Self-heals its own directory so this works whether STATE_FILE points at a droplet
// path, a relative ./data path, or a host's ephemeral disk (Render's free tier resets
// this on every redeploy — known/accepted tradeoff, see CLAUDE.md deploy notes).
function ensureStateDir(){
  try{ fs.mkdirSync(path.dirname(STATE_FILE), {recursive:true}); }catch(e){}
}
function getStateKey(){
  try{ if(fs.existsSync(STATE_KEY_FILE)){ const k=fs.readFileSync(STATE_KEY_FILE,'utf8').trim();
    if(k.length>=64) return Buffer.from(k.slice(0,64),'hex'); } }catch(e){}
  const nk=crypto.randomBytes(32);
  ensureStateDir();
  try{ fs.writeFileSync(STATE_KEY_FILE, nk.toString('hex'), {mode:0o600}); }catch(e){}
  return nk;
}
const STATE_K = getStateKey();
function loadST(){ try{ const j=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));
  if(j&&j.__enc===1){ const d=crypto.createDecipheriv('aes-256-gcm',STATE_K,Buffer.from(j.iv,'hex'));
    d.setAuthTag(Buffer.from(j.tag,'hex'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(j.ct,'hex')),d.final()]).toString('utf8')); }
  return j; }catch(e){ return {}; } }
function saveST(s){ try{ const iv=crypto.randomBytes(12);
  const e=crypto.createCipheriv('aes-256-gcm',STATE_K,iv);
  const ct=Buffer.concat([e.update(JSON.stringify(s),'utf8'),e.final()]);
  ensureStateDir();
  fs.writeFileSync(STATE_FILE,JSON.stringify({__enc:1,iv:iv.toString('hex'),
    ct:ct.toString('hex'),tag:e.getAuthTag().toString('hex')})); }catch(e){} }
let ST = loadST();

// ── Verify an identity-provider ID token (replace with your IdP specifics) ───────
// Pattern: RS256 verify against the provider's public certs; check iss/aud/exp/iat;
// restrict to an allowed email domain; mark admins from an allowlist.
const ADMIN_EMAILS = ['<benny@REPLACE_ME.example>'];
function verifyIdToken(token, cb){
  if(!token) return cb('no token');
  // TODO: real RS256 verification vs your IdP's JWKS + iss/aud/exp checks.
  // Reference implementation: see the Firebase ID-token verifier pattern.
  return cb('verifyIdToken not configured');
}

// ── Per-token rate limiting (simple sliding window) ─────────────────────────────
const RL = new Map();
function rateLimited(key, max=60, windowMs=60000){
  const now=Date.now(); const a=(RL.get(key)||[]).filter(t=>now-t<windowMs);
  a.push(now); RL.set(key,a); return a.length>max;
}
function clientIp(req){
  return (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

// ── Dashboard access PIN ──────────────────────────────────────────────────────
// The PIN gate on the frontend is convenience only (per CLAUDE.md: never trust the
// client) — this is the real check. The PIN itself is hashed at rest (scrypt), never
// stored or returned in plaintext.
//
// TEMPORARY, AT THE OWNER'S EXPLICIT REQUEST: /api/pin/change is open to anyone right
// now, with no identity check, while this project is still local scaffolding — not yet
// deployed anywhere real. LAUNCH BLOCKER: before this app is public-facing (especially
// once it's live on a bennyfriedman.com subdomain), gate /api/pin/change behind
// verifyIdToken() + ADMIN_EMAILS above (Google Identity Services — see INTEGRATIONS.md
// §4) so only Benny's verified email can change it. Running /harden should catch this
// if it's ever forgotten.
const PIN_SALT = process.env.PIN_SALT || 'change-me-this-is-a-placeholder-salt';
function hashPin(pin){ return crypto.scryptSync(String(pin), PIN_SALT, 32).toString('hex'); }
function currentPinHash(){
  if (ST.pinHash) return ST.pinHash;
  ST.pinHash = hashPin(process.env.DEFAULT_PIN || '234');
  saveST(ST);
  return ST.pinHash;
}

function sendJson(res, code, obj){
  res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':APP_ORIGIN});
  res.end(JSON.stringify(obj));
}
function proxyReq(req, res, host, path, hdrs){
  let body=''; req.on('data',c=>body+=c);
  req.on('end',()=>{ const opts={hostname:host,path,method:req.method,
    headers:Object.assign({'Content-Type':'application/json'},hdrs)};
    if(body) opts.headers['Content-Length']=Buffer.byteLength(body);
    https.request(opts,pr=>{ res.writeHead(pr.statusCode,
      {'Content-Type':'application/json','Access-Control-Allow-Origin':APP_ORIGIN}); pr.pipe(res); })
      .on('error',e=>{res.writeHead(500);res.end(JSON.stringify({error:e.message}));}).end(body||undefined);
  });
}

http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin', APP_ORIGIN);              // CORS locked, not *
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){ res.writeHead(200); res.end(); return; }
  const url = req.url.split('?')[0];

  if(url==='/api/health') return sendJson(res,200,{ok:true});

  // PIN routes are intentionally exempt from the ID-token gate below — see the
  // "TEMPORARY" note above currentPinHash(). Still rate-limited by IP since there's
  // no authenticated user identity to key on yet.
  if(url==='/api/pin/verify' || url==='/api/pin/change'){
    if(rateLimited('pin:'+clientIp(req), 8, 60000)) return sendJson(res,429,{error:'rate limited'});
    return route(req,res,url);
  }

  // Gate every other /api/* route behind a verified ID token.
  if(url.indexOf('/api/')===0){
    const m=(req.headers['authorization']||'').match(/^Bearer\s+(.+)$/i);
    return verifyIdToken(m?m[1]:null,(err,user)=>{
      if(err) return sendJson(res,401,{error:'unauthorized',detail:err});
      if(rateLimited(user.uid)) return sendJson(res,429,{error:'rate limited'});
      req._user=user; route(req,res,url);
    });
  }
  res.writeHead(404); res.end();
}).listen(process.env.PORT || 3001,()=>console.log('proxy :'+(process.env.PORT||3001)+' | CORS '+APP_ORIGIN));

function readJsonBody(req, cb){
  let body=''; req.on('data',c=>body+=c);
  req.on('end',()=>{
    try{ cb(null, JSON.parse(body||'{}')); }catch(e){ cb(e); }
  });
}

function route(req,res,url){
  if(req.method==='POST' && url==='/api/claude')
    return proxyReq(req,res,'api.anthropic.com','/v1/messages',
      {'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'});

  if(req.method==='POST' && url==='/api/pin/verify'){
    return readJsonBody(req,(err,body)=>{
      if(err) return sendJson(res,400,{error:'bad json'});
      const pin = String(body.pin||'');
      const ok = /^\d{3,6}$/.test(pin) && hashPin(pin) === currentPinHash();
      sendJson(res,200,{ok});
    });
  }

  if(req.method==='POST' && url==='/api/pin/change'){
    return readJsonBody(req,(err,body)=>{
      if(err) return sendJson(res,400,{error:'bad json'});
      const pin = String(body.newPin||'');
      if(!/^\d{3,6}$/.test(pin)) return sendJson(res,400,{error:'PIN must be 3-6 digits'});
      ST.pinHash = hashPin(pin); saveST(ST);
      sendJson(res,200,{ok:true});
    });
  }

  res.writeHead(404); res.end();
}
