// GET /.netlify/functions/protected-list  -> files the current session may access
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const STORE='idfl-protected';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  let store; try{ store=getStore(STORE); }catch(e){ return resp(200,{ok:true,role,files:[]}); }
  let index=[]; try{ const idx=await store.get('_index',{type:'json'}); if(Array.isArray(idx)) index=idx; }catch(e){}
  const files=index.filter(m=>A.meets(role, m.role==='staff'?'STAFF':'CUSTOMER'))
    .map(m=>({id:m.id,name:m.name,title:m.title||m.name,role:m.role,sizeLabel:m.sizeLabel,contentType:m.contentType,uploadedAt:m.uploadedAt}));
  return resp(200,{ok:true,role,files});
};
