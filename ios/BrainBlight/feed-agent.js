// Injected into every platform page by the iPhone app, in an isolated
// JavaScript world (the page's own scripts can't see it). It mirrors
// src/feed-preload.js on desktop:
//
//   1. While the page is hidden, keep every video paused.
//   2. While the page is visible, turn vertical swipes into "next" /
//      "previous" and stop the site from scrolling by itself.
//   3. When asked, move this feed to its next video, trying each configured
//      strategy until the centred video actually changes.
//
// The app prepends `window.__bbBoot = { platform, input }` before this file.

(() => {
  if (window.__bb) return;

  const boot = window.__bbBoot || {};
  const cfg = boot.platform || {};
  const input = boot.input || {};
  let state = { active: false, mode: 'feed', muted: false };

  const post = (msg) => {
    try {
      window.webkit.messageHandlers.bb.postMessage(msg);
    } catch (_) {}
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // -------------------------------------------------------------------------
  // Finding the "current" video

  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (el) => {
    if (!el) return 0;
    if (!ids.has(el)) ids.set(el, nextId++);
    return ids.get(el);
  };

  function visibleBoxes(selector) {
    if (!selector) return [];
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (_) {
      return [];
    }
    return Array.from(nodes)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 40 && r.height > 80);
  }

  function centred(boxes) {
    const mid = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const b of boxes) {
      const d = Math.abs(b.r.top + b.r.height / 2 - mid);
      if (d < bestDist) {
        best = b;
        bestDist = d;
      }
    }
    return best;
  }

  const items = () => visibleBoxes(cfg.itemSelector);
  const videos = () => visibleBoxes('video');
  const currentVideo = () => (centred(videos()) || {}).el || null;

  function currentKey() {
    const item = centred(items());
    const video = currentVideo();
    return [location.href, idOf(item && item.el), idOf(video), (video && video.currentSrc) || ''].join('|');
  }

  // -------------------------------------------------------------------------
  // Playback control

  function pauseAll() {
    for (const m of document.querySelectorAll('video, audio')) {
      if (!m.paused) m.pause();
      if (m.tagName === 'VIDEO') m.preload = 'auto';
    }
  }

  async function playCurrent() {
    for (const wait of [0, 250, 700, 1500]) {
      await sleep(wait);
      if (!state.active) return;
      const v = currentVideo();
      if (!v) continue;
      v.muted = state.muted;
      if (v.paused) v.play().catch(() => {});
      if (!v.paused) return;
    }
  }

  document.addEventListener(
    'play',
    (e) => {
      if (!state.active && e.target instanceof HTMLMediaElement) e.target.pause();
    },
    true,
  );
  setInterval(() => {
    if (!state.active) pauseAll();
  }, 400);

  // -------------------------------------------------------------------------
  // Advancing

  function scrollParent(el) {
    for (let n = el && el.parentElement; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 10) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollToNext() {
    const list = cfg.itemSelector && items().length ? items() : videos();
    const cur = centred(list);
    if (cur) {
      const below = list.filter((b) => b.r.top > cur.r.top + 20).sort((a, b) => a.r.top - b.r.top);
      if (below.length) {
        below[0].el.scrollIntoView({ block: 'start', behavior: 'instant' });
        return true;
      }
    }
    const scroller = scrollParent((cur && cur.el) || currentVideo());
    scroller.scrollBy({ top: scroller.clientHeight || window.innerHeight, behavior: 'instant' });
    return true;
  }

  function pressKey(key) {
    const keyCode = { ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, ArrowLeft: 37 }[key] || 0;
    const target = document.activeElement || document.body || document;
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode, which: keyCode, bubbles: true }));
    }
    return true;
  }

  function runStep(step) {
    switch (step.type) {
      case 'click': {
        let el = null;
        try {
          el = document.querySelector(step.selector);
        } catch (_) {}
        if (!el) return false;
        el.click();
        return true;
      }
      case 'scroll':
        return scrollToNext();
      case 'key':
        return pressKey(step.key || 'ArrowDown');
      default:
        return false;
    }
  }

  async function advance() {
    const before = currentKey();
    const steps = cfg.advance && cfg.advance.length ? cfg.advance : [{ type: 'scroll' }];
    for (const step of steps) {
      if (!runStep(step)) continue;
      await sleep(cfg.verifyMs == null ? 900 : cfg.verifyMs);
      if (currentKey() !== before) {
        if (state.active) playCurrent();
        else pauseAll();
        return { ok: true, step: step.type };
      }
    }
    return { ok: false };
  }

  // -------------------------------------------------------------------------
  // Swipes

  const feedMode = () => state.active && state.mode === 'feed';
  let start = null; // { x, y, passthrough }

  window.addEventListener(
    'touchstart',
    (e) => {
      if (!feedMode() || e.touches.length !== 1) {
        start = null;
        return;
      }
      // A touch that starts inside some other scrollable area (comments,
      // captions) scrolls that area normally instead of counting as a swipe.
      const own = scrollParent(e.target);
      const feed = scrollParent(currentVideo());
      const passthrough = own !== feed && own !== document.scrollingElement && own !== document.documentElement;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, passthrough };
    },
    { capture: true, passive: true },
  );

  window.addEventListener(
    'touchmove',
    (e) => {
      if (start && !start.passthrough && feedMode()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true, passive: false },
  );

  window.addEventListener(
    'touchend',
    (e) => {
      if (!start || start.passthrough) {
        start = null;
        return;
      }
      const t = e.changedTouches[0];
      const dy = start.y - (t ? t.clientY : start.y);
      const dx = start.x - (t ? t.clientX : start.x);
      start = null;
      const min = input.swipeMinPx == null ? 60 : input.swipeMinPx;
      if (!feedMode() || Math.abs(dy) < min || Math.abs(dy) < Math.abs(dx)) return;
      e.preventDefault(); // don't let the swipe also count as a tap
      post({ type: 'nav', dir: dy > 0 ? 'next' : 'prev' });
    },
    { capture: true, passive: false },
  );

  // -------------------------------------------------------------------------
  // Bridge to the app

  let queue = Promise.resolve();
  window.__bb = {
    setState(next) {
      const wasActive = state.active;
      state = next;
      if (!state.active) pauseAll();
      else if (!wasActive) playCurrent();
      else {
        const v = currentVideo();
        if (v) v.muted = state.muted;
      }
    },
    advance() {
      queue = queue
        .then(advance)
        .catch(() => ({ ok: false }))
        .then((result) => post({ type: 'advanced', ok: !!result.ok, step: result.step || '' }));
    },
  };

  post({ type: 'hello' });
})();
