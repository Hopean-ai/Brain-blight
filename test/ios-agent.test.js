// Runs the iPhone feed agent (ios/BrainBlight/feed-agent.js) in Chromium
// against the mock feed, with a fake WebKit message bridge.
//   node test/ios-agent.test.js      (needs the `playwright` package)
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const agent = fs.readFileSync(path.join(__dirname, '..', 'ios', 'BrainBlight', 'feed-agent.js'), 'utf8');
const feed = 'file://' + path.join(__dirname, 'mock-feed.html');

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 760 } })).newPage();
  await page.addInitScript(`
    window.__msgs = [];
    window.webkit = { messageHandlers: { bb: { postMessage: (m) => window.__msgs.push(m) } } };
    window.__bbBoot = { platform: { id: 'mock', itemSelector: '.item', advance: [{ type: 'click', selector: '#nope' }, { type: 'scroll' }], verifyMs: 300 }, input: { swipeMinPx: 60 } };
  ` + agent);
  await page.goto(feed + '#scroll');
  await page.waitForTimeout(800);
  const st = () => page.evaluate('mockState()');
  const msgs = () => page.evaluate('window.__msgs');

  assert.deepEqual((await msgs())[0], { type: 'hello' });
  assert.deepEqual((await st()).playing, [], 'starts paused until told it is active');

  await page.evaluate("__bb.setState({active: true, mode: 'feed', muted: false})");
  await page.waitForTimeout(600);
  assert.deepEqual((await st()).playing, [0], 'active feed plays');

  await page.evaluate("__bb.setState({active: false, mode: 'feed', muted: false})");
  await page.evaluate('__bb.advance()');
  await page.waitForTimeout(1200);
  let s = await st();
  assert.equal(s.index, 1, 'advanced one video while hidden');
  assert.deepEqual(s.playing, [], 'hidden feed stays paused after advancing');
  assert.deepEqual((await msgs()).at(-1), { type: 'advanced', ok: true, step: 'scroll' });

  await page.evaluate("__bb.setState({active: true, mode: 'feed', muted: false})");
  await page.waitForTimeout(600);
  assert.deepEqual((await st()).playing, [1], 'returning plays the preloaded next video');

  // A vertical swipe up becomes a "next" message and the page doesn't scroll itself.
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] });
  await touch('touchStart', 600);
  for (const y of [500, 400, 300, 200]) await touch('touchMove', y);
  await touch('touchEnd');
  await page.waitForTimeout(400);
  assert.deepEqual((await msgs()).at(-1), { type: 'nav', dir: 'next' });
  assert.equal((await st()).index, 1, 'the site did not scroll on its own');

  console.log('iOS AGENT TEST PASSED');
  await browser.close();
})().catch((e) => {
  console.error('iOS AGENT TEST FAILED:', e.message);
  process.exit(1);
});
