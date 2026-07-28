// Deploy the frontend: SFTP frontend/index.html to the static host / server.
// Reads connection details from ../.env (never committed). npm i ssh2-sftp-client
const Client = require('ssh2-sftp-client');
require('fs').readFileSync; // node only
const env = require('dotenv').config({ path: __dirname + '/../.env' }).parsed || process.env;

const sftp = new Client();
const LOCAL  = __dirname + '/../frontend/index.html';
const REMOTE = env.REMOTE_INDEX_PATH || '/var/www/app/index.html';

sftp.connect({ host: env.DEPLOY_HOST, username: env.DEPLOY_USER, password: env.DEPLOY_PASS })
  .then(() => sftp.fastPut(LOCAL, REMOTE))
  .then(() => { console.log('deployed frontend ->', REMOTE); return sftp.end(); })
  .catch(e => { console.error('deploy failed:', e.message); process.exit(1); });
