// POST /.netlify/functions/protected-delete { id }  (STAFF session required)
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const STORE='idfl-protected';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  if(event.httpMethod!=='POST') return resp(405,{error:'method not allowed'});
  if(A.roleFromCookies(event.headers.cookie)!=='STAFF') return resp(403,{error:'スタッフ権限が必要です'});
  let body; try{ body=JSON.parse(event.body||'{}'); }catch(e){ return resp(400,{error:'invalid'}); }
  const id=String(body.id||''); if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return resp(400,{error:'invalid id'});
  let store; try{ store=getStore({ name: STORE, consistency: 'strong' }); }catch(e){ return resp(500,{error:'storage unavailable'}); }
  try{ await store.delete(id); }catch(e){}
  let index=[]; try{ const idx=await store.get('_index',{type:'json'}); if(Array.isArray(idx)) index=idx; }catch(e){}
  index=index.filter(x=>x.id!==id);
  await store.set('_index', JSON.stringify(index));
  return resp(200,{ok:true});
};
