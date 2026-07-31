// ============================================================
// IDFL admin - ファイル管理 API（アップロード / 置換 / 版数 / 復元 / 削除）
// 純静的サイト向け：GitHub Contents API 経由で files/ を安全に更新。
// 秘密情報はすべて環境変数（GITHUB_TOKEN / ADMIN_PASSWORD）。フロント露出なし。
//
// 段階公開モデル（静的+Gitでの安全な代替）:
//   1) stage-upload : 新ファイルを files/_pending/ に保存（本番URL・実ファイルは不変）
//   2) publish      : 現行ファイルを files/_history/ に退避 → 本番パスへ上書き（URL不変）
//                     → downloads-data.json を更新 → pending 削除
//   失敗時は本番ファイルを一切破壊しない（pendingのみ）。
// ============================================================
const CFG = require('./_config');
const OWNER='Linyunsiang', REPO='idfl-japan', BRANCH='main';
const JSON_PATH='downloads-data.json';
const FILES_DIR='files';
const PENDING_DIR='files/_pending';
const HISTORY_DIR='files/_history';

function resp(code,obj){return {statusCode:code,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS'},body:JSON.stringify(obj)};}

// --- 簡易レート制限（ベストエフォート：関数インスタンス内メモリ。堅牢化には外部ストアが必要）---
const RL={}; const RL_MAX=30, RL_WIN=60*1000;
function rateLimited(key){const now=Date.now();const a=(RL[key]||[]).filter(t=>now-t<RL_WIN);a.push(now);RL[key]=a;return a.length>RL_MAX;}

// --- 入力サニタイズ ---
function safeDocId(id){ id=String(id||''); return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null; } // ../ 等を排除
function baseName(n){ return String(n||'').split(/[\\/]/).pop().slice(0,180); }               // パスを含めない
function extOf(n){ return (String(n).split('.').pop()||'').toLowerCase(); }

// --- 実体（マジックバイト）検証：ファイル名だけに依存しない ---
function magicOk(ext, buf){
  const t=CFG.TYPES[ext]; if(!t) return false;
  const head=buf.slice(0,8).toString('hex').toLowerCase();
  return t.magic.some(sig=>head.startsWith(sig.toLowerCase()));
}

// --- GitHub helpers ---
function token(){ return process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN1; }
function H(){ return { 'Authorization':`Bearer ${token()}`, 'Accept':'application/vnd.github+json', 'User-Agent':'idfl-file-manager' }; }
function apiUrl(path){ return `https://api.github.com/repos/${OWNER}/${REPO}/contents/`+path.split('/').map(encodeURIComponent).join('/'); }

async function ghGet(path){
  const r=await fetch(apiUrl(path)+`?ref=${BRANCH}`,{headers:H()});
  if(r.status===404) return null;
  if(!r.ok) throw new Error('GitHub取得エラー '+r.status);
  const j=await r.json();
  return { sha:j.sha, base64:(j.content||'').replace(/\n/g,''), size:j.size };
}
async function ghPut(path, base64, message, sha){
  const payload={ message, content:base64, branch:BRANCH }; if(sha) payload.sha=sha;
  const r=await fetch(apiUrl(path),{ method:'PUT', headers:{...H(),'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  if(r.status>=200&&r.status<300){ const j=await r.json(); return { commit:(j.commit&&j.commit.sha)||'', sha:(j.content&&j.content.sha)||'' }; }
  const txt=await r.text().catch(()=> '');
  throw new Error('GitHub保存エラー '+r.status+(txt?(': '+txt.slice(0,120)):''));
}
async function ghDelete(path, sha, message){
  const r=await fetch(apiUrl(path),{ method:'DELETE', headers:{...H(),'Content-Type':'application/json'}, body:JSON.stringify({ message, sha, branch:BRANCH }) });
  return r.ok; // 失敗しても致命的ではない（pendingの掃除）
}

function nowJst(){ // ISO(+09:00)
  const d=new Date(Date.now()+9*3600*1000);
  return d.toISOString().replace('Z','+09:00');
}
function human(bytes){ return bytes>=1048576 ? (bytes/1048576).toFixed(1)+' MB' : Math.max(1,Math.round(bytes/1024))+' KB'; }

// ============================================================
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(200,{ok:true});

  // config は認証不要で返す（許可拡張子・サイズ上限のみ。秘密なし）
  const qsAction = (event.queryStringParameters||{}).action;
  if (event.httpMethod==='GET' && qsAction==='config'){
    return resp(200,{ ok:true, allowedExt:CFG.ALLOWED_EXT, maxBytes:CFG.MAX_FILE_BYTES, maxLabel:human(CFG.MAX_FILE_BYTES) });
  }
  if (event.httpMethod!=='POST') return resp(405,{error:'method not allowed'});

  let body; try{ body=JSON.parse(event.body||'{}'); }catch(e){ return resp(400,{error:'不正なリクエストです'}); }
  const { action, password } = body;

  // --- 認証（サーバ側で毎回検証）---
  if (!process.env.ADMIN_PASSWORD) return resp(500,{error:'サーバ設定エラー: ADMIN_PASSWORD が未設定です'});
  if (password !== process.env.ADMIN_PASSWORD) return resp(401,{error:'ログインセッションの有効期限が切れました。再度ログインしてください'});
  if (!token()) return resp(500,{error:'サーバ設定エラー: GITHUB_TOKEN が未設定です'});

  const ip=(event.headers&&(event.headers['x-nf-client-connection-ip']||event.headers['client-ip']))||'anon';
  if (rateLimited(ip)) return resp(429,{error:'リクエストが多すぎます。しばらくしてから再度お試しください'});

  try{
    if (action==='stage-upload') return await stageUpload(body);
    if (action==='publish')      return await publish(body);
    if (action==='discard')      return await discard(body);
    if (action==='restore')      return await restore(body);
    if (action==='delete')       return await deleteDoc(body);
    return resp(400,{error:'不明な操作です'});
  }catch(e){
    console.error('[file-manager]',action,e&&e.message);
    return resp(502,{error:(e&&e.message)||'処理に失敗しました'});
  }
};

// --- 1) 段階アップロード（新規/置換とも pending へ）---
async function stageUpload(body){
  const docId=safeDocId(body.docId);
  if(!docId) return resp(400,{error:'ファイルIDが不正です'});
  const isReplace=!!body.isReplace;
  const origName=baseName(body.filename);
  const ext=extOf(origName);

  if(CFG.BLOCKED_EXT.includes(ext)) return resp(400,{error:'実行形式・スクリプトファイルはアップロードできません'});
  if(!CFG.ALLOWED_EXT.includes(ext)) return resp(400,{error:'ファイル形式が対応していません（対応: '+CFG.ALLOWED_EXT.join(', ').toUpperCase()+'）'});
  if(typeof body.contentBase64!=='string' || !body.contentBase64) return resp(400,{error:'ファイルデータがありません'});
  if(!/^[A-Za-z0-9+/=\r\n]+$/.test(body.contentBase64)) return resp(400,{error:'不正なファイルデータです'});

  let buf; try{ buf=Buffer.from(body.contentBase64,'base64'); }catch(e){ return resp(400,{error:'ファイルの復号に失敗しました'}); }
  if(buf.length===0) return resp(400,{error:'空のファイルです'});
  if(buf.length>CFG.MAX_FILE_BYTES) return resp(413,{error:'ファイルサイズが上限（'+human(CFG.MAX_FILE_BYTES)+'）を超えています'});
  if(!magicOk(ext,buf)) return resp(400,{error:'ファイルの実体が拡張子と一致しません（不正または破損の可能性）'});

  // 置換時は現行の拡張子と一致必須（公開URLを不変に保つため）
  if(isReplace && body.currentUrl){
    const curExt=extOf(body.currentUrl);
    if(curExt && curExt!==ext) return resp(400,{error:'置換ファイルの形式（.'+ext+'）が現在のファイル（.'+curExt+'）と異なります。同じ形式でアップロードしてください'});
  }

  const ts=Date.now();
  const pendingPath=`${PENDING_DIR}/${docId}/${ts}.${ext}`;
  await ghPut(pendingPath, buf.toString('base64'), `admin(stage): pending ${isReplace?'replace':'upload'} - ${docId}`);

  return resp(200,{ ok:true, pending:{ path:'/'+pendingPath, repoPath:pendingPath, ext, size:buf.length, sizeLabel:human(buf.length), originalFileName:origName, uploadedAt:nowJst() } });
}

// --- pending 破棄 ---
async function discard(body){
  const p=String(body.repoPath||'');
  if(!p.startsWith(PENDING_DIR+'/')) return resp(400,{error:'不正なパスです'});
  const cur=await ghGet(p);
  if(cur) await ghDelete(p, cur.sha, 'admin(stage): discard pending');
  return resp(200,{ok:true});
}

// --- 2) 公開：pending を本番へ昇格（履歴退避→上書き）→ JSON 更新 ---
async function publish(body){
  const items=Array.isArray(body.items)?body.items:null;
  if(!items) return resp(400,{error:'データ形式が不正です'});
  if(items.length>5000) return resp(413,{error:'データが大きすぎます'});

  const report=[];
  for(const it of items){
    if(!it || !it._pending) continue;
    const docId=safeDocId(it.id);
    if(!docId){ return resp(400,{error:'ファイルID「'+it.id+'」が不正です'}); }
    const pend=it._pending;
    if(!String(pend.repoPath||'').startsWith(PENDING_DIR+'/')) return resp(400,{error:'不正な一時ファイルパスです'});

    const pendFile=await ghGet(pend.repoPath);
    if(!pendFile) return resp(400,{error:'一時ファイルが見つかりません（再アップロードしてください）: '+docId});

    // 本番パス決定（置換=URL不変、新規=固定名）
    let livePath;
    const curUrl=String(it.url||'');
    if(curUrl.startsWith('/'+FILES_DIR+'/')) livePath=curUrl.slice(1);
    else livePath=`${FILES_DIR}/${docId}.${pend.ext}`;

    const versions=Array.isArray(it.versions)?it.versions:[];

    // 既存があれば履歴へ退避（=失敗しても本番は無傷、成功後に上書き）
    const live=await ghGet(livePath);
    if(live){
      const vno=versions.length+1;
      const hExt=extOf(livePath)||pend.ext;
      const hPath=`${HISTORY_DIR}/${docId}/v${vno}_${Date.now()}.${hExt}`;
      const hres=await ghPut(hPath, live.base64, `admin(history): backup v${vno} - ${docId}`);
      versions.push({ v:vno, path:'/'+hPath, repoPath:hPath, originalFileName:it.originalFileName||baseName(livePath), size:it.sizeBytes||live.size||0, sizeLabel:it.size||human(live.size||0), updatedAt:it.updatedAt||'', updatedBy:it.updatedBy||'admin', commit:hres.commit });
    }

    // 本番へ上書き（URL不変）
    const putres=await ghPut(livePath, pendFile.base64, `admin: replace document - ${docId}`, live?live.sha:undefined);

    // メタ更新
    it.url='/'+livePath;
    it.originalFileName=pend.originalFileName;
    it.sizeBytes=pend.size;
    it.size=pend.sizeLabel;
    it.ftype=(it.ftype && it.ftype!=='LINK') ? it.ftype : pend.ext.toUpperCase();
    it.updatedAt=nowJst();
    it.updatedBy='admin';
    it.lastCommit=putres.commit;
    it.versions=versions;

    // pending 掃除
    await ghDelete(pend.repoPath, pendFile.sha, `admin(stage): cleanup pending - ${docId}`);
    delete it._pending;
    report.push({ id:docId, url:it.url, commit:putres.commit });
  }

  // downloads-data.json を更新（_pending は保存しない）
  const clean=items.map(it=>{ const c=Object.assign({},it); delete c._pending; return c; });
  const cur=await ghGet(JSON_PATH);
  const content=Buffer.from(JSON.stringify(clean,null,2),'utf8').toString('base64');
  const jres=await ghPut(JSON_PATH, content, 'admin: update downloads-data.json (file-manager)', cur?cur.sha:undefined);

  return resp(200,{ ok:true, items:clean, published:report, jsonCommit:jres.commit, publishedAt:nowJst() });
}

// --- 復元：履歴の版を本番へ戻す（現行は履歴へ退避してから）---
async function restore(body){
  const docId=safeDocId(body.docId);
  if(!docId) return resp(400,{error:'ファイルIDが不正です'});
  const versionPath=String(body.versionRepoPath||'');
  if(!versionPath.startsWith(HISTORY_DIR+'/'+docId+'/')) return resp(400,{error:'不正なバージョンパスです'});

  const jsonFile=await ghGet(JSON_PATH);
  if(!jsonFile) return resp(500,{error:'データファイルが見つかりません'});
  let arr; try{ arr=JSON.parse(Buffer.from(jsonFile.base64,'base64').toString('utf8')); }catch(e){ return resp(500,{error:'データファイルの解析に失敗しました'}); }
  const it=arr.find(x=>x && x.id===body.docId);
  if(!it) return resp(400,{error:'対象の書類が見つかりません'});

  const ver=await ghGet(versionPath);
  if(!ver) return resp(400,{error:'指定バージョンが見つかりません'});

  const livePath=String(it.url||'').startsWith('/'+FILES_DIR+'/')?it.url.slice(1):`${FILES_DIR}/${docId}.${extOf(versionPath)}`;
  const live=await ghGet(livePath);
  const versions=Array.isArray(it.versions)?it.versions:[];

  // 現行を履歴へ退避（復元も可逆に）
  if(live){
    const vno=versions.length+1;
    const hPath=`${HISTORY_DIR}/${docId}/v${vno}_${Date.now()}.${extOf(livePath)}`;
    const hres=await ghPut(hPath, live.base64, `admin(history): backup before restore v${vno} - ${docId}`);
    versions.push({ v:vno, path:'/'+hPath, repoPath:hPath, originalFileName:it.originalFileName||baseName(livePath), size:it.sizeBytes||live.size||0, sizeLabel:it.size||human(live.size||0), updatedAt:it.updatedAt||'', updatedBy:it.updatedBy||'admin', commit:hres.commit, note:'復元前バックアップ' });
  }

  const putres=await ghPut(livePath, ver.base64, `admin: restore document - ${docId}`, live?live.sha:undefined);
  it.url='/'+livePath;
  it.sizeBytes=ver.size||0; it.size=human(ver.size||0);
  it.updatedAt=nowJst(); it.updatedBy='admin'; it.lastCommit=putres.commit; it.versions=versions;

  const content=Buffer.from(JSON.stringify(arr,null,2),'utf8').toString('base64');
  await ghPut(JSON_PATH, content, `admin: restore + update json - ${docId}`, jsonFile.sha);
  return resp(200,{ ok:true, item:it, restoredAt:nowJst() });
}

// --- 削除：現行ファイルを履歴へ退避してから、JSONから項目を除去 ---
async function deleteDoc(body){
  const docId=safeDocId(body.docId);
  if(!docId) return resp(400,{error:'ファイルIDが不正です'});
  const jsonFile=await ghGet(JSON_PATH);
  if(!jsonFile) return resp(500,{error:'データファイルが見つかりません'});
  let arr; try{ arr=JSON.parse(Buffer.from(jsonFile.base64,'base64').toString('utf8')); }catch(e){ return resp(500,{error:'データファイルの解析に失敗しました'}); }
  const idx=arr.findIndex(x=>x && x.id===body.docId);
  if(idx<0) return resp(400,{error:'対象の書類が見つかりません'});
  const it=arr[idx];

  const livePath=String(it.url||'').startsWith('/'+FILES_DIR+'/')?it.url.slice(1):null;
  if(livePath){
    const live=await ghGet(livePath);
    if(live){
      const hPath=`${HISTORY_DIR}/${docId}/deleted_${Date.now()}.${extOf(livePath)}`;
      await ghPut(hPath, live.base64, `admin(history): backup before delete - ${docId}`);
      await ghDelete(livePath, live.sha, `admin: delete document file - ${docId}`);
    }
  }
  arr.splice(idx,1);
  const content=Buffer.from(JSON.stringify(arr,null,2),'utf8').toString('base64');
  await ghPut(JSON_PATH, content, `admin: delete document - ${docId}`, jsonFile.sha);
  return resp(200,{ ok:true, deletedAt:nowJst() });
}
