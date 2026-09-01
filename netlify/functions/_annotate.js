// ============================================================
// IDFL - annotation agent injected into a protected HTML presentation.
//
// WHY an injected agent rather than the parent reaching into the iframe:
// the presentation runs in a sandbox WITHOUT allow-same-origin, so it has an
// opaque origin and the viewer cannot touch its DOM at all. Pins therefore have
// to be drawn from inside, and the two sides talk over postMessage.
//
// The agent must be completely self-contained: it is shipped by stringifying
// `agentMain`, so it may not reference anything from this module's scope.
// It receives no secrets - only pin numbers, anchors and a nonce.
// ============================================================

function agentMain(w, d){
  'use strict';
  var TAG = '__idflfb';
  // The mount is /media/<id>/<token>/f-<nonce>/<entry>. Reading the nonce from
  // the path (not the query) keeps it intact when the deck rewrites ?lang=...
  var nonce = '';
  try{
    var segs = String(w.location.pathname || '').split('/');
    for(var si = 0; si < segs.length; si++){
      var mm = /^f-([A-Za-z0-9_-]{8,64})$/.exec(segs[si]);
      if(mm){ nonce = mm[1]; break; }
    }
  }catch(e){}
  if(!nonce) return;

  var PINS = [];          // [{n, anchor}]
  var picking = false;
  var layer = null, hover = null, hoverEl = null;
  var raf = 0;

  // ---------------------------------------------------------------- utils
  function post(msg){
    msg[TAG] = 1; msg.nonce = nonce;
    // The parent is same-origin with itself but this document has an opaque
    // origin, so '*' is the only usable target. Nothing secret is ever sent.
    try{ w.parent.postMessage(msg, '*'); }catch(e){}
  }
  function norm(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function textOf(el){ return norm(el && el.textContent).slice(0, 240); }
  function docW(){ return Math.max(d.documentElement.scrollWidth, 1); }
  function docH(){ return Math.max(d.documentElement.scrollHeight, 1); }

  function isStableId(id){
    return !!id && id.length < 60 && /^[A-Za-z][\w-]*$/.test(id) && !/^\d+$/.test(id) && !/[0-9a-f]{12}/i.test(id);
  }

  // ------------------------------------------------------- anchor: build
  function uniqueIdSel(node){
    var id = node.getAttribute && node.getAttribute('id');
    if(!isStableId(id)) return '';
    var sel = '#' + ((w.CSS && w.CSS.escape) ? w.CSS.escape(id) : id);
    try{ return d.querySelectorAll(sel).length === 1 ? sel : ''; }catch(e){ return ''; }
  }

  function nthSeg(node){
    var i = 1, sib = node;
    while((sib = sib.previousElementSibling)) if(sib.tagName === node.tagName) i++;
    return node.tagName.toLowerCase() + ':nth-of-type(' + i + ')';
  }

  // A slide deck repeats the same structure on every slide, so a bare
  // nth-of-type path matches the equivalent element on the WRONG slide. Anchor
  // to the nearest uniquely-identified ancestor first (that is the slide), and
  // only then walk down. The search up is unbounded on purpose: capping it is
  // what lets a path escape its slide.
  function cssPath(el){
    var root = null, node = el;
    while(node && node.nodeType === 1 && node !== d.body){
      if(uniqueIdSel(node)){ root = node; break; }
      node = node.parentElement;
    }
    var parts = [];
    if(root){
      var cur = el, guard = 0;
      while(cur && cur !== root && guard++ < 14){ parts.unshift(nthSeg(cur)); cur = cur.parentElement; }
      return (uniqueIdSel(root) + (parts.length ? ' > ' + parts.join(' > ') : '')).slice(0, 500);
    }
    var n2 = el, g2 = 0;
    while(n2 && n2.nodeType === 1 && n2 !== d.body && g2++ < 10){ parts.unshift(nthSeg(n2)); n2 = n2.parentElement; }
    return ('body > ' + parts.join(' > ')).slice(0, 500);
  }

  function sectionOf(el){
    var bits = [];
    var c = d.getElementById('counter'), s = d.getElementById('section');
    if(c && norm(c.textContent)) bits.push(norm(c.textContent));
    if(s && norm(s.textContent)) bits.push(norm(s.textContent));
    var node = el;
    while(node && node.nodeType === 1 && node !== d.body){
      var ds = node.getAttribute('data-section') || node.getAttribute('data-slide') || node.getAttribute('data-index');
      if(ds){ bits.push(norm(ds)); break; }
      if(node.tagName === 'SECTION' && node.id){ bits.push(node.id); break; }
      node = node.parentElement;
    }
    return bits.join(' · ').slice(0, 200);
  }

  function rectOf(el){
    var r = el.getBoundingClientRect();
    var sx = w.pageXOffset || d.documentElement.scrollLeft || 0;
    var sy = w.pageYOffset || d.documentElement.scrollTop || 0;
    return { x: (r.left + sx) / docW(), y: (r.top + sy) / docH(), w: r.width / docW(), h: r.height / docH() };
  }

  function buildAnchor(el){
    return { selector: cssPath(el), textQuote: textOf(el), position: rectOf(el), section: sectionOf(el) };
  }

  // ----------------------------------------------------- anchor: resolve
  // Several strategies, weakest last. `weak` tells the viewer the pin may have
  // drifted because the presentation changed since the comment was written.
  function visible(el){ return !!(el && el.getClientRects && el.getClientRects().length); }

  function byQuote(quote){
    if(!quote || quote.length < 8) return null;
    var want = norm(quote).slice(0, 60);
    // A container holds the text of everything inside it, including slides the
    // deck has hidden with display:none. Without an upper bound the "best match"
    // walks up to #stage, which is on screen on every slide - and the pin would
    // follow the reader around the deck. Demand a snug fit.
    var maxLen = want.length * 3 + 60;
    var all = d.querySelectorAll('#stage *, body > *:not(script):not(style) *');
    var best = null, bestLen = Infinity;
    for(var i = 0; i < all.length; i++){
      var el = all[i];
      if(!visible(el)) continue;
      var t = norm(el.textContent);
      if(t.length > maxLen) continue;
      if(t.indexOf(want) < 0) continue;
      if(t.length < bestLen){ best = el; bestLen = t.length; }
    }
    return best;
  }

  function resolve(anchor){
    if(!anchor) return null;
    var el = null;
    if(anchor.selector){
      try{ el = d.querySelector(anchor.selector); }catch(e){ el = null; }
    }
    if(el){
      // The anchored element still exists. If it is simply not on screen -
      // another slide is showing - the pin is not drawn right now, and we do
      // NOT go hunting for a lookalike: that is how a comment drifts onto
      // content the customer never wrote it about.
      if(!visible(el)) return null;
      var q = norm(anchor.textQuote).slice(0, 60);
      if(!q) return { el: el, weak: false };              // no text to check (an image, say)
      if(norm(el.textContent).indexOf(q) >= 0) return { el: el, weak: false };
      // The selector hit something, but it is not the text the customer marked.
      // Trust the quote over the structure, and if the quote is nowhere on the
      // page report unresolved rather than pinning the wrong element.
      var alt = byQuote(anchor.textQuote);
      return alt ? { el: alt, weak: true } : null;
    }
    // The selector matches nothing at all: the content moved or was rewritten,
    // so fall back to what the customer actually quoted.
    var found = byQuote(anchor.textQuote);
    if(found) return { el: found, weak: true };
    return null;
  }

  // ------------------------------------------------------------- overlay
  function ensureLayer(){
    if(layer && layer.isConnected) return layer;
    layer = d.createElement('div');
    layer.setAttribute('data-idfl-fb', 'layer');
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483000;pointer-events:none';
    d.body.appendChild(layer);
    var st = d.createElement('style');
    st.setAttribute('data-idfl-fb', 'style');
    st.textContent =
      '[data-idfl-fb="pin"]{position:absolute;pointer-events:auto;cursor:pointer;min-width:24px;height:24px;padding:0 6px;' +
      'border-radius:999px;background:#1255A0;color:#fff;font:700 12px/24px "Zen Kaku Gothic New",system-ui,sans-serif;' +
      'text-align:center;box-shadow:0 2px 8px rgba(4,34,88,.45);border:2px solid #fff;transform:translate(-50%,-50%)}' +
      '[data-idfl-fb="pin"].weak{background:#b45309}' +
      '[data-idfl-fb="pin"]:hover{background:#0d4383}' +
      '[data-idfl-fb="hover"]{position:absolute;pointer-events:none;border:2px solid #1255A0;border-radius:6px;' +
      'background:rgba(18,85,160,.12);box-shadow:0 0 0 2px rgba(255,255,255,.7)}' +
      '[data-idfl-fb="tip"]{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483001;pointer-events:none;' +
      'background:#0f2c4d;color:#fff;padding:8px 16px;border-radius:999px;' +
      'font:700 13px/1.4 "Zen Kaku Gothic New",system-ui,sans-serif;box-shadow:0 6px 20px rgba(4,34,88,.35)}' +
      'html.idfl-picking, html.idfl-picking *{cursor:crosshair !important}';
    d.head.appendChild(st);
    return layer;
  }

  function draw(){
    raf = 0;
    var l = ensureLayer();
    var seen = {};
    for(var i = 0; i < PINS.length; i++){
      var p = PINS[i];
      var r = resolve(p.anchor);
      var id = 'idflpin-' + p.n;
      seen[id] = 1;
      var node = d.getElementById(id);
      if(!r){ if(node) node.remove(); continue; }
      if(!node){
        node = d.createElement('button');
        node.id = id; node.type = 'button';
        node.setAttribute('data-idfl-fb', 'pin');
        node.setAttribute('aria-label', 'フィードバック ' + p.n);
        node.textContent = String(p.n);
        node.addEventListener('click', (function(n){ return function(ev){ ev.preventDefault(); ev.stopPropagation(); post({ evt: 'pinClick', n: n }); }; })(p.n));
        l.appendChild(node);
      }
      node.className = r.weak ? 'weak' : '';
      node.title = r.weak ? 'この位置は資料の更新で移動している可能性があります' : '';
      var rect = r.el.getBoundingClientRect();
      var sx = w.pageXOffset || d.documentElement.scrollLeft || 0;
      var sy = w.pageYOffset || d.documentElement.scrollTop || 0;
      node.style.left = Math.round(rect.left + sx + Math.min(rect.width, 40) / 2) + 'px';
      node.style.top  = Math.round(rect.top + sy + 12) + 'px';
    }
    var nodes = l.querySelectorAll('[data-idfl-fb="pin"]');
    for(var j = 0; j < nodes.length; j++) if(!seen[nodes[j].id]) nodes[j].remove();
    reportState();
  }

  function reportState(){
    var ok = [], miss = [];
    for(var i = 0; i < PINS.length; i++) (resolve(PINS[i].anchor) ? ok : miss).push(PINS[i].n);
    post({ evt: 'pinState', resolved: ok, unresolved: miss });
  }

  function schedule(){ if(!raf) raf = w.requestAnimationFrame(draw); }

  // ---------------------------------------------------------- pick mode
  function tip(text){
    var t = d.querySelector('[data-idfl-fb="tip"]');
    if(!text){ if(t) t.remove(); return; }
    if(!t){ t = d.createElement('div'); t.setAttribute('data-idfl-fb', 'tip'); d.body.appendChild(t); }
    t.textContent = text;
  }

  function clearHover(){ if(hover){ hover.remove(); hover = null; } hoverEl = null; }

  function pickable(el){
    if(!el || el.nodeType !== 1) return null;
    if(el.closest && el.closest('[data-idfl-fb]')) return null;
    if(el === d.body || el === d.documentElement) return null;
    var r = el.getBoundingClientRect();
    if(r.width < 6 || r.height < 6) return null;
    return el;
  }

  function onMove(ev){
    if(!picking) return;
    var el = pickable(ev.target);
    if(!el){ clearHover(); return; }
    hoverEl = el;
    if(!hover){ hover = d.createElement('div'); hover.setAttribute('data-idfl-fb', 'hover'); ensureLayer().appendChild(hover); }
    var r = el.getBoundingClientRect();
    var sx = w.pageXOffset || d.documentElement.scrollLeft || 0;
    var sy = w.pageYOffset || d.documentElement.scrollTop || 0;
    hover.style.left = (r.left + sx - 2) + 'px';
    hover.style.top = (r.top + sy - 2) + 'px';
    hover.style.width = r.width + 'px';
    hover.style.height = r.height + 'px';
  }

  function onClick(ev){
    if(!picking) return;
    var el = pickable(ev.target) || hoverEl;
    if(!el) return;
    ev.preventDefault(); ev.stopPropagation();
    var anchor = buildAnchor(el);
    setPicking(false);
    post({ evt: 'picked', anchor: anchor });
  }

  function onKey(ev){
    if(picking && ev.key === 'Escape'){ ev.preventDefault(); setPicking(false); post({ evt: 'cancel' }); }
  }

  function setPicking(on){
    picking = !!on;
    d.documentElement.classList.toggle('idfl-picking', picking);
    if(picking){ ensureLayer(); tip('コメントしたい箇所をクリックしてください（Esc で中止）'); }
    else{ clearHover(); tip(''); }
  }

  // ------------------------------------------------------------- wiring
  w.addEventListener('message', function(ev){
    if(ev.source !== w.parent) return;                       // only our host
    var m = ev.data;
    if(!m || m[TAG] !== 1 || m.nonce !== nonce) return;
    if(m.cmd === 'setPins'){ PINS = Array.isArray(m.pins) ? m.pins.slice(0, 200) : []; schedule(); }
    else if(m.cmd === 'pickMode'){ setPicking(!!m.on); }
    else if(m.cmd === 'focusPin'){
      for(var i = 0; i < PINS.length; i++){
        if(PINS[i].n === m.n){
          var r = resolve(PINS[i].anchor);
          if(r) r.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          break;
        }
      }
    }
  }, false);

  d.addEventListener('mousemove', onMove, true);
  d.addEventListener('click', onClick, true);
  d.addEventListener('keydown', onKey, true);
  w.addEventListener('scroll', schedule, true);
  w.addEventListener('resize', schedule);

  // The deck re-renders its stage on every slide change - sometimes by
  // replacing nodes, sometimes by only toggling a class - so watch attributes
  // too, or pins would go stale on navigation.
  try{
    new w.MutationObserver(schedule).observe(d.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
  }catch(e){}

  post({ evt: 'ready' });
  schedule();
}

/** The agent, ready to inline. Self-contained by construction. */
function agentScript(){
  return ';(' + agentMain.toString() + ')(window, document);';
}

/**
 * Inject the agent into an entry HTML document.
 * Appends before </body> when present so the agent runs after the deck boots.
 */
function injectAgent(html){
  const tag = '<script>' + agentScript() + '<' + '/script>';
  const s = String(html);
  const i = s.toLowerCase().lastIndexOf('</body>');
  if(i < 0) return s + tag;
  return s.slice(0, i) + tag + s.slice(i);
}

module.exports = { agentScript, injectAgent, agentMain };
