// POST /.netlify/functions/protected-addlink (STAFF) { url, title, role:'staff'|'customer', group? }
// Stores a role-gated external link (e.g. large file on Google Drive/Dropbox).
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const crypto = require('crypto');
const STORE='idfl-protected';
function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)};}
function nowJst(){const d=new Date(Date.now()+9*3600*1000);return d.toISOString().replace('Z','+09:00');}
exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  if(event.httpMethod!=='POST') return resp(405,{error:'method not allowed'});
  const origin=event.headers.origin||event.headers.referer||''; const host=event.headers.host||'';
  if(host&&origin&&origin.indexOf(host)<0) return resp(403,{error:'invalid origin'});
  if(A.roleFromCookies(event.headers.cookie)!=='STAFF') return resp(403,{error:'スタッフ権限が必要です'});
  let body; try{ body=JSON.parse(event.body||'{}'); }catch(e){ return resp(400,{error:'invalid request'}); }
  const targetRole = body.role==='staff'?'staff':(body.role==='customer'?'customer':null);
  if(!targetRole) return resp(400,{error:'公開区分が不正です'});
  const url=String(body.url||'').trim();
  if(!/^https:\/\/[^\s"'<>]+$/i.test(url)) return resp(400,{error:'URLは https:// で始まる有効なリンクを入力してください'});
  const title=String(body.title||url).slice(0,200);
  const group=String(body.group||'').slice(0,120);
  let store; try{ store=getStore(STORE); }catch(e){ return resp(500,{error:'ストレージに接続できません'}); }
  const id = Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex');
  const metadata = { kind:'link', role:targetRole, name:title, title, group, url, uploadedAt:nowJst(), uploadedBy:'staff' };
  try{ await store.set(id, url, { metadata }); }catch(e){ return resp(502,{error:'保存に失敗しました'}); }
  return resp(200,{ ok:true, id });
};
