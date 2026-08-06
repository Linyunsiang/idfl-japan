// GET /.netlify/functions/protected-list -> files the current session may access (via blob metadata)
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const STORE='idfl-protected';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  let store; try{ store=getStore(STORE); }catch(e){ return resp(200,{ok:true,role,files:[]}); }
  let keys=[]; try{ const l=await store.list(); keys=(l&&l.blobs||[]).map(b=>b.key); }catch(e){ return resp(200,{ok:true,role,files:[]}); }
  const files=[];
  for(const key of keys){
    let m; try{ m=await store.getMetadata(key); }catch(e){ continue; }
    const meta=(m&&m.metadata)||{};
    if(!meta.role) continue;
    const need = meta.role==='staff'?'STAFF':'CUSTOMER';
    if(A.meets(role,need)) files.push({ id:key, name:meta.name, title:meta.title||meta.name, role:meta.role, sizeLabel:meta.sizeLabel, contentType:meta.contentType, uploadedAt:meta.uploadedAt });
  }
  files.sort((a,b)=>String(b.uploadedAt||'').localeCompare(String(a.uploadedAt||'')));
  return resp(200,{ok:true,role,files});
};
