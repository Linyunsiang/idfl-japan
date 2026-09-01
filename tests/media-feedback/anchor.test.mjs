// ============================================================
// Anchor tests for the injected annotation agent (_annotate.js), run against
// the REAL GOTS presentation DOM.
//
// This is the part of the feature most likely to rot quietly: a slide deck
// repeats its structure on every slide, so a careless selector silently pins a
// comment to the wrong slide. These tests pin that behaviour down.
//
// Needs jsdom:  npm install --no-save jsdom
//   node tests/media-feedback/anchor.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
let JSDOM;
try{ ({ JSDOM } = require_('jsdom')); }
catch(e){
  console.log('anchor tests skipped: jsdom is not installed (npm install --no-save jsdom)');
  process.exit(0);
}

const PKG = process.env.IDFL_TEST_PKG || 'C:/Users/AldenLin/AppData/Local/Temp/claude/C--Users-AldenLin/28ad7c38-23a1-4aca-9a88-61f754d8c111/scratchpad/gots-pkg';
const AN = require_('../../netlify/functions/_annotate.js');

let pass = 0, fail = 0;
function t(name, fn){
  try{ fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}

// --------------------------------------------------------------------------
// Boot the real deck in jsdom, with the agent injected as the viewer serves it.
// --------------------------------------------------------------------------
function boot(){
  const entry = fs.readFileSync(path.join(PKG, 'index.html'), 'utf8');
  const html = AN.injectAgent(entry);

  const posted = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost/media/mid/tok/f-TESTNONCE12345/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: undefined,                       // no network; assets are loaded manually below
    beforeParse(w){
      // jsdom has no layout engine, so model the one rule that decides whether
      // a deck element is on screen. styles/main.css:80 is `.slide{display:none}`
      // and deck.js adds `.is-active` to the current slide, so every element
      // inside an inactive slide has no boxes - exactly as in a real browser.
      function offscreen(el){
        let n = el;
        while(n && n.nodeType === 1){
          if(n.classList && n.classList.contains('slide') && !n.classList.contains('is-active')) return true;
          if(n.classList && n.classList.contains('ovl') && !n.classList.contains('open')) return true;
          n = n.parentElement;
        }
        return false;
      }
      w.Element.prototype.getClientRects = function(){
        return offscreen(this) ? [] : [{ left: 0, top: 0, width: 200, height: 40, right: 200, bottom: 40 }];
      };
      w.Element.prototype.getBoundingClientRect = function(){
        return offscreen(this)
          ? { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
          : { left: 10, top: 20, width: 200, height: 40, right: 210, bottom: 60 };
      };
      w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
      w.parent = { postMessage: (m) => posted.push(m) };
      w.scrollTo = () => {};
    },
  });

  const w = dom.window, d = w.document;
  // Run the deck's own scripts in order, as the browser would.
  for(const s of [...d.querySelectorAll('script[src]')]){
    const code = fs.readFileSync(path.join(PKG, s.getAttribute('src')), 'utf8');
    try{ w.eval(code); }catch(e){ /* a deck script may need real layout; the DOM it built still stands */ }
  }
  try{ d.dispatchEvent(new w.Event('DOMContentLoaded')); }catch(e){}
  return { dom, w, d, posted };
}

// Ask the injected agent to do something and read what it posted back.
function drive(env, cmd){
  env.posted.length = 0;
  env.w.dispatchEvent(new env.w.MessageEvent('message', {
    data: Object.assign({ __idflfb: 1, nonce: 'TESTNONCE12345' }, cmd),
    source: env.w.parent,
  }));
  return env.posted;
}

console.log('annotation anchors (real GOTS deck in jsdom)');

const env = boot();

t('the deck renders slides into the DOM', () => {
  const slides = env.d.querySelectorAll('[id^="slide-"]');
  assert.ok(slides.length > 5, 'expected the deck to build slides, got ' + slides.length);
});

t('the agent starts and announces itself', () => {
  const ready = env.posted.find(m => m && m.evt === 'ready');
  assert.ok(ready, 'agent never posted ready');
  assert.equal(ready.nonce, 'TESTNONCE12345');
});

t('the agent ignores a message with the wrong nonce', () => {
  env.posted.length = 0;
  env.w.dispatchEvent(new env.w.MessageEvent('message', {
    data: { __idflfb: 1, nonce: 'WRONGNONCE0000', cmd: 'setPins', pins: [{ n: 1, anchor: { selector: 'h1' } }] },
    source: env.w.parent,
  }));
  assert.equal(env.posted.length, 0, 'agent responded to a foreign nonce');
});

t('the agent ignores a message from a source that is not its host', () => {
  env.posted.length = 0;
  env.w.dispatchEvent(new env.w.MessageEvent('message', {
    data: { __idflfb: 1, nonce: 'TESTNONCE12345', cmd: 'setPins', pins: [] },
    source: { fake: true },
  }));
  assert.equal(env.posted.length, 0, 'agent responded to a foreign source');
});

