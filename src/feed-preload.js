'use strict';

// Runs inside every platform page (sandboxed, isolated world). It does three
// jobs, all driven by config/platforms.js rather than hard-coded selectors:
//
//   1. While the page is hidden, keep every video paused (sound is also muted
//      by the main process).
//   2. While the page is visible, turn wheel / trackpad / touch swipes into
//      "next" / "previous" and stop the site from scrolling by itself.
//   3. When asked, move this feed to its next video, trying each configured
//      strategy until the centred video actually changes.

const { ipcRenderer } = require('electron');

(function main() {
  const boot = ipcRenderer.sendSync('bb:hello');
  if (!boot) return; // a popup or some other page we don't manage

  const cfg = boot.platform;
  const input = boot.input || {};
  let state = boot.state; // { active, mode }

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
    } catch {
      return []; // bad selector in config
    }
    return [...nodes]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 40 && r.height > 80);
  }

  // The element whose centre is closest to the middle of the viewport.
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
  const currentVideo = () => centred(videos())?.el || null;

  function currentKey() {
    const item = centred(items());
    const video = currentVideo();
    return [location.href, idOf(item?.el), idOf(video), video?.currentSrc || ''].join('|');
  }

  // -------------------------------------------------------------------------
  // Playback control

  function pauseAll() {
    for (const m of document.querySelectorAll('video, audio')) {
      if (!m.paused) m.pause();
      if (m.tagName === 'VIDEO') m.preload = 'auto'; // keep buffering the next one
    }
  }

  async function playCurrent() {
    // The site may still be rendering the video, so try a few times.
    for (const wait of [0, 250, 700, 1500]) {
      await sleep(wait);
      if (!state.active) return;
      const v = currentVideo();
      if (!v) continue;
      v.muted = false;
      if (v.paused) v.play().catch(() => {});
      if (!v.paused) return;
    }
  }

  // Media events don't bubble, but a capturing listener still sees them.
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

  ipcRenderer.on('bb:state', (_e, next) => {
    const wasActive = state.active;
    state = next;
    if (!state.active) pauseAll();
    else if (!wasActive) playCurrent();
  });

  // -------------------------------------------------------------------------
  // Advancing to the next video

  function scrollParent(el) {
    for (let n = el?.parentElement; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 10) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollToNext(block) {
    const list = cfg.itemSelector && items().length ? items() : videos();
    const cur = centred(list);
    if (cur) {
      const below = list
        .filter((b) => b.r.top > cur.r.top + 20)
        .sort((a, b) => a.r.top - b.r.top);
      if (below.length) {
        below[0].el.scrollIntoView({ block: block || 'start', behavior: 'instant' });
        return true;
      }
    }
    // Nothing rendered below yet: scroll the feed by one screen.
    const scroller = scrollParent(cur?.el || currentVideo());
    scroller.scrollBy({ top: scroller.clientHeight || window.innerHeight, behavior: 'instant' });
    return true;
  }

  function runStep(step) {
    switch (step.type) {
      case 'click': {
        let el = null;
        try {
          el = document.querySelector(step.selector);
        } catch {}
        if (!el) return false;
        el.click();
        return true;
      }
      case 'scroll':
        return scrollToNext(step.block);
      case 'key':
        // Ask the main process for a real (trusted) key press.
        ipcRenderer.send('bb:press-key', step.key || 'ArrowDown');
        return true;
      default:
        return false;
    }
  }

  async function advance() {
    const before = currentKey();
    const steps = cfg.advance && cfg.advance.length ? cfg.advance : [{ type: 'scroll' }];
    for (const step of steps) {
      // `tries` lets a step repeat, for mixed feeds where the next video may
      // be several screens of non-video posts away.
      for (let attempt = 0; attempt < (step.tries || 1); attempt++) {
        if (!runStep(step)) break;
        await sleep(cfg.verifyMs ?? 900);
        if (currentKey() !== before) {
          if (state.active) playCurrent();
          else pauseAll();
          return { ok: true, step: step.type };
        }
      }
    }
    return { ok: false };
  }

  let queue = Promise.resolve();
  ipcRenderer.on('bb:advance', () => {
    queue = queue
      .then(advance)
      .catch(() => ({ ok: false }))
      .then((result) => ipcRenderer.send('bb:advanced', result));
  });

  // -------------------------------------------------------------------------
  // Wheel, trackpad and touch

  const feedMode = () => state.active && state.mode === 'feed';

  let acc = 0;
  let lastWheel = 0;
  let armed = true;
  window.addEventListener(
    'wheel',
    (e) => {
      // Alt+scroll passes through (comments, descriptions); Ctrl+scroll is pinch-zoom.
      if (!feedMode() || e.altKey || e.ctrlKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const now = performance.now();
      if (now - lastWheel > (input.wheelQuietMs ?? 220)) {
        armed = true;
        acc = 0;
      }
      lastWheel = now;
      if (!armed) return; // still the tail of the last gesture
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      acc += e.deltaY * unit;
      if (Math.abs(acc) >= (input.wheelThreshold ?? 40)) {
        armed = false;
        ipcRenderer.send('bb:nav', acc > 0 ? 'next' : 'prev');
        acc = 0;
      }
    },
    { capture: true, passive: false },
  );

  let touchY = null;
  window.addEventListener(
    'touchstart',
    (e) => {
      if (feedMode() && e.touches.length === 1) touchY = e.touches[0].clientY;
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (feedMode() && touchY !== null) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true, passive: false },
  );
  window.addEventListener(
    'touchend',
    (e) => {
      if (touchY === null) return;
      const dy = touchY - (e.changedTouches[0]?.clientY ?? touchY);
      touchY = null;
      if (!feedMode() || Math.abs(dy) < (input.swipeMinPx ?? 60)) return;
      ipcRenderer.send('bb:nav', dy > 0 ? 'next' : 'prev');
    },
    { capture: true, passive: true },
  );
})();
