// GET /.netlify/functions/protected-file?id=xxx
// Serves a role-protected file from Netlify Blobs after verifying the session cookie.
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const STORE='idfl-protected';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  const id=((event.queryStringParameters||{}).id)||'';
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return resp(400,{error:'invalid id'});
  let store; try{ store=getStore({ name: STORE, consistency: 'strong' }); }catch(e){ return resp(500,{error:'storage unavailable'}); }
  let index=[]; try{ const idx=await store.get('_index',{type:'json'}); if(Array.isArray(idx)) index=idx; }catch(e){}
  const meta=index.find(x=>x.id===id);
  if(!meta) return resp(404,{error:'not found'});
  const need = meta.role==='staff' ? 'STAFF' : 'CUSTOMER';
  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  if(!A.meets(role,need)){
    const rp = need==='STAFF'?'staff':'customer';
    return { statusCode:302, headers:{ 'Location':`/login.html?role=${rp}&next=${encodeURIComponent('/customer/downloads.html')}`, 'Cache-Control':'no-store' }, body:'' };
  }
  let data; try{ data=await store.get(id,{type:'arrayBuffer'}); }catch(e){ return resp(500,{error:'read error'}); }
  if(!data) return resp(404,{error:'not found'});
  const buf=Buffer.from(data);
  return {
    statusCode:200,
    headers:{
      'Content-Type': meta.contentType || 'application/octet-stream',
      'Content-Disposition': "attachment; filename*=UTF-8''"+encodeURIComponent(meta.name||('file-'+id)),
      'Cache-Control':'private, no-store'
    },
    body: buf.toString('base64'),
    isBase64Encoded:true
  };
};
