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

// ── Platform connections (see INTEGRATIONS.md §4/§14 + CLAUDE.md) ───────────────
const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_ARTIST_ID     = process.env.SPOTIFY_ARTIST_ID || '';
const YOUTUBE_API_KEY       = process.env.YOUTUBE_API_KEY || '';
const YOUTUBE_CHANNEL_ID    = process.env.YOUTUBE_CHANNEL_ID || '';
const YT_OAUTH_CLIENT_ID     = process.env.YT_OAUTH_CLIENT_ID || '';
const YT_OAUTH_CLIENT_SECRET = process.env.YT_OAUTH_CLIENT_SECRET || '';
const YT_OAUTH_REDIRECT_URI  = process.env.YT_OAUTH_REDIRECT_URI || '';
const CONNECT_PAGE_URL       = process.env.CONNECT_PAGE_URL || (APP_ORIGIN + '/connect.html');

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

// Like proxyReq, but for calls WE make (not passing through the inbound request) where we need
// to read + transform the third party's JSON response server-side before replying to the client.
function httpsJSON(opts, bodyStr, cb){
  const r = https.request(opts, pr=>{
    let data=''; pr.on('data',c=>data+=c);
    pr.on('end',()=>{ let parsed; try{ parsed=JSON.parse(data||'{}'); }catch(e){ parsed={raw:data}; }
      cb(null, pr.statusCode, parsed); });
  });
  r.on('error', e=>cb(e));
  if(bodyStr) r.write(bodyStr);
  r.end();
}
function queryParam(req, name){
  try{ return new URL(req.url, 'http://internal').searchParams.get(name); }catch(e){ return null; }
}

// Routes intentionally exempt from the ID-token gate below, rate-limited by IP instead
// since there's no authenticated user identity to key on. Two different reasons feed this
// list — don't conflate them:
//  - PIN routes: exempt because bootstrapping the PIN check itself can't require a login
//    (see the "TEMPORARY" note above currentPinHash()).
//  - Platform-connection routes (Spotify/YouTube/manual-platform): exempt because the whole
//    Connect page was deliberately left open, matching the rest of this dashboard having no
//    access gate since the PIN screen was removed — an explicit product decision by the
//    owner, not an oversight. Spotify/YouTube here only ever return PUBLIC catalog data, but
//    /api/manual-platform/credentials accepts real third-party passwords — it gets the
//    tightest limit of the group for that reason, encrypts them immediately (see
//    ST.manualCreds below), and is never read back in plaintext by any route.
const OPEN_ROUTE_LIMITS = {
  '/api/pin/verify': 8, '/api/pin/change': 8,
  '/api/spotify/artist': 30, '/api/youtube/channel': 30,
  '/api/youtube-analytics/auth': 20, '/api/youtube-analytics/callback': 20,
  '/api/youtube-analytics/status': 60,
  '/api/manual-platform/credentials': 10, '/api/manual-platform/status': 60
};

