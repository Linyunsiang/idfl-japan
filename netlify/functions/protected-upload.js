// POST /.netlify/functions/protected-upload  (STAFF session required)
// Body: { filename, contentBase64, role:'staff'|'customer', title? } -> stores to Netlify Blobs
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const CFG = require('./_config');
const crypto = require('crypto');
const STORE='idfl-protected';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
function baseName(n){return String(n||'').split(/[\\/]/).pop().slice(0,180);}
function extOf(n){return (String(n).split('.').pop()||'').toLowerCase();}
function human(b){return b>=1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB';}
function nowJst(){const d=new Date(Date.now()+9*3600*1000);return d.toISOString().replace('Z','+09:00');}
function magicOk(ext,buf){const t=CFG.TYPES[ext];if(!t)return false;const head=buf.slice(0,8).toString('hex').toLowerCase();return t.magic.some(s=>head.startsWith(s.toLowerCase()));}
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  if(event.httpMethod!=='POST') return resp(405,{error:'method not allowed'});
  const origin=event.headers.origin||event.headers.referer||''; const host=event.headers.host||'';
  if(host&&origin&&origin.indexOf(host)<0) return resp(403,{error:'invalid origin'});
  const role=A.roleFromCookies(event.headers.cookie);
  if(role!=='STAFF') return resp(403,{error:'スタッフ権限が必要です。スタッフでログインしてください。'});
  let body; try{ body=JSON.parse(event.body||'{}'); }catch(e){ return resp(400,{error:'invalid request'}); }
  const targetRole = body.role==='staff'?'staff':(body.role==='customer'?'customer':null);
  if(!targetRole) return resp(400,{error:'公開区分（staff/customer）が不正です'});
  const name=baseName(body.filename); const ext=extOf(name);
  if(CFG.BLOCKED_EXT.includes(ext)) return resp(400,{error:'実行形式・スクリプトはアップロードできません'});
  if(!CFG.ALLOWED_EXT.includes(ext)) return resp(400,{error:'対応形式は '+CFG.ALLOWED_EXT.join(', ').toUpperCase()+' のみです'});
  if(typeof body.contentBase64!=='string'||!/^[A-Za-z0-9+/=\r\n]+$/.test(body.contentBase64)) return resp(400,{error:'不正なファイルデータです'});
  let buf; try{ buf=Buffer.from(body.contentBase64,'base64'); }catch(e){ return resp(400,{error:'復号に失敗しました'}); }
  if(buf.length===0) return resp(400,{error:'空のファイルです'});
  if(buf.length>CFG.MAX_FILE_BYTES) return resp(413,{error:'サイズが上限（'+human(CFG.MAX_FILE_BYTES)+'）を超えています'});
  if(!magicOk(ext,buf)) return resp(400,{error:'ファイルの実体が拡張子と一致しません'});
  let store; try{ store=getStore(STORE); }catch(e){ return resp(500,{error:'ストレージに接続できません'}); }
  const id = Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex');
  const contentType = (CFG.TYPES[ext]||{}).mime || 'application/octet-stream';
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
  await store.set(id, ab, { metadata:{ role:targetRole, name, contentType } });
  let index=[]; try{ const idx=await store.get('_index',{type:'json'}); if(Array.isArray(idx)) index=idx; }catch(e){}
  index.unshift({ id, name, title:(body.title||name), role:targetRole, size:buf.length, sizeLabel:human(buf.length), contentType, uploadedAt:nowJst(), uploadedBy:'staff' });
  await store.set('_index', JSON.stringify(index));
  return resp(200,{ ok:true, id, sizeLabel:human(buf.length) });
};
