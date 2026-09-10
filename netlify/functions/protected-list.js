// GET /.netlify/functions/protected-list -> files the current session may access (via blob metadata)
// STAFF sees all items (incl. drafts). CUSTOMER sees only published items they are allowed.
// Ordering: explicit display order from the __order__ index; unordered items fall back to newest-first.
const B = require('./_blobs');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');
const STORE=S.PROTECTED_STORE;
const ORDER_KEY='__order__';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
exports.handler = async (event) => {
  B.connect(event);
  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  let store; try{ store=B.readStore(STORE); }catch(e){ return resp(200,{ok:true,role,files:[]}); }
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
    files.push(M.recordOf(key, meta));
  }
  files.sort((a,b)=>{
    const pa=(a.id in pos)?pos[a.id]:Infinity, pb=(b.id in pos)?pos[b.id]:Infinity;
    if(pa!==pb) return pa-pb;
    return String(b.uploadedAt||'').localeCompare(String(a.uploadedAt||''));
  });
  // Staff-only, and only ever 'strong' or 'eventual': the read mode this
  // response was served with. An edit that looks like it did not save is a
  // stale read, so make that visible rather than something to be guessed at.
  return resp(200,{ok:true,role,files,consistency:(role==='STAFF'?B.mode():undefined)});
};
