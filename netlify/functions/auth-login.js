// POST /auth/login  { role:'customer'|'staff', password:'...' }
// Verifies against env passwords (server-side only), rate-limits, sets signed HttpOnly cookie.
const A = require('./_auth');

const attempts = {}; // best-effort per-instance rate limit
const MAX=5, WINDOW=15*60*1000, LOCK=15*60*1000;
function limited(key){
  const now=Date.now(); const e=attempts[key]||{count:0,first:now,lockUntil:0};
  if(e.lockUntil>now) return true;
  if(now-e.first>WINDOW){ e.count=0; e.first=now; }
  attempts[key]=e; return false;
}
function fail(key){ const e=attempts[key]||{count:0,first:Date.now(),lockUntil:0}; e.count++; if(e.count>=MAX){ e.lockUntil=Date.now()+LOCK; e.count=0; } attempts[key]=e; }
function ok(key){ delete attempts[key]; }

function resp(code,obj,cookie){
  const h={'Content-Type':'application/json','Cache-Control':'no-store'};
  if(cookie) h['Set-Cookie']=cookie;
  return { statusCode:code, headers:h, body:JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if(event.httpMethod!=='POST') return resp(405,{error:'method not allowed'});
  // CSRF: require same-origin
  const origin = event.headers.origin || event.headers.referer || '';
  const host = event.headers.host || '';
  if(host && origin && origin.indexOf('://'+host)<0 && origin.indexOf(host)<0) return resp(403,{error:'invalid origin'});

  const ip=(event.headers['x-nf-client-connection-ip']||event.headers['client-ip']||'anon');
  if(limited(ip)) return resp(429,{error:'ログイン試行が多すぎます。15分後に再度お試しください。'});

  let body; try{ body=JSON.parse(event.body||'{}'); }catch(e){ return resp(400,{error:'invalid request'}); }
  const role = body.role==='staff' ? 'STAFF' : (body.role==='customer' ? 'CUSTOMER' : null);
  if(!role) return resp(400,{error:'invalid role'});

  const expected = role==='STAFF' ? process.env.STAFF_ACCESS_PASSWORD : process.env.CUSTOMER_ACCESS_PASSWORD;
  if(!expected || !process.env.SESSION_SECRET) return resp(500,{error:'サーバ設定エラー（環境変数未設定）'});

  const pw = String(body.password||'');
  const okPw = pw.length===String(expected).length && require('crypto').timingSafeEqual(Buffer.from(pw), Buffer.from(String(expected)));
  if(!okPw){
    fail(ip);
    const msg = role==='STAFF' ? 'スタッフ用パスワードが正しくありません。' : 'パスワードが正しくありません。再度ご確認ください。';
    return resp(401,{error:msg});
  }
  ok(ip);
  const token = A.sign(role);
  const maxAge = A.TTL[role];
  const cookie = `${A.COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  return resp(200,{ ok:true, role }, cookie);
};
