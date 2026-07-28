// Deploy the backend: SFTP backend/proxy.js to the server, then restart pm2.
// GATED: backend deploys touch live secrets/auth — run intentionally, per-time.
// npm i ssh2-sftp-client ssh2
const Client = require('ssh2-sftp-client');
const { Client: SSH } = require('ssh2');
const env = require('dotenv').config({ path: __dirname + '/../.env' }).parsed || process.env;

const LOCAL  = __dirname + '/../backend/proxy.js';
const REMOTE = env.REMOTE_PROXY_PATH || '/var/www/proxy.js';
const sftp = new Client();

sftp.connect({ host: env.DEPLOY_HOST, username: env.DEPLOY_USER, password: env.DEPLOY_PASS })
  .then(() => sftp.fastPut(LOCAL, REMOTE))
  .then(() => sftp.end())
  .then(() => new Promise((resolve, reject) => {
    const c = new SSH();
    c.on('ready', () => c.exec('pm2 restart proxy', (err, stream) => {
      if (err) return reject(err);
      stream.on('close', () => { c.end(); resolve(); }).on('data', d => process.stdout.write(d));
    })).on('error', reject)
      .connect({ host: env.DEPLOY_HOST, username: env.DEPLOY_USER, password: env.DEPLOY_PASS });
  }))
  .then(() => console.log('deployed proxy ->', REMOTE, '+ pm2 restart'))
  .catch(e => { console.error('deploy failed:', e.message); process.exit(1); });
