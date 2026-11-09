// Smoke test: drives the real app against test/mock-feed.html.
//   npm run smoke            (Linux CI / headless: xvfb-run -a npm run smoke)
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { app } = require('electron');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-smoke-'));
app.setPath('userData', tmp);
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ setupDone: true }));
process.env.BB_CONFIG = path.join(__dirname, 'mock-config.js');

const bb = require('../src/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const look = (i) => bb.views[i].view.webContents.executeJavaScript('mockState()');
const muted = (i) => bb.views[i].view.webContents.isAudioMuted();

async function snapshot(label) {
  const s = await Promise.all([0, 1, 2].map(look));
  console.log(label, 'active=' + bb.state.active, JSON.stringify(s), 'muted=' + [0, 1, 2].map(muted));
  return s;
}

app.whenReady().then(async () => {
  try {
    await sleep(2500);
    let s = await snapshot('start   ');
    assert.equal(bb.state.active, 0);
    assert.deepEqual(s[0].playing, [0]);
    assert.deepEqual(s[1].playing, [], 'hidden feed must be paused');
    assert.deepEqual(s[2].playing, []);
    assert.deepEqual([0, 1, 2].map(muted), [false, true, true]);

    // One full rotation: each platform we leave advances in the background.
    for (const [expectActive, advanced] of [[1, 0], [2, 1], [0, 2]]) {
      bb.navigate('next');
      await sleep(1600);
      s = await snapshot('next    ');
      assert.equal(bb.state.active, expectActive);
      assert.equal(s[advanced].index, 1, `platform ${advanced} should be on its 2nd video`);
      for (let i = 0; i < 3; i++) {
        if (i === expectActive) continue;
        assert.deepEqual(s[i].playing, [], `hidden feed ${i} must be paused`);
        assert.equal(muted(i), true, `hidden feed ${i} must be muted`);
      }
    }
    assert.deepEqual(s[0].playing, [1], 'returning to a feed plays its preloaded next video');

    bb.navigate('prev');
    await sleep(1200);
    s = await snapshot('prev    ');
    assert.equal(bb.state.active, 2);
    assert.equal(s[2].index, 1, 'prev must not advance');
    assert.deepEqual(s[2].playing, [1]);

    // Wheel on the visible feed counts as a swipe and the site does not scroll itself.
    const wc = bb.views[2].view.webContents;
    wc.sendInputEvent({ type: 'mouseWheel', x: 150, y: 300, deltaX: 0, deltaY: -120 });
    await sleep(1600);
    s = await snapshot('wheel   ');
    assert.equal(bb.state.active, 0, 'wheel should rotate to the next platform');
    assert.equal(s[2].index, 2, 'wheel advanced the feed we left by exactly one');

    // Arrow key on the visible feed.
    bb.views[0].view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    bb.views[0].view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
    await sleep(1600);
    s = await snapshot('arrow   ');
    assert.equal(bb.state.active, 1);
    assert.equal(s[0].index, 2, 'arrow advanced the feed we left by exactly one');

    console.log('\nSMOKE TEST PASSED');
    app.exit(0);
  } catch (err) {
    console.error('\nSMOKE TEST FAILED:', err.message);
    app.exit(1);
  }
});