// --------------------------------------------------------------------------
// Anchors are built by the agent on click, so simulate the click it listens for.
// --------------------------------------------------------------------------
function anchorFor(el){
  drive(env, { cmd: 'pickMode', on: true });
  env.posted.length = 0;
  const ev = new env.w.MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  const picked = env.posted.find(m => m && m.evt === 'picked');
  assert.ok(picked, 'no anchor was produced for the click');
  return picked.anchor;
}

let titleAnchor, scopeAnchor;

t('an anchor on the title slide is scoped to that slide', () => {
  const h1 = env.d.querySelector('#slide-title h1') || env.d.querySelector('h1');
  assert.ok(h1, 'no heading found');
  titleAnchor = anchorFor(h1);
  assert.ok(titleAnchor.selector.startsWith('#'), 'selector must anchor to a unique id, got: ' + titleAnchor.selector);
  assert.ok(titleAnchor.textQuote.length > 0, 'expected a text quote');
  assert.ok(titleAnchor.position && typeof titleAnchor.position.x === 'number');
  assert.ok(titleAnchor.section.length > 0, 'expected a section label');
});

t('the selector resolves to exactly one element', () => {
  assert.equal(env.d.querySelectorAll(titleAnchor.selector).length, 1, 'ambiguous selector: ' + titleAnchor.selector);
});

t('an anchor on a different slide gets a different, slide-scoped selector', () => {
  const slide = [...env.d.querySelectorAll('.slide')].find(s => s.id && s.id !== 'slide-title' && s.querySelector('h1,h2,p'));
  assert.ok(slide, 'deck has only one slide with content');
  // Only what is on screen can be picked, so show that slide first - the same
  // thing a reader would do before commenting on it.
  for(const s of env.d.querySelectorAll('.slide')) s.classList.toggle('is-active', s === slide);
  scopeAnchor = anchorFor(slide.querySelector('h1,h2,p'));
  for(const s of env.d.querySelectorAll('.slide')) s.classList.toggle('is-active', s.id === 'slide-title');
  assert.notEqual(scopeAnchor.selector, titleAnchor.selector, 'two slides produced the same selector');
  assert.equal(env.d.querySelectorAll(scopeAnchor.selector).length, 1);
  assert.ok(scopeAnchor.selector.indexOf('#' + slide.id) === 0, 'selector should be scoped to its slide, got ' + scopeAnchor.selector);
});

