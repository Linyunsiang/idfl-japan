const A = require('./_auth');
exports.handler = async () => ({
  statusCode:200,
  headers:{'Content-Type':'application/json','Cache-Control':'no-store',
    'Set-Cookie':`${A.COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`},
  body: JSON.stringify({ ok:true })
});