http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin', APP_ORIGIN);              // CORS locked, not *
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){ res.writeHead(200); res.end(); return; }
  const url = req.url.split('?')[0];

  if(url==='/api/health') return sendJson(res,200,{ok:true});

  if(OPEN_ROUTE_LIMITS.hasOwnProperty(url)){
    if(rateLimited(url+':'+clientIp(req), OPEN_ROUTE_LIMITS[url], 60000))
      return sendJson(res,429,{error:'rate limited'});
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

  // ── Spotify (public data only — the Web API has never exposed real stream counts,
  // to anyone, even the artist) — app-only auth, no user login involved. ──────────
  if(req.method==='GET' && url==='/api/spotify/artist'){
    if(!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET)
      return sendJson(res,503,{error:'Spotify not configured'});
    const artistId = queryParam(req,'id') || SPOTIFY_ARTIST_ID;
    if(!artistId) return sendJson(res,400,{error:'missing artist id'});
    return getSpotifyToken((err,token)=>{
      if(err) return sendJson(res,502,{error:'spotify auth failed'});
      httpsJSON({hostname:'api.spotify.com', path:'/v1/artists/'+encodeURIComponent(artistId),
        method:'GET', headers:{'Authorization':'Bearer '+token}}, null, (err2,status,json)=>{
        if(err2) return sendJson(res,502,{error:err2.message});
        if(status>=400) return sendJson(res,status,{error:'spotify error',detail:json});
        sendJson(res,200,{
          name: json.name,
          followers: json.followers && json.followers.total,
          popularity: json.popularity,
          genres: json.genres
        });
      });
    });
  }

  // ── YouTube public channel stats (Data API v3, API-key only, no login). ─────────
  if(req.method==='GET' && url==='/api/youtube/channel'){
    if(!YOUTUBE_API_KEY) return sendJson(res,503,{error:'YouTube not configured'});
    const channelId = queryParam(req,'id') || YOUTUBE_CHANNEL_ID;
    if(!channelId) return sendJson(res,400,{error:'missing channel id'});
    const qs = 'part=statistics,snippet&id='+encodeURIComponent(channelId)+'&key='+YOUTUBE_API_KEY;
    return httpsJSON({hostname:'www.googleapis.com', path:'/youtube/v3/channels?'+qs, method:'GET'},
      null, (err,status,json)=>{
        if(err) return sendJson(res,502,{error:err.message});
        if(status>=400) return sendJson(res,status,{error:'youtube error',detail:json});
        const item = json.items && json.items[0];
        if(!item) return sendJson(res,404,{error:'channel not found'});
        sendJson(res,200,{
          title: item.snippet.title,
          subscribers: item.statistics.subscriberCount,
          views: item.statistics.viewCount,
          videos: item.statistics.videoCount
        });
      });
  }

  // ── YouTube Analytics (real streams/watch-time/demographics) — genuine OAuth2
  // authorization-code flow. This is the ONE platform in the set where a real per-video
  // analytics API exists and is self-serve, gated only by a one-time consent click from
  // whoever owns Benny's channel. Refresh token is folded into the encrypted ST blob
  // (same AES-256-GCM primitive as the PIN hash) — never returned to the client. ────
  if(req.method==='GET' && url==='/api/youtube-analytics/auth'){
    if(!YT_OAUTH_CLIENT_ID || !YT_OAUTH_REDIRECT_URI)
      return sendJson(res,503,{error:'YouTube Analytics OAuth not configured'});
    const params = new URLSearchParams({
      client_id: YT_OAUTH_CLIENT_ID,
      redirect_uri: YT_OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/yt-analytics.readonly',
      access_type: 'offline',
      prompt: 'consent'
    });
    res.writeHead(302, {Location:'https://accounts.google.com/o/oauth2/v2/auth?'+params.toString()});
    return res.end();
  }

  if(req.method==='GET' && url==='/api/youtube-analytics/callback'){
    const code = queryParam(req,'code');
    if(!code) return redirectToConnect(res,'error');
    const body = new URLSearchParams({
      code, client_id: YT_OAUTH_CLIENT_ID, client_secret: YT_OAUTH_CLIENT_SECRET,
      redirect_uri: YT_OAUTH_REDIRECT_URI, grant_type: 'authorization_code'
    }).toString();
    return httpsJSON({hostname:'oauth2.googleapis.com', path:'/token', method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},
      body, (err,status,json)=>{
        if(err || !json.refresh_token) return redirectToConnect(res,'error');
        ST.youtubeAnalytics = { refreshToken: json.refresh_token, connectedAt: Date.now() };
        saveST(ST);
        redirectToConnect(res,'connected');
      });
  }

  if(req.method==='GET' && url==='/api/youtube-analytics/status')
    return sendJson(res,200,{connected: !!(ST.youtubeAnalytics && ST.youtubeAnalytics.refreshToken)});

  // ── Manual platforms (24Six, Zing, Naki) — no public API for any of the three, but
  // all three have real artist-portal dashboards. This captures real login credentials,
  // encrypted at rest immediately, as Phase 1 prep for a future scheduled Playwright
  // scrape (INTEGRATIONS.md §7/§8) — Phase 2 (the scrape itself) is not built yet, so
  // nothing reads these credentials back out today. Never echoed, logged, or cached
  // outside this one encrypted blob. ──────────────────────────────────────────────
  const MANUAL_CODES = ['24','ZG','NK'];
  if(req.method==='POST' && url==='/api/manual-platform/credentials'){
    return readJsonBody(req,(err,body)=>{
      if(err) return sendJson(res,400,{error:'bad json'});
      const code = String(body.code||'');
      const username = String(body.username||'');
      const password = String(body.password||'');
      if(MANUAL_CODES.indexOf(code)===-1) return sendJson(res,400,{error:'unknown platform code'});
      if(!username || !password) return sendJson(res,400,{error:'username and password required'});
      ST.manualCreds = ST.manualCreds || {};
      ST.manualCreds[code] = { username, password, savedAt: Date.now() };
      saveST(ST);
      sendJson(res,200,{ok:true});
    });
  }

  if(req.method==='GET' && url==='/api/manual-platform/status'){
    const mc = ST.manualCreds || {};
    const out = {};
    MANUAL_CODES.forEach(c=>{ out[c] = !!(mc[c] && mc[c].username); });
    return sendJson(res,200,out);
  }

  res.writeHead(404); res.end();
}

// Client Credentials flow (app-only, no user login) — token is cached in memory until
// shortly before it expires. Public artist metadata doesn't need per-user consent.
let spotifyToken = null;
function getSpotifyToken(cb){
  if(spotifyToken && Date.now() < spotifyToken.exp) return cb(null, spotifyToken.token);
  const auth = Buffer.from(SPOTIFY_CLIENT_ID+':'+SPOTIFY_CLIENT_SECRET).toString('base64');
  const body = 'grant_type=client_credentials';
  httpsJSON({hostname:'accounts.spotify.com', path:'/api/token', method:'POST',
    headers:{'Authorization':'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded',
      'Content-Length':Buffer.byteLength(body)}}, body, (err,status,json)=>{
    if(err || !json.access_token) return cb(err || new Error('spotify auth failed'));
    spotifyToken = { token: json.access_token, exp: Date.now() + (json.expires_in-60)*1000 };
    cb(null, spotifyToken.token);
  });
}

function redirectToConnect(res, flag){
  res.writeHead(302, {Location: CONNECT_PAGE_URL + '?yt_analytics=' + flag});
  res.end();
}
