// IDFL admin file-upload endpoint: commits an uploaded file to files/<name> on GitHub.
// Requires env vars: GITHUB_TOKEN (repo contents read/write), ADMIN_PASSWORD
const OWNER = 'Linyunsiang';
const REPO  = 'idfl-japan';
const BRANCH = 'main';

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
  const { password, filename, contentBase64 } = body;

  if (!process.env.ADMIN_PASSWORD) return resp(500, {error:'server not configured: ADMIN_PASSWORD'});
  if (password !== process.env.ADMIN_PASSWORD) return resp(401, {error:'パスワードが正しくありません'});
  if (!filename || typeof contentBase64 !== 'string' || !contentBase64) return resp(400, {error:'filename と contentBase64 は必須です'});

  // base64 payload guard (Netlify request body limit ~6MB → ~4MB file)
  if (contentBase64.length > 6 * 1024 * 1024) return resp(413, {error:'ファイルが大きすぎます（約4MBまで）'});

  // sanitize to a safe basename: keep unicode, drop path + spaces + illegal chars
  let name = String(filename).split(/[\\/]/).pop()
    .replace(/\s+/g, '-')
    .replace(/[<>:"|?*\x00-\x1f]+/g, '')
    .replace(/-+/g, '-');
  if (!name || name === '.' || name === '..') name = 'file-' + Date.now();

  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN1;
  if (!token) return resp(500, {error:'server not configured: GITHUB_TOKEN'});

  const path = 'files/' + name;
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/` + path.split('/').map(encodeURIComponent).join('/');
  const H = { 'Authorization':`Bearer ${token}`, 'Accept':'application/vnd.github+json', 'User-Agent':'idfl-admin-upload' };

  // current sha (overwrite if the file already exists)
  let sha;
  try {
    const g = await fetch(`${api}?ref=${BRANCH}`, { headers: H });
    if (g.status === 200) { const gj = await g.json(); sha = gj.sha; }
  } catch(e){ /* ignore -> create new */ }

  const payload = { message:`admin upload: ${path}`, content: contentBase64, branch: BRANCH };
  if (sha) payload.sha = sha;

  const put = await fetch(api, { method:'PUT', headers:{...H,'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  if (put.status >= 200 && put.status < 300) return resp(200, {ok:true, path:'/'+path, name});
  let msg=''; try{ msg=(await put.json()).message||''; }catch(e){}
  return resp(502, {error:`GitHub ${put.status} ${msg}`});
};
