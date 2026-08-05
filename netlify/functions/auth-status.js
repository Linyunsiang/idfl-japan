const A = require('./_auth');
exports.handler = async (event) => {
  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  return { statusCode:200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}, body: JSON.stringify({ role }) };
};
