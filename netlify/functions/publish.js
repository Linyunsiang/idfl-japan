// IDFL admin publish endpoint: commits data/<type>.json to GitHub.
// Requires env vars: GITHUB_TOKEN (repo contents read/write), ADMIN_PASSWORD
const OWNER = 'Linyunsiang';
const REPO  = 'idfl-japan';
const BRANCH = 'main';
const ALLOWED = { qa:'data/qa.json', news:'data/news.json', downloads:'data/downloads.json' };

function resp(code, obj){
  return { statusCode: code,
    headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'},
    body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(200, {ok:true});
  if (event.httpMethod !== 'POST')   return resp(405, {error:'method not allowed'});

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch(e){ return resp(400,{error:'invalid json'}); }
  const { type, password, data } = body;

  if (!process.env.ADMIN_PASSWORD) return resp(500, {error:'server not configured: ADMIN_PASSWORD'});
  if (password !== process.env.ADMIN_PASSWORD) return resp(401, {error:'パスワードが正しくありません'});

  const path = ALLOWED[type];
  if (!path) return resp(400, {error:'unknown type'});
  if (!Array.isArray(data)) return resp(400, {error:'data must be an array'});

  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN1;
  if (!token) return resp(500, {error:'server not configured: GITHUB_TOKEN'});

  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const H = { 'Authorization':`Bearer ${token}`, 'Accept':'application/vnd.github+json', 'User-Agent':'idfl-admin-publish' };

  // current sha (if file exists)
  let sha;
  try {
    const g = await fetch(`${api}?ref=${BRANCH}`, { headers: H });
    if (g.status === 200) { const gj = await g.json(); sha = gj.sha; }
  } catch(e){ /* ignore -> create new */ }

  const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');
  const payload = { message:`admin publish: ${path}`, content, branch: BRANCH };
  if (sha) payload.sha = sha;

  const put = await fetch(api, { method:'PUT', headers:{...H,'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  if (put.status >= 200 && put.status < 300) return resp(200, {ok:true, count:data.length});
  let msg=''; try{ msg=(await put.json()).message||''; }catch(e){}
  return resp(502, {error:`GitHub ${put.status} ${msg}`});
};
