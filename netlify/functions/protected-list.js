// GET /.netlify/functions/protected-list -> files the current session may access (via blob metadata)
// STAFF sees all items (incl. drafts). CUSTOMER sees only published items they are allowed.
// Ordering: explicit display order from the __order__ index; unordered items fall back to newest-first.
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');
const STORE=S.PROTECTED_STORE;
const ORDER_KEY='__order__';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  let store; try{ store=getStore(STORE); }catch(e){ return resp(200,{ok:true,role,files:[]}); }
  let keys=[]; try{ const l=await store.list(); keys=(l&&l.blobs||[]).map(b=>b.key); }catch(e){ return resp(200,{ok:true,role,files:[]}); }
  let orderArr=[]; try{ const o=await store.get(ORDER_KEY,{type:'json'}); if(Array.isArray(o)) orderArr=o; }catch(e){}
  const pos={}; orderArr.forEach((id,i)=>{ if(pos[id]==null) pos[id]=i; });
  const files=[];
  for(const key of keys){
    if(String(key).indexOf('__')===0) continue; // skip internal index blobs
    let m; try{ m=await store.getMetadata(key); }catch(e){ continue; }
    const meta=(m&&m.metadata)||{};
    if(!meta.role) continue;
    const need = meta.role==='staff'?'STAFF':'CUSTOMER';
    if(!A.meets(role,need)) continue;
    const status = meta.status==='draft' ? 'draft' : 'published';
    if(status==='draft' && role!=='STAFF') continue; // drafts are hidden from customers
    files.push({ id:key, kind:meta.kind||'file', url:(meta.kind==='link'?meta.url:undefined), name:meta.name, title:meta.title||meta.name, group:meta.group||'', role:meta.role, status, sizeLabel:meta.sizeLabel, contentType:meta.contentType, uploadedAt:meta.uploadedAt, updatedAt:meta.updatedAt||meta.uploadedAt,
      // Media Library fields. Derived where possible so existing records need
      // no migration; /customer/downloads.html simply ignores the extras.
      mediaType: M.mediaTypeOf(meta),
      description: meta.description||'',
      thumb: meta.thumb||'',
      version: meta.version?(parseInt(meta.version,10)||1):undefined,
      entry: meta.kind==='html'?(meta.entry||'index.html'):undefined,
      assetCount: meta.kind==='html'?(parseInt(meta.files,10)||0):undefined });
  }
  files.sort((a,b)=>{
    const pa=(a.id in pos)?pos[a.id]:Infinity, pb=(b.id in pos)?pos[b.id]:Infinity;
    if(pa!==pb) return pa-pb;
    return String(b.uploadedAt||'').localeCompare(String(a.uploadedAt||''));
  });
  return resp(200,{ok:true,role,files});
};
