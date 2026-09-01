// POST /.netlify/functions/protected-update  (STAFF session required)
// Two modes:
//   1) Reorder:   { orderIds:[id,id,...] }            -> writes the display-order index (fast, no file rewrite)
//   2) Edit meta: { id, title?, group?, role?, status?, url? } -> updates blob metadata WITHOUT re-uploading the file
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const STORE='idfl-protected';
const ORDER_KEY='__order__';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
function nowJst(){const d=new Date(Date.now()+9*3600*1000);return d.toISOString().replace('Z','+09:00');}
const IDRE=/^[A-Za-z0-9_-]{1,64}$/;
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  if(event.httpMethod!=='POST') return resp(405,{error:'method not allowed'});
  const origin=event.headers.origin||event.headers.referer||''; const host=event.headers.host||'';
  if(host&&origin&&origin.indexOf(host)<0) return resp(403,{error:'invalid origin'});
  if(A.roleFromCookies(event.headers.cookie)!=='STAFF') return resp(403,{error:'スタッフ権限が必要です'});
  let body; try{ body=JSON.parse(event.body||'{}'); }catch(e){ return resp(400,{error:'invalid request'}); }
  let store; try{ store=getStore(STORE); }catch(e){ return resp(500,{error:'ストレージに接続できません'}); }

  // --- Mode 1: reorder ---
  if(Array.isArray(body.orderIds)){
    const ids=body.orderIds.filter(x=>typeof x==='string' && IDRE.test(x) && x.indexOf('__')!==0).slice(0,5000);
    try{ await store.setJSON(ORDER_KEY, ids); }catch(e){ return resp(502,{error:'並び順の保存に失敗しました'}); }
    return resp(200,{ok:true, count:ids.length});
  }

  // --- Mode 2: single-item metadata edit (no re-upload) ---
  const id=String(body.id||''); if(!IDRE.test(id) || id.indexOf('__')===0) return resp(400,{error:'invalid id'});
  let res; try{ res=await store.getWithMetadata(id,{type:'arrayBuffer'}); }catch(e){ return resp(500,{error:'read error'}); }
  if(!res || res.data==null) return resp(404,{error:'not found'});
  const meta=Object.assign({}, res.metadata||{});
  if(!meta.role) return resp(400,{error:'invalid item'});
  if(typeof body.title==='string') meta.title=body.title.slice(0,200);
  if(typeof body.group==='string') meta.group=body.group.slice(0,120);
  // Media Library fields. Optional everywhere, so existing callers are unaffected.
  if(typeof body.description==='string') meta.description=body.description.slice(0,600);
  if(typeof body.thumb==='string') meta.thumb=body.thumb.slice(0,300);
  if(body.role==='staff'||body.role==='customer') meta.role=body.role;
  if(body.status==='draft'||body.status==='published') meta.status=body.status;
  let newData=res.data; // preserve file bytes (or link string) unless url changes
  if(meta.kind==='link' && typeof body.url==='string' && body.url.trim()){
    const url=body.url.trim();
    if(!/^https:\/\/[^\s"'<>]+$/i.test(url)) return resp(400,{error:'URLは https:// で始まる有効なリンクを入力してください'});
    meta.url=url; newData=url;
  }
  meta.updatedAt=nowJst();
  try{ await store.set(id, newData, { metadata:meta }); }catch(e){ return resp(502,{error:'更新に失敗しました'}); }
  return resp(200,{ok:true, id});
};
