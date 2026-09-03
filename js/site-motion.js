/* ============================================================
   IDFL JAPAN — global chrome behaviour and motion.

   No framework. CSS transitions do the animating; this file only manages
   state, focus and one IntersectionObserver.

   Everything degrades: the header links, the menu contents and every page
   section are in the static HTML and readable with this file absent. The
   `js` class on <html> is what switches the hidden-until-revealed styling
   on, so a failure here leaves content visible rather than blank.
   ============================================================ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ==========================================================
     Mega menu
     ========================================================== */
  var btn = document.getElementById('idflMenuBtn');
  var menu = document.getElementById('idflMenu');
  var scrim = document.getElementById('idflScrim');
  var closeBtn = document.getElementById('idflMenuClose');

  if (btn && menu && scrim) {
    var lastFocus = null;

    var focusables = function () {
      return Array.prototype.filter.call(
        menu.querySelectorAll('a[href], button:not([disabled])'),
        function (el) { return el.offsetParent !== null; }
      );
    };

    var open = function () {
      lastFocus = document.activeElement;
      menu.hidden = false;
      scrim.hidden = false;
      // Force a frame so the transition runs from the hidden state rather
      // than being collapsed into the same style recalculation.
      void menu.offsetWidth;
      menu.classList.add('is-open');
      scrim.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      var first = focusables()[0];
      if (closeBtn) closeBtn.focus();
      else if (first) first.focus();
    };

    var close = function (returnFocus) {
      menu.classList.remove('is-open');
      scrim.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      var done = function () {
        menu.hidden = true;
        scrim.hidden = true;
      };
      if (reduced.matches) done();
      else window.setTimeout(done, 160);
      if (returnFocus !== false) {
        // A programmatic open leaves activeElement on <body>, which is not a
        // useful place to send focus back to. Fall back to the trigger.
        var back = (lastFocus && lastFocus.focus && lastFocus !== document.body)
          ? lastFocus : btn;
        back.focus();
      }
    };

    var isOpen = function () { return btn.getAttribute('aria-expanded') === 'true'; };

    btn.addEventListener('click', function () { isOpen() ? close() : open(); });
    if (closeBtn) closeBtn.addEventListener('click', function () { close(); });
    scrim.addEventListener('click', function () { close(); });

    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the panel while it is modal.
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // Following a link inside the panel should not leave the body locked.
    menu.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (a) close(false);
    });

    /* ---- Mobile: groups collapse into an accordion --------------------
       Only wired below 620px, where the CSS actually hides the lists. The
       heading becomes the control, so it needs button semantics. */
    var mobile = window.matchMedia('(max-width: 620px)');
    var cols = Array.prototype.slice.call(menu.querySelectorAll('.idfl-menu__col'));

    var wireAccordion = function () {
      cols.forEach(function (col, i) {
        var h = col.querySelector('h2');
        if (!h) return;
        if (mobile.matches) {
          if (!h.hasAttribute('role')) {
            h.setAttribute('role', 'button');
            h.setAttribute('tabindex', '0');
            var toggle = function () {
              var openNow = col.classList.toggle('is-open');
              h.setAttribute('aria-expanded', openNow ? 'true' : 'false');
            };
            h.addEventListener('click', toggle);
            h.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
            });
          }
          // First group open so the panel never reads as an empty list.
          if (i === 0) col.classList.add('is-open');
          h.setAttribute('aria-expanded', col.classList.contains('is-open') ? 'true' : 'false');
        } else {
          col.classList.remove('is-open');
          h.removeAttribute('aria-expanded');
        }
      });
    };
    wireAccordion();
    if (mobile.addEventListener) mobile.addEventListener('change', wireAccordion);
  }

  /* ==========================================================
     Section reveal — once, cheap, and skipped entirely under
     reduced motion.
     ========================================================== */
  var targets = document.querySelectorAll('.idfl-reveal');
  if (targets.length) {
    if (reduced.matches || !('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(targets, function (el) { el.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);   // once only
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
      Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
    }
  }
})();
