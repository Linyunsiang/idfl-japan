// IDFL auth - shared signing/verify (Node runtime). Secret from env only.
const crypto = require('crypto');
const COOKIE = 'idfl_session';
const RANK = { PUBLIC:0, CUSTOMER:1, STAFF:2 };
const TTL  = { CUSTOMER: 8*3600, STAFF: 4*3600 }; // seconds

function b64url(buf){ return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function b64urlJson(o){ return b64url(Buffer.from(JSON.stringify(o),'utf8')); }
function secret(){ return process.env.SESSION_SECRET || ''; }

function sign(role){
  const now = Math.floor(Date.now()/1000);
  const exp = now + (TTL[role] || TTL.CUSTOMER);
  const payload = b64urlJson({ role, iat: now, exp });
  const sig = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  return payload + '.' + sig;
}
function verify(token){
  if(!token || typeof token!=='string' || token.indexOf('.')<0) return null;
  const [payload, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  const a = Buffer.from(sig||''), b = Buffer.from(expected);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
  let data; try{ data = JSON.parse(Buffer.from(payload.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')); }catch(e){ return null; }
  if(!data || !data.exp || data.exp < Math.floor(Date.now()/1000)) return null;
  if(!(data.role in RANK)) return null;
  return data; // {role,iat,exp}
}
function roleFromCookies(cookieHeader){
  const m = String(cookieHeader||'').match(new RegExp('(?:^|;\\s*)'+COOKIE+'=([^;]+)'));
  if(!m) return null;
  const d = verify(decodeURIComponent(m[1]));
  return d ? d.role : null;
}
function meets(role, required){ return (RANK[role]||0) >= (RANK[required]||0); }

module.exports = { COOKIE, RANK, TTL, sign, verify, roleFromCookies, meets, b64url };
