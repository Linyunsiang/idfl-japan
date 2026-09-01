// GET /.netlify/functions/protected-file?id=xxx  -> serves a role-protected blob after session check
// Re-verifies session role AND visibility (draft/published) server-side on every request.
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const STORE='idfl-protected';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  const id=((event.queryStringParameters||{}).id)||'';
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(id) || id.indexOf('__')===0) return resp(400,{error:'invalid id'});
  let store; try{ store=getStore(STORE); }catch(e){ return resp(500,{error:'storage unavailable'}); }
  let res; try{ res=await store.getWithMetadata(id,{type:'arrayBuffer'}); }catch(e){ return resp(500,{error:'read error'}); }
  if(!res || !res.data) return resp(404,{error:'not found'});
  const meta=res.metadata||{};
  const need = meta.role==='staff' ? 'STAFF' : 'CUSTOMER';
  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  if(!A.meets(role,need)){
    const rp = need==='STAFF'?'staff':'customer';
    return { statusCode:302, headers:{ 'Location':`/login.html?role=${rp}&next=${encodeURIComponent('/customer/downloads.html')}`, 'Cache-Control':'no-store' }, body:'' };
  }
  // Draft items are only accessible to STAFF (defence in depth: cannot be fetched by URL even if id is known)
  if(meta.status==='draft' && role!=='STAFF') return resp(404,{error:'not found'});
  if(meta.kind==='link' && meta.url){
    return { statusCode:302, headers:{ 'Location':meta.url, 'Cache-Control':'no-store' }, body:'' };
  }
  const buf=Buffer.from(res.data);
  // The Media Library renders protected images as thumbnails, which needs an
  // inline disposition. Images only - everything else stays a download.
  const ct = meta.contentType || 'application/octet-stream';
  const wantInline = ((event.queryStringParameters||{}).inline==='1') && /^image\//.test(ct);
  return {
    statusCode:200,
    headers:{
      'Content-Type': ct,
      'Content-Disposition': (wantInline?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(meta.name||('file-'+id)),
      'X-Content-Type-Options':'nosniff',
      'Cache-Control':'private, no-store'
    },
    body: buf.toString('base64'),
    isBase64Encoded:true
  };
};
