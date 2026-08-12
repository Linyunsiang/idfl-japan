// POST /.netlify/functions/protected-delete { id }  (STAFF session required)
// Deletes the blob (file bytes + metadata, or link) and removes it from the display-order index.
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const STORE='idfl-protected';
const ORDER_KEY='__order__';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  if(event.httpMethod!=='POST') return resp(405,{error:'method not allowed'});
  if(A.roleFromCookies(event.headers.cookie)!=='STAFF') return resp(403,{error:'スタッフ権限が必要です'});
  let body; try{ body=JSON.parse(event.body||'{}'); }catch(e){ return resp(400,{error:'invalid'}); }
  const id=String(body.id||''); if(!/^[A-Za-z0-9_-]{1,64}$/.test(id) || id.indexOf('__')===0) return resp(400,{error:'invalid id'});
  let store; try{ store=getStore(STORE); }catch(e){ return resp(500,{error:'storage unavailable'}); }
  try{ await store.delete(id); }catch(e){ return resp(502,{error:'削除に失敗しました'}); }
  // best-effort: drop the id from the order index
  try{ const o=await store.get(ORDER_KEY,{type:'json'}); if(Array.isArray(o)&&o.indexOf(id)>=0){ await store.setJSON(ORDER_KEY, o.filter(x=>x!==id)); } }catch(e){}
  return resp(200,{ok:true});
};
