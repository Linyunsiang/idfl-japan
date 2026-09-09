/* ==========================================================================
   IDFL Media Library — shared shell ("Deep Ocean" console)
   --------------------------------------------------------------------------
   Owns what both customer pages have in common: the session gate, the record
   list, the rail (search, media types, collections), the responsive panels,
   the Fullscreen control, and the URL state that survives a reload.

   /customer/media.html        browse and inspect
   /customer/media-viewer.html open one record

   They are separate documents on purpose. The viewer mounts an uploaded
   package in a sandboxed frame under a one-time nonce and talks to it over
   postMessage; none of that belongs on an index page. Wearing the same shell
   is what makes them read as one console.

   Nothing here relaxes a security rule. Every string that comes back from an
   API is escaped before it reaches innerHTML; protected bytes are only ever
   reached through /.netlify/functions/protected-file, which re-checks the
   session, the role and the draft flag on every request; an external link is
   opened through that function rather than by its own URL; and the STAFF ONLY
   marking is a label on a decision the server already made - protected-list
   never sends a customer a record they may not have.
   ========================================================================== */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ escape
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ENT[m]; });
  }

  // ------------------------------------------------------------------- icons
  // One family, one stroke weight, drawn rather than borrowed from a font.
  var PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    all: '<rect x="3" y="4" width="18" height="7" rx="1.6"/><rect x="3" y="14" width="18" height="6" rx="1.6"/>',
    html: '<rect x="2.5" y="4" width="19" height="13" rx="1.8"/><path d="M9.5 21h5M12 17v4"/><path d="m10.5 8.2 3.8 2.3-3.8 2.3z"/>',
    pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.6 17.4c1.6-.6 2.9-2 3.8-3.8.8-1.6 1.3-3.1 1-3.7-.4-.8-1.4-.2-1.3 1.2.1 1.9 2.2 4.9 3.6 5.5.9.4 1.6.2 1.7-.4"/>',
    document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 17h4.5"/>',
    image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.8" cy="10" r="1.6"/><path d="m3.6 17.5 4.6-4.3a1.6 1.6 0 0 1 2.2 0l3.5 3.3M14 14.6l1.6-1.5a1.6 1.6 0 0 1 2.2 0l2.6 2.4"/>',
    external: '<path d="M13.5 5H19v5.5"/><path d="m18.4 5.6-7.6 7.6"/><path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.6"/>',
    chevron: '<path d="m9.5 6 6 6-6 6"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5M12 8.1v.1"/>',
    alert: '<path d="M12 4.6 2.9 19.4h18.2z"/><path d="M12 10.2v4.1M12 17.1v.1"/>',
    folder: '<path d="M3.5 6.6A1.6 1.6 0 0 1 5.1 5h3.6l2 2.4h8.2a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6z"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 1.8"/>',
    shield: '<path d="M12 3.2 5 6v5.4c0 4 2.9 7.6 7 9.4 4.1-1.8 7-5.4 7-9.4V6z"/><path d="m9.2 12.1 2 2 3.6-3.9"/>',
    lock: '<rect x="4.6" y="10.4" width="14.8" height="9.6" rx="2"/><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6"/>',
    comment: '<path d="M20 13.5a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3.4V6.5A2.5 2.5 0 0 1 7 4h10.5A2.5 2.5 0 0 1 20 6.5z"/>',
    logout: '<path d="M14.5 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6.5a2 2 0 0 0 2-2v-2"/><path d="M20 12H9.5"/><path d="m16.8 8.8 3.2 3.2-3.2 3.2"/>',
    user: '<circle cx="12" cy="8.4" r="3.7"/><path d="M4.8 20a7.4 7.4 0 0 1 14.4 0"/>',
    expand: '<path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5"/>',
    collapse: '<path d="M4.5 9.5h5v-5M19.5 9.5h-5v-5M19.5 14.5h-5v5M4.5 14.5h5v5"/>',
    empty: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z"/><path d="M4 8.5 12 13l8-4.5M12 13v7"/>'
  };
  function icon(name, cls) {
    var d = PATHS[name] || PATHS.document;
    return '<svg class="lib-i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + d + '</svg>';
  }

  // -------------------------------------------------------------- vocabulary
  var TYPES = [
    { key: 'all', label: 'すべて', icon: 'all' },
    { key: 'html', label: 'プレゼンテーション', icon: 'html' },
    { key: 'pdf', label: 'PDF', icon: 'pdf' },
    { key: 'document', label: 'ドキュメント', icon: 'document' },
    { key: 'image', label: '画像', icon: 'image' },
    { key: 'external', label: '外部リンク', icon: 'external' }
  ];
  var TYPE_LABEL = {}, TYPE_ICON = {};
  TYPES.forEach(function (t) { TYPE_LABEL[t.key] = t.label; TYPE_ICON[t.key] = t.icon; });

  function typeOf(f) { return f && f.mediaType ? f.mediaType : 'document'; }
  function typeLabel(k) { return TYPE_LABEL[k] || k; }
  function typeIcon(k) { return TYPE_ICON[k] || 'document'; }

  function fileUrl(id) { return '/.netlify/functions/protected-file?id=' + encodeURIComponent(id); }
  function viewerUrl(id) { return '/customer/media-viewer.html?id=' + encodeURIComponent(id); }

  /** A thumbnail is either a protected record id or a plain URL. Never markup. */
  function thumbUrl(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    if (/^[A-Za-z0-9_-]{1,64}$/.test(s)) return fileUrl(s) + '&inline=1';
    if (/^https:\/\//i.test(s) || s.charAt(0) === '/') return s;
    return '';
  }

  function day(f) { return String((f && (f.updatedAt || f.uploadedAt)) || '').slice(0, 10); }
  function groupOf(f) { return (f && f.group) || 'その他'; }
  function accessLabel(f) {
    if (f.role === 'staff') return 'IDFL STAFF ONLY';
    return 'お客様専用（ログイン必須）';
  }

  // ---------------------------------------------------------------- the shell
  var S = {
    role: 'PUBLIC',
    items: [],
    activeId: '',
    query: '',
    type: 'all',
    collection: '',
    ready: false
  };

  function el(id) { return document.getElementById(id); }
  function loginUrl(next) {
    return '/login.html?role=customer&next=' + encodeURIComponent(next || location.pathname + location.search);
  }

  // Listeners this shell added, so a page can take them all off again.
  var BOUND = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    BOUND.push([target, type, fn, opts]);
  }
  function destroy() {
    BOUND.splice(0).forEach(function (b) { b[0].removeEventListener(b[1], b[2], b[3]); });
  }

  // ------------------------------------------------------------------ toasts
  var toastTimer = null;
  function toast(msg, kind) {
    var t = el('libToast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'lib-toast is-on' + (kind === 'danger' ? ' lib-toast--danger' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'lib-toast' + (kind === 'danger' ? ' lib-toast--danger' : ''); }, 4200);
  }

  // ------------------------------------------------------------- filtering
  function matches(f) {
    if (S.type !== 'all' && typeOf(f) !== S.type) return false;
    if (S.collection && groupOf(f) !== S.collection) return false;
    if (!S.query) return true;
    var q = S.query.toLowerCase();
    return [f.title, f.name, f.group, f.description].some(function (v) {
      return String(v || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  function shownItems() { return S.items.filter(matches); }

  function counts() {
    var c = { all: S.items.length };
    TYPES.forEach(function (t) { if (t.key !== 'all') c[t.key] = 0; });
    S.items.forEach(function (f) { var k = typeOf(f); if (c[k] == null) c[k] = 0; c[k]++; });
    return c;
  }
  function collections() {
    var order = [], seen = {};
    S.items.forEach(function (f) { var g = groupOf(f); if (!seen[g]) { seen[g] = 0; order.push(g); } seen[g]++; });
    return order.map(function (g) { return { name: g, n: seen[g] }; });
  }
  function lastUpdated() {
    var d = '';
    S.items.forEach(function (f) { var x = day(f); if (x > d) d = x; });
    return d;
  }

  // --------------------------------------------------------------- rendering
  function renderTypes() {
    var box = el('libTypes');
    if (!box) return;
    var c = counts();
    box.innerHTML = TYPES.map(function (t) {
      var n = c[t.key] || 0;
      return '<li><button type="button" class="lib-types__btn" data-type="' + esc(t.key) + '"'
        + ' aria-pressed="' + (S.type === t.key ? 'true' : 'false') + '"'
        + (n === 0 && t.key !== 'all' ? ' data-empty="1"' : '')
        + '>' + icon(t.icon) + '<span>' + esc(t.label) + '</span>'
        + '<span class="lib-types__n">' + n + '</span></button></li>';
    }).join('');
  }

  function renderCollections() {
    var box = el('libColl');
    if (!box) return;
    var rows = collections();
    box.innerHTML =
      '<li><button type="button" class="lib-coll__btn" data-coll=""'
      + ' aria-pressed="' + (S.collection ? 'false' : 'true') + '">'
      + '<span class="lib-coll__dot" aria-hidden="true"></span>'
      + '<span>すべてのコレクション</span>'
      + '<span class="lib-coll__n">' + S.items.length + '</span></button></li>'
      + rows.map(function (g) {
        return '<li><button type="button" class="lib-coll__btn" data-coll="' + esc(g.name) + '"'
          + ' aria-pressed="' + (S.collection === g.name ? 'true' : 'false') + '">'
          + '<span class="lib-coll__dot" aria-hidden="true"></span>'
          + '<span>' + esc(g.name) + '</span>'
          + '<span class="lib-coll__n">' + g.n + '</span></button></li>';
      }).join('');
  }

  function renderStats() {
    var box = el('libStats');
    if (!box) return;
    var shown = shownItems().length;
    var d = lastUpdated();
    box.innerHTML =
        '<div><dt>閲覧可能な資料</dt><dd>' + shown + ' <small>/ ' + S.items.length + ' 件</small></dd></div>'
      + '<div><dt>コレクション</dt><dd>' + collections().length + ' <small>件</small></dd></div>'
      + '<div><dt>最終更新</dt><dd>' + (d ? esc(d) : '—') + '</dd></div>';
  }

  function rowHtml(f) {
    var k = typeOf(f);
    var bits = [esc(typeLabel(k))];
    if (f.version) bits.push('Version ' + esc(f.version));
    if (day(f)) bits.push('更新 ' + esc(day(f)));
    if (f.sizeLabel) bits.push(esc(f.sizeLabel));
    var tags = '';
    if (f.role === 'staff') tags += '<span class="lib-tag lib-tag--staff">STAFF ONLY</span>';
    if (f.status === 'draft') tags += '<span class="lib-tag lib-tag--draft">下書き</span>';
    return '<li><button type="button" class="lib-row" data-id="' + esc(f.id) + '" data-type="' + esc(k) + '"'
      + (f.id === S.activeId ? ' aria-current="true"' : '') + '>'
      + '<span class="lib-row__ic">' + icon(typeIcon(k)) + '</span>'
      + '<span><span class="lib-row__t">' + esc(f.title || f.name || '(無題)') + '</span>'
      + '<span class="lib-row__m"><span class="lib-row__mark">● 表示中</span>'
      + '<span class="lib-num">' + bits.join(' <span class="lib-dot" aria-hidden="true">·</span> ') + '</span>'
      + tags + '</span></span>'
      + icon('chevron', 'lib-row__go lib-i-sm') + '</button></li>';
  }

  function renderList() {
    var box = el('libList');
    if (!box) return;
    var shown = shownItems();
    renderStats();

    var scope = '<p class="lib-scope">' + icon('folder', 'lib-i-sm')
      + '<b>' + esc(S.collection || 'すべてのコレクション') + '</b>'
      + '<span>' + esc(S.type === 'all' ? 'すべての種類' : typeLabel(S.type)) + '</span>'
      + '<span class="lib-num">' + shown.length + ' 件</span></p>';

    if (!S.items.length) {
      box.innerHTML = scope + '<div class="lib-msg">' + icon('empty')
        + '<h2>資料はまだありません</h2>'
        + '<p>公開された資料がここに並びます。準備ができ次第、担当者よりご案内します。</p></div>';
      return;
    }
    if (!shown.length) {
      box.innerHTML = scope + '<div class="lib-msg">' + icon('search')
        + '<h2>該当する資料がありません</h2>'
        + '<p>検索語、種類、コレクションの組み合わせをご確認ください。</p>'
        + '<button type="button" class="lib-btn lib-btn--secondary" id="libReset">絞り込みを解除</button></div>';
      var r = el('libReset');
      if (r) r.addEventListener('click', function () { setQuery(''); setType('all'); setCollection(''); });
      return;
    }

    var order = [], map = {};
    shown.forEach(function (f) {
      var g = groupOf(f);
      if (!map[g]) { map[g] = []; order.push(g); }
      map[g].push(f);
    });

    box.innerHTML = scope + order.map(function (g) {
      return '<section class="lib-grp">'
        + '<h2 class="lib-grp__h">' + icon('folder', 'lib-i-sm') + '<span>' + esc(g) + '</span>'
        + '<span class="lib-grp__n">' + map[g].length + ' 件</span></h2>'
        + '<ul class="lib-rows">' + map[g].map(rowHtml).join('') + '</ul></section>';
    }).join('');
  }

  function skeletonList() {
    var box = el('libList');
    if (!box) return;
    var rows = '';
    for (var i = 0; i < 6; i++) rows += '<div class="lib-sk lib-sk--row" style="margin:5px 0;opacity:' + (1 - i * 0.12).toFixed(2) + '"></div>';
    box.innerHTML = '<div class="lib-sk lib-sk--line" style="width:34%;margin:2px 0 14px"></div>'
      + '<div aria-hidden="true">' + rows + '</div>'
      + '<p class="lib-sr-only">資料を読み込んでいます</p>';
  }

  // -------------------------------------------------------------- inspector
  function inspectorEmpty() {
    var box = el('libInsp');
    if (!box) return;
    box.innerHTML = '<div class="lib-insp__pad"><div class="lib-msg">' + icon('all')
      + '<h2>資料を選択してください</h2>'
      + '<p>左の一覧から資料を選ぶと、ここに内容とダウンロードの操作が表示されます。'
      + '選択しただけではダウンロードは始まりません。</p></div></div>';
  }

  function previewHtml(f) {
    var k = typeOf(f);
    var t = thumbUrl(f.thumb);
    if (k === 'image') {
      return '<div class="lib-insp__prev"><img src="' + esc(fileUrl(f.id) + '&inline=1') + '" alt="'
        + esc(f.title || f.name || '画像') + '"></div>';
    }
    if (k === 'pdf') {
      return '<div class="lib-insp__prev"><iframe src="' + esc(fileUrl(f.id) + '&inline=1#toolbar=0')
        + '" title="' + esc((f.title || f.name || 'PDF') + ' のプレビュー') + '" loading="lazy"></iframe></div>';
    }
    if (t) {
      return '<div class="lib-insp__prev"><img src="' + esc(t) + '" alt=""></div>';
    }
    return '<div class="lib-insp__prev">' + icon(typeIcon(k)) + '</div>';
  }

  function renderInspector(f) {
    var box = el('libInsp');
    if (!box) return;
    if (!f) { inspectorEmpty(); return; }
    var k = typeOf(f);

    var tags = '<span class="lib-badge lib-badge--type">' + icon(typeIcon(k), 'lib-i-sm') + esc(typeLabel(k)) + '</span>'
      + (f.role === 'staff'
          ? '<span class="lib-badge lib-badge--staff">' + icon('lock', 'lib-i-sm') + 'IDFL STAFF ONLY</span>'
          : '<span class="lib-badge lib-badge--customer">お客様専用</span>')
      + (f.status === 'draft' ? '<span class="lib-badge lib-badge--draft">下書き</span>' : '')
      + (f.version ? '<span class="lib-badge lib-badge--version lib-num">Version ' + esc(f.version) + '</span>' : '');

    var facts = '';
    facts += '<div><dt>種類</dt><dd>' + esc(typeLabel(k)) + '</dd></div>';
    if (day(f)) facts += '<div><dt>更新日</dt><dd class="lib-num">' + esc(day(f)) + '</dd></div>';
    if (f.sizeLabel) facts += '<div><dt>サイズ</dt><dd class="lib-num">' + esc(f.sizeLabel) + '</dd></div>';
    if (k !== 'external' && k !== 'html' && f.name) facts += '<div><dt>ファイル名</dt><dd>' + esc(f.name) + '</dd></div>';
    if (k === 'html' && f.assetCount) facts += '<div><dt>構成</dt><dd class="lib-num">' + esc(f.assetCount) + ' ファイル</dd></div>';
    facts += '<div><dt>コレクション</dt><dd>' + esc(groupOf(f)) + '</dd></div>';
    facts += '<div><dt>アクセス権限</dt><dd>' + esc(accessLabel(f)) + '</dd></div>';

    var acts = '';
    if (k === 'html') {
      acts += '<a class="lib-btn lib-btn--primary" href="' + esc(viewerUrl(f.id)) + '">' + icon('html') + 'ビューアで開く</a>';
    } else if (k === 'external') {
      acts += '<a class="lib-btn lib-btn--primary" href="' + esc(fileUrl(f.id)) + '" target="_blank" rel="noopener noreferrer">'
        + icon('external') + '外部サイトを開く</a>';
    } else {
      acts += '<button type="button" class="lib-btn lib-btn--primary" data-dl="' + esc(f.id) + '">'
        + icon('download') + 'ダウンロード</button>';
      if (k === 'pdf' || k === 'image') {
        acts += '<a class="lib-btn lib-btn--secondary" href="' + esc(fileUrl(f.id) + '&inline=1') + '" target="_blank" rel="noopener noreferrer">'
          + icon('external') + '別のタブで開く</a>';
      }
    }
    acts += '<a class="lib-btn lib-btn--secondary" href="' + esc(viewerUrl(f.id)) + '">' + icon('comment') + '質問・コメントを送る</a>';

    box.innerHTML = '<div class="lib-insp__pad">'
      + '<button type="button" class="lib-btn lib-btn--quiet lib-btn--icon lib-insp__close" id="libInspClose" aria-label="プレビューを閉じる">'
      + icon('close') + '</button>'
      + previewHtml(f)
      + '<h2 class="lib-insp__t">' + esc(f.title || f.name || '(無題)') + '</h2>'
      + '<div class="lib-insp__tags">' + tags + '</div>'
      + (f.description ? '<p class="lib-insp__desc">' + esc(f.description) + '</p>' : '')
      + '<dl class="lib-facts">' + facts + '</dl>'
      + '<div class="lib-acts">' + acts + '</div>'
      + '<p class="lib-guard">' + icon('shield')
      + '<span>IDFLのお客様専用資料です。アクセスのたびにサーバー側で権限を確認しており、ファイルの直接URLは発行されません。'
      + '第三者への再配布・転載はご遠慮ください。</span></p>'
      + '</div>';

    var c = el('libInspClose');
    if (c) c.addEventListener('click', function () { closeInspector(); });
  }

  // ------------------------------------------------------------- downloading
  // A plain <a download> cannot report progress or failure. Fetching the same
  // protected endpoint can: the session cookie rides along, the server makes
  // the same decision it always did, and the customer gets told when it did
  // not work instead of watching nothing happen.
  function download(id, btn) {
    var f = byId(id);
    if (!f) return;
    var label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); btn.innerHTML = icon('download') + 'ダウンロード中…'; }
    fetch(fileUrl(id), { cache: 'no-store', credentials: 'same-origin' })
      .then(function (res) {
        // A lapsed session is answered with a redirect to the login page, which
        // is a 200 by the time fetch sees it. Catch it rather than saving HTML.
        if (res.redirected && res.url.indexOf('/login.html') >= 0) {
          toast('セッションの有効期限が切れました。ログインし直してください。', 'danger');
          setTimeout(function () { location.replace(loginUrl()); }, 1600);
          return null;
        }
        if (res.status === 403) throw new Error('この資料を取得する権限がありません。');
        if (res.status === 404) throw new Error('この資料は見つかりませんでした。');
        if (!res.ok) throw new Error('ダウンロードに失敗しました（' + res.status + '）。');
        return res.blob();
      })
      .then(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = f.name || (f.title || 'download');
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        toast('ダウンロードを開始しました：' + (f.name || f.title || ''));
      })
      .catch(function (e) {
        toast((e && e.message) || '通信エラーが発生しました。', 'danger');
      })
      .then(function () {
        if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = label; }
      });
  }

  function byId(id) {
    for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i];
    return null;
  }

  // ------------------------------------------------------------------ state
  function syncUrl() {
    if (!S.ready) return;
    var p = new URLSearchParams(location.search);
    if (S.activeId) p.set('id', S.activeId); else p.delete('id');
    if (S.query) p.set('q', S.query); else p.delete('q');
    if (S.type !== 'all') p.set('type', S.type); else p.delete('type');
    if (S.collection) p.set('c', S.collection); else p.delete('c');
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  function setType(t) { S.type = t || 'all'; renderTypes(); renderList(); syncUrl(); }
  function setCollection(c) { S.collection = c || ''; renderCollections(); renderList(); syncUrl(); }
  function setQuery(q) {
    S.query = String(q || '').trim();
    var input = el('libSearch');
    if (input && input.value !== S.query) input.value = S.query;
    var wrap = el('libSearchWrap');
    if (wrap) wrap.classList.toggle('has-value', !!S.query);
    renderList();
    syncUrl();
  }

  var onSelect = null;
  // On a page with no record list of its own (the viewer), choosing a type or
  // a collection has nothing to act on. Rather than leave a dead control,
  // send the reader back to the library with that filter already applied.
  var filtersGoTo = '';
  function filterAway(param, value) {
    var p = new URLSearchParams();
    if (param === 'type' && value && value !== 'all') p.set('type', value);
    if (param === 'c' && value) p.set('c', value);
    if (S.query) p.set('q', S.query);
    var qs = p.toString();
    location.href = filtersGoTo + (qs ? '?' + qs : '');
  }
  function select(id, opts) {
    S.activeId = String(id || '');
    var f = byId(S.activeId);
    document.querySelectorAll('.lib-row').forEach(function (b) {
      if (b.dataset.id === S.activeId) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    renderInspector(f);
    syncUrl();
    if (f && isNarrowInsp() && !(opts && opts.silent)) openInspector();
    if (onSelect) onSelect(f);
  }

  // ------------------------------------------------------- responsive panels
  function isNarrowInsp() { return global.matchMedia && global.matchMedia('(max-width:979px)').matches; }
  function isNarrowRail() { return global.matchMedia && global.matchMedia('(max-width:759px)').matches; }

  var lastRailFocus = null, lastInspFocus = null;
  function railOpen() { return document.body.getAttribute('data-rail') === 'open'; }
  function openRail() {
    if (railOpen()) return;
    lastRailFocus = document.activeElement;
    document.body.setAttribute('data-rail', 'open');
    var t = el('libRailToggle'); if (t) t.setAttribute('aria-expanded', 'true');
    var w = el('libWork'); if (w) w.setAttribute('inert', '');
    var s = el('libSearch'); if (s) setTimeout(function () { s.focus(); }, 60);
  }
  function closeRail(restore) {
    if (!railOpen()) return;
    document.body.removeAttribute('data-rail');
    var t = el('libRailToggle'); if (t) t.setAttribute('aria-expanded', 'false');
    var w = el('libWork'); if (w) w.removeAttribute('inert');
    if (restore !== false && lastRailFocus && lastRailFocus.focus) lastRailFocus.focus();
    lastRailFocus = null;
  }
  function inspOpen() { return document.body.getAttribute('data-insp') === 'open'; }
  function openInspector() {
    if (!isNarrowInsp() || inspOpen()) return;
    lastInspFocus = document.activeElement;
    document.body.setAttribute('data-insp', 'open');
    var c = el('libInspClose'); if (c) setTimeout(function () { c.focus(); }, 60);
  }
  function closeInspector() {
    if (!inspOpen()) return;
    document.body.removeAttribute('data-insp');
    if (lastInspFocus && lastInspFocus.focus) lastInspFocus.focus();
    lastInspFocus = null;
  }

  // ------------------------------------------------------------- fullscreen
  // The real Fullscreen API on the console root. No F11 pantomime, no CSS
  // that merely looks big, and the button always tells the truth about the
  // state the browser is actually in - including after Esc.
  var FS = {
    root: null,
    supported: false,
    init: function () {
      FS.root = el('libApp');
      var btn = el('libFs');
      if (!btn || !FS.root) return;
      FS.supported = !!(FS.root.requestFullscreen || FS.root.webkitRequestFullscreen)
        && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
      if (!FS.supported) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'このブラウザーは全画面表示に対応していません';
        return;
      }
      on(btn, 'click', FS.toggle);
      on(document, 'fullscreenchange', FS.paint);
      on(document, 'webkitfullscreenchange', FS.paint);
      FS.paint();
    },
    active: function () {
      var e = document.fullscreenElement || document.webkitFullscreenElement;
      return !!e && e === FS.root;
    },
    paint: function () {
      var btn = el('libFs');
      if (!btn) return;
      var on_ = FS.active();
      btn.setAttribute('aria-pressed', on_ ? 'true' : 'false');
      btn.innerHTML = icon(on_ ? 'collapse' : 'expand')
        + '<span class="lib-fs-t">' + (on_ ? '全画面を終了' : '全画面表示') + '</span>';
      btn.setAttribute('aria-label', on_ ? '全画面を終了' : '全画面表示');
    },
    toggle: function () {
      if (!FS.supported) return;
      if (FS.active()) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) {
          var p = exit.call(document);
          if (p && p.catch) p.catch(function () { toast('全画面の終了に失敗しました。Esc キーをお試しください。', 'danger'); });
        }
        return;
      }
      var req = FS.root.requestFullscreen || FS.root.webkitRequestFullscreen;
      try {
        var pr = req.call(FS.root, { navigationUI: 'hide' });
        if (pr && pr.catch) {
          pr.catch(function () {
            toast('全画面表示を開始できませんでした。ブラウザーの設定をご確認ください。', 'danger');
            FS.paint();
          });
        }
      } catch (e) {
        toast('全画面表示を開始できませんでした。ブラウザーの設定をご確認ください。', 'danger');
        FS.paint();
      }
    }
  };

  // ------------------------------------------------------------------- wire
  function wire() {
    var search = el('libSearch');
    if (search) {
      on(search, 'input', function () { setQuery(search.value); });
      on(search, 'keydown', function (e) {
        if (e.key === 'Escape' && search.value) { e.stopPropagation(); setQuery(''); }
      });
    }
    var clear = el('libSearchClear');
    if (clear) on(clear, 'click', function () { setQuery(''); if (search) search.focus(); });

    var types = el('libTypes');
    if (types) on(types, 'click', function (e) {
      var b = e.target.closest('.lib-types__btn');
      if (!b) return;
      if (filtersGoTo) { filterAway('type', b.dataset.type); return; }
      setType(b.dataset.type);
      if (isNarrowRail()) closeRail(false);
    });

    var coll = el('libColl');
    if (coll) on(coll, 'click', function (e) {
      var b = e.target.closest('.lib-coll__btn');
      if (!b) return;
      if (filtersGoTo) { filterAway('c', b.dataset.coll); return; }
      setCollection(b.dataset.coll);
      if (isNarrowRail()) closeRail(false);
    });

    var list = el('libList');
    if (list) on(list, 'click', function (e) {
      var row = e.target.closest('.lib-row');
      // Choosing a row switches the inspector. It never starts a download.
      if (row) select(row.dataset.id);
    });

    var insp = el('libInsp');
    if (insp) on(insp, 'click', function (e) {
      var d = e.target.closest('[data-dl]');
      if (d) download(d.getAttribute('data-dl'), d);
    });

    var toggle = el('libRailToggle');
    if (toggle) on(toggle, 'click', function () { railOpen() ? closeRail() : openRail(); });
    var rclose = el('libRailClose');
    if (rclose) on(rclose, 'click', function () { closeRail(); });
    var scrim = el('libScrim');
    if (scrim) on(scrim, 'click', function () { closeRail(); closeInspector(); });

    on(document, 'keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (railOpen()) { e.preventDefault(); closeRail(); return; }
      if (inspOpen()) { e.preventDefault(); closeInspector(); }
    });
    on(global, 'resize', function () {
      if (!isNarrowRail()) closeRail(false);
      if (!isNarrowInsp()) document.body.removeAttribute('data-insp');
    });

    var out = el('libLogout');
    if (out) on(out, 'click', function () {
      out.disabled = true;
      fetch('/.netlify/functions/auth-logout', { method: 'POST' })
        .then(function () { location.replace('/'); })
        .catch(function () { location.replace('/'); });
    });

    // A page that is going away takes its listeners with it.
    on(global, 'pagehide', destroy);

    FS.init();
  }

  function paintRole(role) {
    var b = el('libRole');
    if (b) {
      if (role === 'STAFF') { b.textContent = 'IDFL STAFF'; b.className = 'lib-badge lib-badge--staff'; }
      else { b.textContent = 'お客様専用'; b.className = 'lib-badge lib-badge--customer'; }
      b.hidden = false;
    }
    var u = el('libUser');
    if (u) {
      u.hidden = false;
      u.setAttribute('aria-label', role === 'STAFF' ? 'ログイン中：IDFL STAFF' : 'ログイン中：お客様アカウント');
      u.title = u.getAttribute('aria-label');
    }
    var lo = el('libLogout');
    if (lo) lo.hidden = false;
  }

  function failList(kind) {
    var box = el('libList');
    if (!box) return;
    var body = kind === 'denied'
      ? { i: 'lock', h: 'この資料を表示する権限がありません', p: 'ご担当者にお問い合わせいただくか、別のアカウントでログインしてください。' }
      : { i: 'alert', h: '資料一覧を読み込めませんでした', p: '通信が不安定な可能性があります。しばらくしてから再読み込みしてください。' };
    box.innerHTML = '<div class="lib-msg lib-msg--danger">' + icon(body.i)
      + '<h2>' + body.h + '</h2><p>' + body.p + '</p>'
      + '<button type="button" class="lib-btn lib-btn--secondary" id="libRetry">再読み込み</button></div>';
    var r = el('libRetry');
    if (r) r.addEventListener('click', function () { location.reload(); });
    renderStats();
  }

  /**
   * Bring the console up: check the session, load the records, draw the rail,
   * the list and the inspector.
   */
  function boot(opts) {
    opts = opts || {};
    onSelect = opts.onSelect || null;
    filtersGoTo = opts.filtersGoTo || '';

    var p = new URLSearchParams(location.search);
    S.query = String(p.get('q') || '').trim();
    S.type = String(p.get('type') || 'all');
    if (!TYPE_LABEL[S.type]) S.type = 'all';
    S.collection = String(p.get('c') || '');
    S.activeId = String(opts.activeId != null ? opts.activeId : (p.get('id') || ''));
    if (!/^[A-Za-z0-9_-]{0,64}$/.test(S.activeId)) S.activeId = '';

    var input = el('libSearch');
    if (input) input.value = S.query;
    var wrap = el('libSearchWrap');
    if (wrap) wrap.classList.toggle('has-value', !!S.query);

    wire();
    renderTypes();
    skeletonList();
    if (el('libInsp') && !opts.ownsInspector) inspectorEmpty();

    fetch('/.netlify/functions/auth-status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        S.role = (j && j.role) || 'PUBLIC';
        if (S.role !== 'CUSTOMER' && S.role !== 'STAFF') { location.replace(loginUrl(opts.next)); return null; }
        paintRole(S.role);
        return fetch('/.netlify/functions/protected-list', { cache: 'no-store' })
          .then(function (r) {
            if (r.status === 401) { location.replace(loginUrl(opts.next)); return null; }
            if (r.status === 403) { failList('denied'); return null; }
            return r.json();
          });
      })
      .then(function (j) {
        if (!j) return;
        S.items = (j && j.files) || [];
        S.ready = true;
        renderTypes();
        renderCollections();
        renderList();
        var active = byId(S.activeId);
        if (!active) S.activeId = '';
        if (opts.onReady) opts.onReady({ role: S.role, items: S.items, active: active });
        if (!opts.ownsInspector) {
          renderInspector(active);
          if (active) {
            var cur = document.querySelector('.lib-row[aria-current="true"]');
            if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
          }
        }
        syncUrl();
      })
      .catch(function () {
        failList('error');
        if (opts.onListFail) opts.onListFail();
      });
  }

  global.IDFLLib = {
    esc: esc, icon: icon,
    TYPES: TYPES, typeOf: typeOf, typeLabel: typeLabel, typeIcon: typeIcon,
    fileUrl: fileUrl, viewerUrl: viewerUrl, thumbUrl: thumbUrl,
    day: day, groupOf: groupOf, accessLabel: accessLabel,
    boot: boot, state: S, byId: byId,
    setType: setType, setQuery: setQuery, setCollection: setCollection, select: select,
    download: download, toast: toast,
    openRail: openRail, closeRail: closeRail,
    openInspector: openInspector, closeInspector: closeInspector,
    fullscreen: FS, destroy: destroy,
    renderList: renderList, renderInspector: renderInspector
  };
})(window);
