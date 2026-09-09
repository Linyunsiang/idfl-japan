/* ==========================================================================
   IDFL Media Library — shared shell ("Deep Ocean" console)
   --------------------------------------------------------------------------
   Owns what both customer pages have in common: the session gate, the record
   list, the rail (search, media types, the collections tree), the records
   table, the inspector, the responsive panels, the Fullscreen control, and the
   URL state that survives a reload.

   /customer/media.html        browse and inspect
   /customer/media-viewer.html open one record

   They are separate documents on purpose. The viewer mounts an uploaded
   package in a sandboxed frame under a one-time nonce and talks to it over
   postMessage; none of that belongs on an index page. One shell makes them
   read as one console.

   Nothing here relaxes a security rule. Every string from an API is escaped
   before it reaches innerHTML; protected bytes are only ever reached through
   /.netlify/functions/protected-file, which re-checks the session, the role
   and the draft flag on every request; an external link is opened through that
   function rather than by its own URL; and the STAFF ONLY marking is a label
   on a decision the server already made - protected-list never sends a
   customer a record they may not have.
   ========================================================================== */
(function (global) {
  'use strict';

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
    chevron: '<path d="m6 9.5 6 6 6-6"/>',
    go: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5M12 8.1v.1"/>',
    alert: '<path d="M12 4.6 2.9 19.4h18.2z"/><path d="M12 10.2v4.1M12 17.1v.1"/>',
    folder: '<path d="M3.5 6.6A1.6 1.6 0 0 1 5.1 5h3.6l2 2.4h8.2a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6z"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 1.8"/>',
    shield: '<path d="M12 3.2 5 6v5.4c0 4 2.9 7.6 7 9.4 4.1-1.8 7-5.4 7-9.4V6z"/><path d="m9.2 12.1 2 2 3.6-3.9"/>',
    lock: '<rect x="4.6" y="10.4" width="14.8" height="9.6" rx="2"/><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6"/>',
    comment: '<path d="M20 13.5a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3.4V6.5A2.5 2.5 0 0 1 7 4h10.5A2.5 2.5 0 0 1 20 6.5z"/>',
    user: '<circle cx="12" cy="8.4" r="3.7"/><path d="M4.8 20a7.4 7.4 0 0 1 14.4 0"/>',
    expand: '<path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5"/>',
    collapse: '<path d="M4.5 9.5h5v-5M19.5 9.5h-5v-5M19.5 14.5h-5v5M4.5 14.5h5v5"/>',
    sort: '<path d="M4 7h11M4 12h8M4 17h5"/><path d="M17.5 8.5v9M20.5 14.5l-3 3-3-3"/>',
    more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
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
  var TYPE_LABEL = {}, TYPE_ICON = {}, TYPE_SHORT = {
    html: 'PRESENTATION', pdf: 'PDF', document: 'DOCUMENT', image: 'IMAGE', external: 'EXTERNAL LINK'
  };
  TYPES.forEach(function (t) { TYPE_LABEL[t.key] = t.label; TYPE_ICON[t.key] = t.icon; });

  function typeOf(f) { return f && f.mediaType ? f.mediaType : 'document'; }
  function typeLabel(k) { return TYPE_LABEL[k] || k; }
  function typeShort(k) { return TYPE_SHORT[k] || String(k).toUpperCase(); }
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
  /** 2026-09-09 -> 2026.09.09, the console's own date form. */
  function dot(d) { return String(d || '').replace(/-/g, '.'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function groupOf(f) { return (f && f.group) || 'その他'; }

  /** What the ACCESS column says. External links are public by nature. */
  /** Records the browser renders are for reading, not for taking away. */
  function readOnly(k) { return k === 'pdf' || k === 'image'; }

  function accessKey(f) {
    if (f.role === 'staff') return 'staff';
    if (typeOf(f) === 'external') return 'public';
    return 'customer';
  }
  var ACCESS_LABEL = { staff: 'STAFF ONLY', public: 'PUBLIC', customer: 'CUSTOMER' };
  function accessDetail(f) {
    if (f.role === 'staff') return 'IDFL STAFF ONLY';
    if (typeOf(f) === 'external') return '外部公開（IDFL経由で開きます）';
    return 'お客様専用（ログイン必須）';
  }

  // ---------------------------------------------------------------- the shell
  var S = {
    role: 'PUBLIC', items: [], activeId: '',
    query: '', type: 'all', collection: '', sort: 'updated',
    closed: {}, ready: false
  };

  function el(id) { return document.getElementById(id); }
  function loginUrl(next) {
    return '/login.html?role=customer&next=' + encodeURIComponent(next || location.pathname + location.search);
  }

  var BOUND = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    BOUND.push([target, type, fn, opts]);
  }
  function destroy() {
    BOUND.splice(0).forEach(function (b) { b[0].removeEventListener(b[1], b[2], b[3]); });
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = el('libToast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'lib-toast is-on' + (kind === 'danger' ? ' lib-toast--danger' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.className = 'lib-toast' + (kind === 'danger' ? ' lib-toast--danger' : '');
    }, 4200);
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
  function sorted(list) {
    var out = list.slice();
    if (S.sort === 'name') {
      out.sort(function (a, b) { return String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''), 'ja'); });
    } else {
      out.sort(function (a, b) { return String(day(b)).localeCompare(String(day(a))); });
    }
    return out;
  }
  function shownItems() { return sorted(S.items.filter(matches)); }

  function counts() {
    var c = { all: S.items.length };
    TYPES.forEach(function (t) { if (t.key !== 'all') c[t.key] = 0; });
    S.items.forEach(function (f) { var k = typeOf(f); if (c[k] == null) c[k] = 0; c[k]++; });
    return c;
  }
  function collections() {
    var order = [], map = {};
    S.items.forEach(function (f) {
      var g = groupOf(f);
      if (!map[g]) { map[g] = []; order.push(g); }
      map[g].push(f);
    });
    return order.map(function (g) { return { name: g, items: map[g] }; });
  }
  function lastUpdated() {
    var d = '';
    S.items.forEach(function (f) { var x = day(f); if (x > d) d = x; });
    return d;
  }

  // --------------------------------------------------------------- the rail
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

  function renderTree() {
    var box = el('libTree');
    if (!box) return;
    var groups = collections();
    var label = el('libCollLabel');
    if (label) label.textContent = 'Collections / ' + pad2(groups.length);

    box.innerHTML = groups.map(function (g, i) {
      var open = S.query ? true : !S.closed[g.name];
      var id = 'libtree' + i;
      return '<li class="lib-tree__grp' + (S.collection === g.name ? ' is-on' : '') + '">'
        + '<button type="button" class="lib-tree__btn" data-coll="' + esc(g.name) + '"'
        + ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + id + '">'
        + icon('chevron', 'lib-tree__chev lib-i-sm')
        + '<span>' + esc(g.name) + '</span>'
        + '<span class="lib-tree__n">' + g.items.length + '</span></button>'
        + '<ul class="lib-tree__items" id="' + id + '">'
        + g.items.map(function (f) {
            return '<li><button type="button" class="lib-tree__item" data-id="' + esc(f.id) + '"'
              + (f.id === S.activeId ? ' aria-current="true"' : '')
              + ' title="' + esc(f.title || f.name || '') + '">'
              + esc(f.title || f.name || '(無題)') + '</button></li>';
          }).join('')
        + '</ul></li>';
    }).join('');
  }

  // -------------------------------------------------------------- the stats
  function renderStats() {
    var box = el('libCards');
    if (!box) return;
    var shown = S.items.filter(matches).length;
    box.innerHTML =
        '<div class="lib-card">' + '<span class="lib-card__ic">' + icon('all') + '</span>'
      +   '<span class="lib-card__txt"><dd>' + pad2(shown) + '</dd><dt>閲覧可能な資料</dt></span></div>'
      + '<div class="lib-card">' + '<span class="lib-card__ic">' + icon('folder') + '</span>'
      +   '<span class="lib-card__txt"><dd>' + pad2(collections().length) + '</dd><dt>コレクション</dt></span></div>'
      + '<div class="lib-card">' + '<span class="lib-card__ic">' + icon('clock') + '</span>'
      +   '<span class="lib-card__txt"><dd>' + (lastUpdated() ? esc(dot(lastUpdated())) : '—') + '</dd><dt>最終更新</dt></span></div>';
  }

  // --------------------------------------------------------------- the table
  function rowHtml(f) {
    var k = typeOf(f);
    var a = accessKey(f);
    return '<li><button type="button" class="lib-row" data-id="' + esc(f.id) + '" data-type="' + esc(k) + '"'
      + (f.id === S.activeId ? ' aria-current="true"' : '') + '>'
      + '<span class="lib-row__res">'
      +   '<span class="lib-row__ic">' + icon(typeIcon(k)) + '</span>'
      +   '<span><span class="lib-row__t" title="' + esc(f.title || f.name || '(無題)') + '">'
      +     esc(f.title || f.name || '(無題)') + '</span>'
      +   '<span class="lib-row__m"><span class="lib-row__mark">● 表示中 </span>'
      +     esc(typeShort(k)) + ' <span class="lib-sep" aria-hidden="true">・</span> ' + esc(groupOf(f))
      +     (f.status === 'draft' ? ' <span class="lib-sep" aria-hidden="true">・</span> 下書き' : '')
      +   '</span></span>'
      + '</span>'
      + '<span><span class="lib-access lib-access--' + a + '">' + esc(ACCESS_LABEL[a]) + '</span></span>'
      + '<span class="lib-row__when">' + esc(dot(day(f))) + '</span>'
      + '<span class="lib-row__go">開く' + icon('go', 'lib-i-sm') + '</span>'
      + '</button></li>';
  }

  function renderList() {
    var box = el('libList');
    if (!box) return;
    renderStats();
    var shown = shownItems();

    var title = S.collection ? S.collection
      : (S.query ? '検索結果'
      : (S.type !== 'all' ? typeLabel(S.type) : '最近更新された資料'));
    var sub = shown.length + '件を表示中 ・ ' + (S.sort === 'name' ? '名前順' : '更新日の新しい順');
    var head = el('libListHead');
    if (head) {
      head.innerHTML = '<div><h2>' + esc(title) + '</h2><p>' + esc(sub) + '</p>'
        + '<p class="lib-listhint">' + icon('go', 'lib-i-sm')
        + '行をダブルクリック（または「開く」）で資料を開きます。</p></div>'
        + '<span class="lib-bar__grow"></span>'
        + '<button type="button" class="lib-btn lib-btn--secondary" id="libSort" aria-label="並び順を切り替える">'
        + icon('sort', 'lib-i-sm') + (S.sort === 'name' ? '名前順' : '更新順') + '</button>';
      var sb = el('libSort');
      if (sb) sb.addEventListener('click', function () {
        S.sort = S.sort === 'name' ? 'updated' : 'name';
        renderList();
      });
    }

    if (!S.items.length) {
      box.innerHTML = '<div class="lib-msg">' + icon('empty')
        + '<h2>資料はまだありません</h2>'
        + '<p>公開された資料がここに並びます。準備ができ次第、担当者よりご案内します。</p></div>';
      return;
    }
    if (!shown.length) {
      box.innerHTML = '<div class="lib-msg">' + icon('search')
        + '<h2>該当する資料がありません</h2>'
        + '<p>検索語、種類、コレクションの組み合わせをご確認ください。</p>'
        + '<button type="button" class="lib-btn lib-btn--secondary" id="libReset">絞り込みを解除</button></div>';
      var r = el('libReset');
      if (r) r.addEventListener('click', function () { setQuery(''); setType('all'); setCollection(''); });
      return;
    }

    box.innerHTML =
        '<div class="lib-thead" aria-hidden="true"><span>Resource</span><span>Access</span><span>Updated</span><span></span></div>'
      + '<ul class="lib-rows">' + shown.map(rowHtml).join('') + '</ul>';
  }

  function skeletonList() {
    var box = el('libList');
    if (!box) return;
    var rows = '';
    for (var i = 0; i < 5; i++) rows += '<div class="lib-sk lib-sk--row" style="opacity:' + (1 - i * 0.13).toFixed(2) + '"></div>';
    box.innerHTML = '<div aria-hidden="true">' + rows + '</div><p class="lib-sr-only">資料を読み込んでいます</p>';
  }

  // ------------------------------------------------------------- inspector
  function inspectorEmpty() {
    var box = el('libInsp');
    if (!box) return;
    box.innerHTML = '<div class="lib-insp__pad">'
      + '<p class="lib-insp__head"><span class="lib-dot" aria-hidden="true"></span>'
      + '<span class="lib-eyelabel">Selected resource</span></p>'
      + '<div class="lib-msg">' + icon('all')
      + '<h2>資料を選択してください</h2>'
      + '<p>一覧から資料を選ぶと、ここに内容と操作が表示されます。'
      + 'ダブルクリックすると、そのまま開きます。</p></div></div>';
  }

  /** The real thing where there is one; the record's own name on a sheet where
      there is not. Never invented content. */
  function previewHtml(f) {
    var k = typeOf(f);
    var t = thumbUrl(f.thumb);
    if (k === 'image') {
      return '<div class="lib-canvas"><img src="' + esc(fileUrl(f.id) + '&inline=1') + '" alt="'
        + esc(f.title || f.name || '画像') + '"></div>';
    }
    if (k === 'pdf') {
      return '<div class="lib-canvas"><iframe src="' + esc(fileUrl(f.id) + '&inline=1#toolbar=0&view=FitH')
        + '" title="' + esc((f.title || f.name || 'PDF') + ' のプレビュー') + '" loading="lazy"></iframe></div>';
    }
    if (t) return '<div class="lib-canvas"><img src="' + esc(t) + '" alt=""></div>';
    return '<div class="lib-canvas"><div class="lib-sheet">'
      + '<div class="lib-sheet__top"><img src="/IDFL-Logo.png" alt=""><span>IDFL JAPAN</span></div>'
      + '<div class="lib-sheet__rule"></div>'
      + '<p class="lib-sheet__t">' + esc(f.title || f.name || '') + '</p>'
      + '<div class="lib-sheet__lines"><i></i><i></i><i></i></div>'
      + '</div></div>';
  }

  function renderInspector(f) {
    var box = el('libInsp');
    if (!box) return;
    if (!f) { inspectorEmpty(); return; }
    var k = typeOf(f);

    var meta = esc(typeShort(k))
      + (day(f) ? ' <span class="lib-sep" aria-hidden="true">•</span> 更新 ' + esc(dot(day(f))) : '')
      + (f.version ? ' <span class="lib-sep" aria-hidden="true">•</span> Version ' + esc(f.version) : '');

    var facts = '<div><dt>アクセス</dt><dd>' + esc(ACCESS_LABEL[accessKey(f)]) + '</dd></div>'
      + '<div><dt>ステータス</dt><dd>' + (f.status === 'draft' ? '下書き（STAFFのみ）' : '閲覧可能') + '</dd></div>';
    var more = [];
    if (f.sizeLabel) more.push('<div><dt>サイズ</dt><dd class="lib-num">' + esc(f.sizeLabel) + '</dd></div>');
    more.push('<div><dt>コレクション</dt><dd>' + esc(groupOf(f)) + '</dd></div>');
    if (k !== 'external' && k !== 'html' && f.name) {
      more.push('<div><dt>ファイル名</dt><dd>' + esc(f.name) + '</dd></div>');
    }
    if (k === 'html' && f.assetCount) {
      more.push('<div><dt>構成</dt><dd class="lib-num">' + esc(f.assetCount) + ' ファイル</dd></div>');
    }

    // A record the browser can render is for reading here; only a record it
    // cannot render is handed over as a file. protected-file enforces the same
    // rule, so this is the affordance for a decision, not the decision itself.
    var primary, menu = [];
    if (k === 'html') {
      primary = '<a class="lib-btn lib-btn--primary" href="' + esc(viewerUrl(f.id)) + '">' + icon('html') + 'ビューアで開く</a>';
    } else if (k === 'external') {
      primary = '<a class="lib-btn lib-btn--primary" href="' + esc(fileUrl(f.id)) + '" target="_blank" rel="noopener noreferrer">'
        + icon('external') + '外部サイトを開く</a>';
    } else if (readOnly(k)) {
      primary = '<a class="lib-btn lib-btn--primary" href="' + esc(fileUrl(f.id) + '&inline=1') + '" target="_blank" rel="noopener noreferrer">'
        + icon('external') + '大きく表示する</a>';
    } else {
      primary = '<button type="button" class="lib-btn lib-btn--primary" data-dl="' + esc(f.id) + '">'
        + icon('download') + 'ダウンロード</button>';
    }
    menu.push('<a href="' + esc(viewerUrl(f.id)) + '">' + icon('comment') + '質問・コメントを送る</a>');
    if (k !== 'html' && k !== 'external') {
      menu.push('<a href="' + esc(viewerUrl(f.id)) + '">' + icon(typeIcon(k)) + 'ビューアで開く</a>');
    }

    box.innerHTML = '<div class="lib-insp__pad">'
      + '<p class="lib-insp__head"><span class="lib-dot" aria-hidden="true"></span>'
      + '<span class="lib-eyelabel">Selected resource</span>'
      + '<button type="button" class="lib-btn lib-btn--quiet lib-btn--icon lib-insp__close" id="libInspClose" aria-label="プレビューを閉じる">'
      + icon('close') + '</button></p>'
      + previewHtml(f)
      + '<h2 class="lib-insp__t">' + esc(f.title || f.name || '(無題)') + '</h2>'
      + '<p class="lib-insp__m">' + meta + '</p>'
      + (f.description ? '<p class="lib-insp__desc">' + esc(f.description) + '</p>' : '')
      + '<dl class="lib-facts">' + facts + '</dl>'
      + '<dl class="lib-facts lib-facts--wide">' + more.join('') + '</dl>'
      + '<div class="lib-acts">' + primary
      +   '<span class="lib-menu" id="libMenu">'
      +     '<button type="button" class="lib-btn lib-btn--secondary lib-more" id="libMoreBtn"'
      +     ' aria-haspopup="true" aria-expanded="false" aria-label="その他の操作">' + icon('more') + '</button>'
      +     '<span class="lib-menu__pop" role="menu">' + menu.join('') + '</span>'
      +   '</span>'
      + '</div>'
      + '<p class="lib-guard">' + icon('shield')
      + '<span>IDFLのお客様専用資料です。アクセスのたびにサーバー側で権限を確認しており、'
      + 'ファイルの直接URLは発行されません。'
      + (readOnly(k) ? 'この資料は閲覧のみで、ダウンロードはできません。' : '')
      + '第三者への再配布はご遠慮ください。</span></p>'
      + '</div>';

    var c = el('libInspClose');
    if (c) c.addEventListener('click', function () { closeInspector(); });
    var mb = el('libMoreBtn'), mw = el('libMenu');
    if (mb && mw) {
      mb.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = mw.classList.toggle('is-open');
        mb.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
  }

  // ------------------------------------------------------------- downloading
  // A plain <a download> cannot report progress or failure. Fetching the same
  // protected endpoint can: the session cookie rides along, the server makes
  // the same decision it always did, and the customer is told when it did not
  // work instead of watching nothing happen.
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
      .catch(function (e) { toast((e && e.message) || '通信エラーが発生しました。', 'danger'); })
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
  function setCollection(c) { S.collection = c || ''; renderTree(); renderList(); syncUrl(); }
  function setQuery(q) {
    S.query = String(q || '').trim();
    ['libSearch', 'libGSearch'].forEach(function (id) {
      var i = el(id);
      if (i && i.value !== S.query) i.value = S.query;
    });
    var w = el('libSearchWrap');
    if (w) w.classList.toggle('has-value', !!S.query);
    renderTree();
    renderList();
    syncUrl();
  }

  var onSelect = null;
  // On a page with no records table of its own (the viewer), choosing a type
  // or a collection has nothing to act on. Rather than leave a dead control,
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

  // Opening a record means the viewer, which is where reading, the feedback
  // drawer and the security headers all live. A link is the one record that
  // lives somewhere else, so it opens there.
  function openRecord(id) {
    var f = byId(id);
    if (!f) return;
    if (typeOf(f) === 'external') { global.open(fileUrl(f.id), '_blank', 'noopener'); return; }
    location.href = viewerUrl(f.id);
  }

  function select(id, opts) {
    S.activeId = String(id || '');
    var f = byId(S.activeId);
    document.querySelectorAll('.lib-row,.lib-tree__item').forEach(function (b) {
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
  // The real Fullscreen API on the console root. No F11 pantomime, no CSS that
  // merely looks big, and the button always tells the truth about the state the
  // browser is actually in - including after Esc, which leaves through the same
  // fullscreenchange event the button listens to.
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
    ['libSearch', 'libGSearch'].forEach(function (id) {
      var input = el(id);
      if (!input) return;
      on(input, 'input', function () { setQuery(input.value); });
      on(input, 'keydown', function (e) {
        if (e.key === 'Escape' && input.value) { e.stopPropagation(); setQuery(''); }
      });
    });
    var clear = el('libSearchClear');
    if (clear) on(clear, 'click', function () { setQuery(''); var s = el('libSearch'); if (s) s.focus(); });

    // Cmd/Ctrl-K puts the cursor in the search box, as the hint promises.
    on(document, 'keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
        var g = el('libGSearch') || el('libSearch');
        if (g) { e.preventDefault(); g.focus(); g.select(); }
      }
    });

    var types = el('libTypes');
    if (types) on(types, 'click', function (e) {
      var b = e.target.closest('.lib-types__btn');
      if (!b) return;
      if (filtersGoTo) { filterAway('type', b.dataset.type); return; }
      setType(b.dataset.type);
      if (isNarrowRail()) closeRail(false);
    });

    var tree = el('libTree');
    if (tree) on(tree, 'click', function (e) {
      var item = e.target.closest('.lib-tree__item');
      if (item) {
        if (filtersGoTo) { location.href = viewerUrl(item.dataset.id); return; }
        if (item.getAttribute('aria-current') === 'true') { openRecord(item.dataset.id); return; }
        select(item.dataset.id);
        if (isNarrowRail()) closeRail(false);
        return;
      }
      var g = e.target.closest('.lib-tree__btn');
      if (!g) return;
      var name = g.dataset.coll;
      // A group header both opens the group and scopes the table to it. A
      // second press on the scoped group releases the scope.
      if (S.collection === name) {
        S.closed[name] = !S.closed[name];
        g.setAttribute('aria-expanded', S.closed[name] ? 'false' : 'true');
        if (S.closed[name]) { if (filtersGoTo) { filterAway('c', ''); return; } setCollection(''); }
        return;
      }
      S.closed[name] = false;
      if (filtersGoTo) { filterAway('c', name); return; }
      setCollection(name);
      if (isNarrowRail()) closeRail(false);
    });

    var list = el('libList');
    if (list) on(list, 'click', function (e) {
      var row = e.target.closest('.lib-row');
      if (!row) return;
      // Pressing the row's own "open" opens it outright. Otherwise the first
      // press shows the record and a second press on the one already shown
      // opens it - which is what makes a double-click work with no timer, and
      // gives a keyboard or touch user the same way in. Opening still never
      // starts a download; that remains its own deliberate action.
      if (e.target.closest('.lib-row__go') || row.getAttribute('aria-current') === 'true') {
        openRecord(row.dataset.id);
        return;
      }
      select(row.dataset.id);
    });

    var insp = el('libInsp');
    if (insp) on(insp, 'click', function (e) {
      var d = e.target.closest('[data-dl]');
      if (d) download(d.getAttribute('data-dl'), d);
    });

    // A menu closes when the next click lands anywhere else.
    on(document, 'click', function () {
      var m = el('libMenu');
      if (m && m.classList.contains('is-open')) {
        m.classList.remove('is-open');
        var b = el('libMoreBtn');
        if (b) b.setAttribute('aria-expanded', 'false');
      }
    });

    var toggle = el('libRailToggle');
    if (toggle) on(toggle, 'click', function () { railOpen() ? closeRail() : openRail(); });
    var rclose = el('libRailClose');
    if (rclose) on(rclose, 'click', function () { closeRail(); });
    var scrim = el('libScrim');
    if (scrim) on(scrim, 'click', function () { closeRail(); closeInspector(); });

    on(document, 'keydown', function (e) {
      if (e.key !== 'Escape') return;
      var m = el('libMenu');
      if (m && m.classList.contains('is-open')) { m.classList.remove('is-open'); return; }
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
      if (role === 'STAFF') { b.textContent = 'IDFL STAFF'; b.className = 'lib-pill lib-pill--staff'; }
      else { b.textContent = 'お客様専用'; b.className = 'lib-pill lib-pill--customer'; }
      b.hidden = false;
    }
    var u = el('libUser');
    if (u) {
      u.hidden = false;
      var t = role === 'STAFF' ? 'ログイン中：IDFL STAFF' : 'ログイン中：お客様アカウント';
      u.setAttribute('aria-label', t);
      u.title = t;
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

    ['libSearch', 'libGSearch'].forEach(function (id) { var i = el(id); if (i) i.value = S.query; });
    var w = el('libSearchWrap');
    if (w) w.classList.toggle('has-value', !!S.query);

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
        renderTree();
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
    TYPES: TYPES, typeOf: typeOf, typeLabel: typeLabel, typeShort: typeShort, typeIcon: typeIcon,
    fileUrl: fileUrl, viewerUrl: viewerUrl, thumbUrl: thumbUrl, openRecord: openRecord,
    day: day, dot: dot, groupOf: groupOf, accessKey: accessKey, accessDetail: accessDetail,
    boot: boot, state: S, byId: byId,
    setType: setType, setQuery: setQuery, setCollection: setCollection, select: select,
    download: download, toast: toast,
    openRail: openRail, closeRail: closeRail,
    openInspector: openInspector, closeInspector: closeInspector,
    fullscreen: FS, destroy: destroy,
    renderList: renderList, renderInspector: renderInspector, renderTree: renderTree
  };
})(window);