t('an element on a hidden slide cannot be picked at all', () => {
  // The title slide is the active one here, so nothing on slide 2 is pickable.
  const hidden = [...env.d.querySelectorAll('.slide')].find(s => s.id !== 'slide-title');
  drive(env, { cmd: 'pickMode', on: true });
  env.posted.length = 0;
  hidden.querySelector('h1,h2,p').dispatchEvent(new env.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(!env.posted.some(m => m && m.evt === 'picked'), 'anchored to an off-screen element');
  drive(env, { cmd: 'pickMode', on: false });
});

// --------------------------------------------------------------------------
// Resolution: the behaviour that was wrong before, and must stay right.
// --------------------------------------------------------------------------
function norm(st){ return { resolved: Array.from(st.resolved || []), unresolved: Array.from(st.unresolved || []) }; }

function pinState(pins){
  const out = drive(env, { cmd: 'setPins', pins });
  // draw() is scheduled through rAF; flush it.
  return new Promise(res => setTimeout(() => {
    const st = env.posted.filter(m => m && m.evt === 'pinState').pop();
    res(norm(st || {}));
  }, 30));
}

const results = [];
async function ta(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}

await ta('a live anchor resolves', async () => {
  const st = await pinState([{ n: 1, anchor: titleAnchor }]);
  assert.deepEqual(st.resolved, [1], 'expected pin 1 to resolve, got ' + JSON.stringify(st));
});

await ta('a structurally-valid selector pointing at the WRONG text does not resolve', async () => {
  // This is the regression: the same nth-of-type path exists on every slide, so
  // a stale selector used to pin a comment onto whatever sat in that position.
  const bogus = { selector: titleAnchor.selector, textQuote: 'この文字列は資料のどこにも存在しません 12345', position: titleAnchor.position, section: '' };
  const st = await pinState([{ n: 1, anchor: bogus }]);
  assert.deepEqual(st.resolved, [], 'agent pinned a comment onto the wrong element');
  assert.deepEqual(st.unresolved, [1]);
});

await ta('a broken selector still resolves via the text quote (fallback)', async () => {
  const moved = { selector: '#definitely-not-here > p:nth-of-type(99)', textQuote: titleAnchor.textQuote, position: titleAnchor.position, section: titleAnchor.section };
  const st = await pinState([{ n: 1, anchor: moved }]);
  assert.deepEqual(st.resolved, [1], 'text-quote fallback failed: ' + JSON.stringify(st));
});

await ta('an anchor that resolves nowhere is reported unresolved, not lost', async () => {
  const gone = { selector: '#gone > span:nth-of-type(3)', textQuote: 'この内容は削除されました 98765', position: { x: .5, y: .5, w: .1, h: .1 }, section: '古いセクション' };
  const st = await pinState([{ n: 7, anchor: gone }]);
  assert.deepEqual(st.resolved, []);
  assert.deepEqual(st.unresolved, [7], 'an unresolvable anchor must still be reported so the viewer can list it');
});

await ta('an image anchor (no text) resolves on selector alone', async () => {
  const img = env.d.querySelector('#slide-title img') || env.d.querySelector('img');
  assert.ok(img, 'no image in the deck');
  const a = anchorFor(img);
  assert.equal(a.textQuote, '', 'an image should carry no text quote');
  const st = await pinState([{ n: 2, anchor: a }]);
  assert.deepEqual(st.resolved, [2]);
});

await ta('several pins resolve independently', async () => {
  const st = await pinState([
    { n: 1, anchor: titleAnchor },
    { n: 2, anchor: { selector: '#nope > i:nth-of-type(2)', textQuote: 'どこにもない文字列 55555', position: null, section: '' } },
    { n: 3, anchor: { selector: '#nope2', textQuote: titleAnchor.textQuote, position: null, section: '' } },
  ]);
  assert.ok(st.resolved.indexOf(1) >= 0, 'pin 1 should resolve');
  assert.ok(st.unresolved.indexOf(2) >= 0, 'pin 2 should not resolve');
  assert.ok(st.resolved.indexOf(3) >= 0, 'pin 3 should resolve by quote');
});

await ta('pins are drawn into an overlay layer, not into the deck content', async () => {
  await pinState([{ n: 1, anchor: titleAnchor }]);
  const layer = env.d.querySelector('[data-idfl-fb="layer"]');
  assert.ok(layer, 'no overlay layer');
  assert.equal(layer.parentElement, env.d.body, 'the layer must sit directly on body');
  const pin = env.d.getElementById('idflpin-1');
  assert.ok(pin, 'pin 1 was not drawn');
  assert.equal(pin.textContent, '1');
  assert.equal(pin.getAttribute('data-idfl-fb'), 'pin');
});

await ta('a pin click reports back to the host', async () => {
  await pinState([{ n: 1, anchor: titleAnchor }]);
  env.posted.length = 0;
  env.d.getElementById('idflpin-1').dispatchEvent(new env.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const hit = env.posted.find(m => m && m.evt === 'pinClick');
  assert.ok(hit, 'pin click was not reported');
  assert.equal(hit.n, 1);
});

// --------------------------------------------------------------------------
// Navigating the deck. A comment belongs to ONE slide and must not follow the
// viewer around: showing it on slide 2 would attach a customer's question to
// content they never commented on.
// --------------------------------------------------------------------------
function showSlide(id){
  for(const s of env.d.querySelectorAll('.slide')){
    s.classList.toggle('is-active', s.id === id);
    s.setAttribute('aria-hidden', s.id === id ? 'false' : 'true');
  }
  const c = env.d.getElementById('counter');
  if(c) c.textContent = (id === 'slide-title' ? '1' : '2') + ' / 38';
}

await ta('a pin shows on its own slide', async () => {
  showSlide('slide-title');
  const st = await pinState([{ n: 1, anchor: titleAnchor }]);
  assert.deepEqual(st.resolved, [1], 'pin missing from its own slide: ' + JSON.stringify(st));
  assert.equal(env.d.getElementById('idflpin-1').className, '', 'should be a confident match, not weak');
});

await ta('the same pin disappears on another slide instead of drifting', async () => {
  const other = [...env.d.querySelectorAll('.slide')].map(s => s.id).find(id => id && id !== 'slide-title');
  assert.ok(other, 'deck has only one slide');
  showSlide(other);
  const st = await pinState([{ n: 1, anchor: titleAnchor }]);
  assert.deepEqual(st.resolved, [], 'pin followed the viewer to slide ' + other);
  assert.deepEqual(st.unresolved, [1]);
  assert.equal(env.d.getElementById('idflpin-1'), null, 'the pin element should be removed, not just hidden');
});

await ta('the pin comes back when the slide does', async () => {
  showSlide('slide-title');
  const st = await pinState([{ n: 1, anchor: titleAnchor }]);
  assert.deepEqual(st.resolved, [1]);
  assert.ok(env.d.getElementById('idflpin-1'), 'pin not restored');
});

await ta('the agent never picks its own overlay furniture', async () => {
  showSlide('slide-title');
  await pinState([{ n: 1, anchor: titleAnchor }]);
  drive(env, { cmd: 'pickMode', on: true });
  env.posted.length = 0;
  env.d.getElementById('idflpin-1').dispatchEvent(new env.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(!env.posted.some(m => m && m.evt === 'picked'), 'the agent anchored to its own pin');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
