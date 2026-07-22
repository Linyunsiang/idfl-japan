// IDFL admin file-upload endpoint: commits an image to files/<unique-name> on GitHub.
// Env: GITHUB_TOKEN (repo contents rw), ADMIN_PASSWORD
const OWNER='Linyunsiang', REPO='idfl-japan', BRANCH='main';
const ALLOWED_EXT = { png:1, jpg:1, jpeg:1, webp:1, svg:1 };

function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'},body:JSON.stringify(obj)};}

function sanitizeSvg(b64){
  let svg;
  try { svg = Buffer.from(b64,'base64').toString('utf8'); } catch(e){ return null; }
  svg = svg
    .replace(/<!DOCTYPE[\s\S]*?>/gi,'')
    .replace(/<\?xml[\s\S]*?\?>/gi,'')
    .replace(/<script[\s\S]*?<\/script>/gi,'')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi,'')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi,'')
    .replace(/\son\w+\s*=\s*'[^']*'/gi,'')
    .replace(/(href|xlink:href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi,'')
    .replace(/<(iframe|embed|object|link|meta)[\s\S]*?>/gi,'');
  if(!/<svg[\s>]/i.test(svg)) return null;
  return Buffer.from(svg,'utf8').toString('base64');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(200,{ok:true});
  if (event.httpMethod !== 'POST')   return resp(405,{error:'method not allowed'});

  let body; try { body = JSON.parse(event.body||'{}'); } catch(e){ return resp(400,{error:'invalid json'}); }
  let { password, filename, contentBase64 } = body;

  if (!process.env.ADMIN_PASSWORD) return resp(500,{error:'server not configured'});
  if (password !== process.env.ADMIN_PASSWORD) return resp(401,{error:'パスワードが正しくありません'});
  if (!filename || typeof contentBase64 !== 'string' || !contentBase64) return resp(400,{error:'filename と contentBase64 は必須です'});
  if (contentBase64.length > 6*1024*1024) return resp(413,{error:'ファイルが大きすぎます（約4MBまで）'});
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(contentBase64)) return resp(400,{error:'不正なファイルデータです'});

  // safe basename + extension allowlist
  let name = String(filename).split(/[\\/]/).pop()
    .replace(/\s+/g,'-').replace(/[^A-Za-z0-9._\-]/g,'').replace(/-+/g,'-');
  const ext = (name.split('.').pop()||'').toLowerCase();
  if (!ALLOWED_EXT[ext]) return resp(400,{error:'対応形式は PNG / JPG / WEBP / SVG のみです'});

  // SVG sanitize (strip scripts/handlers to prevent stored XSS)
  if (ext === 'svg') {
    const clean = sanitizeSvg(contentBase64);
    if (!clean) return resp(400,{error:'SVGを処理できませんでした'});
    contentBase64 = clean;
  }

  // unique name to avoid accidental overwrite
  const uniq = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,6);
  name = uniq + '-' + name;

  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN1;
  if (!token) return resp(500,{error:'server not configured'});

  const path = 'files/' + name;
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/` + path.split('/').map(encodeURIComponent).join('/');
  const H = { 'Authorization':`Bearer ${token}`, 'Accept':'application/vnd.github+json', 'User-Agent':'idfl-admin-upload' };
  const put = await fetch(api, { method:'PUT', headers:{...H,'Content-Type':'application/json'}, body: JSON.stringify({ message:`content: upload ${path}`, content: contentBase64, branch: BRANCH }) });
  if (put.status >= 200 && put.status < 300) return resp(200,{ok:true, path:'/'+path, name});
  return resp(502,{error:'GitHub error '+put.status});
};
