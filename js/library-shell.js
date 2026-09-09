/* ==========================================================================
   IDFL Media Library — shared shell
   --------------------------------------------------------------------------
   Owns everything both customer pages have in common: the session gate, the
   record list, the rail (search, type filters, groups, items), the drawer
   behaviour on small screens, and the URL state that survives a reload.

   /customer/media.html        the library, with the overview in the pane
   /customer/media-viewer.html one record, with the pane showing it

   They are separate documents on purpose. The viewer mounts an uploaded
   package in a sandboxed frame under a one-time nonce and talks to it over
   postMessage; none of that belongs on an index page. Wearing the same shell
   is what makes them read as one system.

   Nothing here relaxes a security rule. Every string that comes back from an
   API is escaped before it reaches innerHTML, protected bytes are still only
   ever reached through /.netlify/functions/protected-file, and an external
   link is opened through that function rather than by its own URL.
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
    chevron: '<path d="m6 9.5 6 6 6-6"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5M12 8.1v.1"/>',
    alert: '<path d="M12 4.6 2.9 19.4h18.2z"/><path d="M12 10.2v4.1M12 17.1v.1"/>',
    folder: '<path d="M3.5 6.6A1.6 1.6 0 0 1 5.1 5h3.6l2 2.4h8.2a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6z"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 1.8"/>',
    shield: '<path d="M12 3.2 5 6v5.4c0 4 2.9 7.6 7 9.4 4.1-1.8 7-5.4 7-9.4V6z"/><path d="m9.2 12.1 2 2 3.6-3.9"/>',
    back: '<path d="M19 12H5"/><path d="m10.5 6.5-5.5 5.5 5.5 5.5"/>',
    comment: '<path d="M20 13.5a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3.4V6.5A2.5 2.5 0 0 1 7 4h10.5A2.5 2.5 0 0 1 20 6.5z"/>',
    logout: '<path d="M14.5 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6.5a2 2 0 0 0 2-2v-2"/><path d="M20 12H9.5"/><path d="m16.8 8.8 3.2 3.2-3.2 3.2"/>',
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

  /** A thumbnail is either a protected record id or a plain URL. Never raw HTML. */
  function thumbUrl(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    if (/^[A-Za-z0-9_-]{1,64}$/.test(s)) return fileUrl(s) + '&inline=1';
    if (/^https:\/\//i.test(s) || s.charAt(0) === '/') return s;
    return '';
  }

  function day(f) { return String((f && (f.updatedAt || f.uploadedAt)) || '').slice(0, 10); }
  function groupOf(f) { return (f && f.group) || 'その他'; }

  // ---------------------------------------------------------------- the shell
  var S = {
    role: 'PUBLIC',
    items: [],
    activeId: '',
    query: '',
    type: 'all',
    collapsed: {},
    ready: false
  };

  var COLLAPSE_KEY = 'idflLibClosedGroups';
  function loadCollapsed() {
    try {
      var v = JSON.parse(sessionStorage.getItem(COLLAPSE_KEY) || '{}');
      if (v && typeof v === 'object') S.collapsed = v;
    } catch (e) { /* a private window is not an error */ }
  }
  function saveCollapsed() {
    try { sessionStorage.setItem(COLLAPSE_KEY, JSON.stringify(S.collapsed)); } catch (e) {}
  }

  function el(id) { return document.getElementById(id); }

  function loginUrl(next) {
    return '/login.html?role=customer&next=' + encodeURIComponent(next || location.pathname + location.search);
  }

  /** Carry the rail's state across a navigation so the library stays put. */
  function railParams() {
    var p = [];
    if (S.query) p.push('q=' + encodeURIComponent(S.query));
    if (S.type !== 'all') p.push('type=' + encodeURIComponent(S.type));
    return p.length ? '&' + p.join('&') : '';
  }

  function matches(f) {
    if (S.type !== 'all' && typeOf(f) !== S.type) return false;
    if (!S.query) return true;
    var q = S.query.toLowerCase();
    return [f.title, f.name, f.group, f.description].some(function (v) {
      return String(v || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function counts() {
    var c = { all: S.items.length };
    TYPES.forEach(function (t) { if (t.key !== 'all') c[t.key] = 0; });
    S.items.forEach(function (f) {
      var k = typeOf(f);
      if (c[k] == null) c[k] = 0;
      c[k]++;
    });
    return c;
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
        + '>' + icon(t.icon)
        + '<span>' + esc(t.label) + '</span>'
        + '<span class="lib-types__n">' + n + '</span></button></li>';
    }).join('');
  }

  function renderScope(shown) {
    var box = el('libScope');
    if (!box) return;
    var label = S.type === 'all' ? 'すべての資料' : typeLabel(S.type);
    box.innerHTML = icon('folder', 'lib-i-sm')
      + '<span><b>' + esc(label) + '</b></span>'
      + '<span>' + shown + ' 件' + (shown !== S.items.length ? '（全 ' + S.items.length + ' 件中）' : '') + '</span>';
  }

  function itemHtml(f) {
    var k = typeOf(f);
    var active = f.id === S.activeId;
    var bits = [];
    if (f.version) bits.push('v' + esc(f.version));
    if (f.status === 'draft') bits.push('下書き');
    if (f.role === 'staff') bits.push('STAFF');
    return '<li><a class="lib-item" href="' + viewerUrl(f.id) + railParams() + '"'
      + ' data-id="' + esc(f.id) + '" data-type="' + esc(k) + '"'
      + (active ? ' aria-current="true"' : '') + '>'
      + icon(typeIcon(k))
      + '<span><span class="lib-item__t">' + esc(f.title || f.name || '(無題)') + '</span>'
      + '<span class="lib-item__meta"><span class="lib-item__mark" aria-hidden="true">● 表示中 ·</span>'
      + '<span class="lib-num">' + esc(typeLabel(k)) + (bits.length ? ' · ' + esc(bits.join(' · ')) : '') + '</span>'
      + '</span></span></a></li>';
  }

  function renderList() {
    var box = el('libList');
    if (!box) return;
    var shown = S.items.filter(matches);
    renderScope(shown.length);

    if (!S.items.length) {
      box.innerHTML = '<div class="lib-msg">' + icon('empty')
        + '<h2>資料はまだありません</h2>'
        + '<p>公開された資料がここに並びます。準備ができ次第、担当者からご案内します。</p></div>';
      return;
    }
    if (!shown.length) {
      box.innerHTML = '<div class="lib-msg">' + icon('search')
        + '<h2>該当する資料がありません</h2>'
        + '<p>検索語や種類の絞り込みを変えてお試しください。</p>'
        + '<button type="button" class="lib-btn lib-btn--secondary" id="libReset">絞り込みを解除</button></div>';
      var r = el('libReset');
      if (r) r.addEventListener('click', function () { setQuery(''); setType('all'); });
      return;
    }

    var order = [], map = {};
    shown.forEach(function (f) {
      var g = groupOf(f);
      if (!map[g]) { map[g] = []; order.push(g); }
      map[g].push(f);
    });

    box.innerHTML = order.map(function (g, i) {
      // A search is a request to see what matched; never hide it behind a
      // collapsed group.
      var open = S.query ? true : !S.collapsed[g];
      var id = 'libg' + i;
      return '<section class="lib-group">'
        + '<button type="button" class="lib-group__btn" data-group="' + esc(g) + '"'
        + ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + id + '">'
        + icon('chevron', 'lib-group__chev lib-i-sm')
        + '<span>' + esc(g) + '</span>'
        + '<span class="lib-group__n">' + map[g].length + '</span></button>'
        + '<ul class="lib-group__items" id="' + id + '">' + map[g].map(itemHtml).join('') + '</ul>'
        + '</section>';
    }).join('');
  }

  function skeletonRail() {
    var box = el('libList');
    if (!box) return;
    var rows = '';
    for (var i = 0; i < 7; i++) rows += '<div class="lib-sk lib-sk--row" style="opacity:' + (1 - i * 0.1).toFixed(2) + '"></div>';
    box.innerHTML = '<div aria-hidden="true" style="padding:6px 2px">' + rows + '</div>'
      + '<p class="lib-sr-only">資料を読み込んでいます</p>';
  }

  // ------------------------------------------------------------------ state
  function setType(t) {
    S.type = t || 'all';
    renderTypes();
    renderList();
    syncUrl();
  }
  function setQuery(q) {
    S.query = String(q || '').trim();
    var input = el('libSearch');
    if (input && input.value !== q) input.value = S.query;
    var wrap = el('libSearchWrap');
    if (wrap) wrap.classList.toggle('has-value', !!S.query);
    renderList();
    syncUrl();
  }

  /** Keep q/type in the address bar so a reload lands in the same place. */
  function syncUrl() {
    if (!S.ready) return;
    var p = new URLSearchParams(location.search);
    if (S.query) p.set('q', S.query); else p.delete('q');
    if (S.type !== 'all') p.set('type', S.type); else p.delete('type');
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  // ------------------------------------------------------------ rail drawer
  var lastFocus = null;
  function railOpen() { return document.body.getAttribute('data-rail') === 'open'; }
  function openRail() {
    if (railOpen()) return;
    lastFocus = document.activeElement;
    document.body.setAttribute('data-rail', 'open');
    var t = el('libRailToggle'); if (t) t.setAttribute('aria-expanded', 'true');
    var main = el('libMain'); if (main) main.setAttribute('inert', '');
    var head = el('libHeadBar'); if (head) head.setAttribute('inert', '');
    var s = el('libSearch'); if (s) setTimeout(function () { s.focus(); }, 60);
  }
  function closeRail(restore) {
    if (!railOpen()) return;
    document.body.removeAttribute('data-rail');
    var t = el('libRailToggle'); if (t) t.setAttribute('aria-expanded', 'false');
    var main = el('libMain'); if (main) main.removeAttribute('inert');
    var head = el('libHeadBar'); if (head) head.removeAttribute('inert');
    if (restore !== false && lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }
  function isNarrow() { return global.matchMedia && global.matchMedia('(max-width:1024px)').matches; }

  // ------------------------------------------------------------------- wire
  function wire() {
    var search = el('libSearch');
    if (search) {
      search.addEventListener('input', function () { setQuery(search.value); });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && search.value) { e.stopPropagation(); setQuery(''); }
      });
    }
    var clear = el('libSearchClear');
    if (clear) clear.addEventListener('click', function () { setQuery(''); search && search.focus(); });

    var types = el('libTypes');
    if (types) types.addEventListener('click', function (e) {
      var b = e.target.closest('.lib-types__btn');
      if (b) setType(b.dataset.type);
    });

    var list = el('libList');
    if (list) list.addEventListener('click', function (e) {
      var g = e.target.closest('.lib-group__btn');
      if (g) {
        var name = g.dataset.group;
        S.collapsed[name] = !(S.collapsed[name]);
        saveCollapsed();
        g.setAttribute('aria-expanded', S.collapsed[name] ? 'false' : 'true');
        return;
      }
      // Choosing a record on a phone should show the record, not the list.
      if (e.target.closest('.lib-item') && isNarrow()) closeRail(false);
    });

    var toggle = el('libRailToggle');
    if (toggle) toggle.addEventListener('click', function () { railOpen() ? closeRail() : openRail(); });
    var close = el('libRailClose');
    if (close) close.addEventListener('click', function () { closeRail(); });
    var scrim = el('libScrim');
    if (scrim) scrim.addEventListener('click', function () { closeRail(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && railOpen()) { e.preventDefault(); closeRail(); }
    });
    global.addEventListener('resize', function () { if (!isNarrow()) closeRail(false); });

    var out = el('libLogout');
    if (out) out.addEventListener('click', function () {
      out.disabled = true;
      fetch('/.netlify/functions/auth-logout', { method: 'POST' })
        .then(function () { location.replace('/'); })
        .catch(function () { location.replace('/'); });
    });
  }

  function paintRole(role) {
    var b = el('libRole');
    if (!b) return;
    if (role === 'STAFF') { b.textContent = 'IDFL STAFF'; b.className = 'lib-badge lib-badge--staff'; }
    else { b.textContent = 'お客様専用'; b.className = 'lib-badge lib-badge--customer'; }
    b.hidden = false;
  }

  /**
   * Bring the shell up: check the session, load the records, draw the rail.
   * opts.activeId   record to mark as current, if any
   * opts.onReady    ({role, items, active}) once both calls have succeeded
   * opts.onListFail (message) when the records cannot be read
   */
  function boot(opts) {
    opts = opts || {};
    loadCollapsed();

    var p = new URLSearchParams(location.search);
    S.query = String(p.get('q') || '').trim();
    S.type = String(p.get('type') || 'all');
    if (!TYPE_LABEL[S.type]) S.type = 'all';
    S.activeId = String(opts.activeId || '');

    var input = el('libSearch');
    if (input) input.value = S.query;
    var wrap = el('libSearchWrap');
    if (wrap) wrap.classList.toggle('has-value', !!S.query);

    wire();
    renderTypes();
    skeletonRail();

    fetch('/.netlify/functions/auth-status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        S.role = (j && j.role) || 'PUBLIC';
        if (S.role !== 'CUSTOMER' && S.role !== 'STAFF') { location.replace(loginUrl(opts.next)); return null; }
        paintRole(S.role);
        var lo = el('libLogout'); if (lo) lo.hidden = false;
        return fetch('/.netlify/functions/protected-list', { cache: 'no-store' })
          .then(function (r) {
            if (r.status === 401 || r.status === 403) { location.replace(loginUrl(opts.next)); return null; }
            return r.json();
          });
      })
      .then(function (j) {
        if (!j) return;
        S.items = (j && j.files) || [];
        S.ready = true;
        renderTypes();
        renderList();
        var active = null;
        for (var i = 0; i < S.items.length; i++) if (S.items[i].id === S.activeId) { active = S.items[i]; break; }
        // On a long list the record being read can sit far below the fold.
        // Bring it into view without animating the whole rail past the reader.
        if (active) {
          var cur = document.querySelector('.lib-item[aria-current="true"]');
          if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
        }
        if (opts.onReady) opts.onReady({ role: S.role, items: S.items, active: active });
      })
      .catch(function () {
        var box = el('libList');
        if (box) {
          box.innerHTML = '<div class="lib-msg">' + icon('alert')
            + '<h2>資料一覧を読み込めませんでした</h2>'
            + '<p>通信が不安定な可能性があります。ページを再読み込みしてください。</p>'
            + '<button type="button" class="lib-btn lib-btn--secondary" onclick="location.reload()">再読み込み</button></div>';
        }
        renderScope(0);
        if (opts.onListFail) opts.onListFail();
      });
  }

  global.IDFLLib = {
    esc: esc, icon: icon,
    TYPES: TYPES, typeOf: typeOf, typeLabel: typeLabel, typeIcon: typeIcon,
    fileUrl: fileUrl, viewerUrl: viewerUrl, thumbUrl: thumbUrl,
    day: day, groupOf: groupOf,
    boot: boot, state: S,
    setType: setType, setQuery: setQuery,
    closeRail: closeRail, railParams: railParams
  };
})(window);
