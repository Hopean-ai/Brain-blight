# Brain Blight

A personal desktop app that interlaces **TikTok**, **Instagram Reels** and **YouTube Shorts** into one feed.

It runs on **desktop** (Mac, Windows, Linux) and **iPhone** ([iPhone install guide](ios/README.md)).

It doesn't scrape anything. Each platform runs as its own real, signed-in browser page inside the app, and Brain Blight only decides which one you see and when it moves on.

## How it works

- **One page per platform, logged in for good.** Each platform gets its own persistent browser session (`persist:tiktok`, `persist:instagram`, `persist:youtube`), so you log in once and stay logged in between launches.
- **Only one is visible.** The pages are stacked; the active one is on top. Hidden pages are muted at the browser level, and a small script inside each page keeps their videos paused.
- **Every swipe interlaces.** Scroll, swipe or press <kbd>↓</kbd> and the platform you're leaving moves to its next video in the background, then the app rotates to the next platform: TikTok 1, Reels 1, Shorts 1, TikTok 2, Reels 2, …
- **Switches feel instant.** Because each platform advanced while you were watching the others, its next video is already loaded and paused, waiting for you. Background pages are never throttled.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/Hopean-ai/Brain-blight.git
cd Brain-blight
npm install
npm start
```

### First run: log in

On first launch the top bar walks you through each platform's login page: **Log in to TikTok (1/3)** → *Next* → Reels → *Next* → Shorts → *Start watching*. Skip any you don't want to log in to; most feeds still work logged out.

You can come back to this any time with the **Log in** button or <kbd>Ctrl/Cmd</kbd>+<kbd>L</kbd>.

### Signing in to YouTube (Google)

Google blocks signing in from inside apps ("This browser or app may not be secure"). Instead, sign in with your normal browser and bring that login into the app:

1. In Chrome, Edge, Brave or Firefox, install the **Get cookies.txt LOCALLY** extension. It's open source and never uploads anything.
2. Go to [youtube.com](https://www.youtube.com) and make sure you're signed in.
3. Click the extension and choose **Export** to save a `youtube.com_cookies.txt` file.
4. In Brain Blight, go to YouTube: during setup that's the *Shorts* step, and later you can click **Shorts** in the top bar. Then click **Import login…**, or use **Feed → Import login from browser…** (<kbd>Ctrl/Cmd</kbd>+<kbd>I</kbd>), and pick the file.
5. The Shorts feed reloads signed in. Delete the cookies file afterwards, because it's your login.

The app only keeps the YouTube and Google cookies from the file and stores them in the YouTube session alone. It also works for TikTok or Instagram if their login ever gives you trouble: export while on that site and import while that platform is showing.

If Google signs you out again after a while, repeat the export and import. Google sometimes ties a login to the browser it was created in.

## Controls

| Action | How |
| --- | --- |
| Next (advance + rotate) | Scroll / trackpad swipe down, touch swipe up, <kbd>↓</kbd>, <kbd>Page Down</kbd>, or the **Next** button |
| Back to the previous platform | Scroll up, <kbd>↑</kbd>, <kbd>Page Up</kbd> (doesn't skip anything) |
| Jump to a platform | Click its name in the top bar |
| Scroll normally inside a page (comments, captions) | Hold <kbd>Alt</kbd> while scrolling |
| Mute / unmute | 🔊 button or <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> |
| Reload the current feed (if you clicked away from it) | <kbd>Ctrl/Cmd</kbd>+<kbd>R</kbd> |
| Log in again | **Log in** button or <kbd>Ctrl/Cmd</kbd>+<kbd>L</kbd> |
| Import a login from your browser | **Import login…** (during setup) or <kbd>Ctrl/Cmd</kbd>+<kbd>I</kbd> |

## When a site changes

Everything site-specific is in **[`config/platforms.js`](config/platforms.js)**: feed and login URLs, the selector for a feed item, and an ordered list of ways to move to the next video (press a key, click a button, or scroll the next item into view).

The app tries each way in order and checks whether the centred video actually changed before moving on, so one broken selector usually just means it falls back to the next method. If every method fails for a platform, the top bar says so; that's when to open the config and fix the selector (<kbd>Alt</kbd>+<kbd>Ctrl/Cmd</kbd>+<kbd>I</kbd> opens DevTools for the current feed).

Other things you can set there: turn a platform off (`enabled: false`), change the rotation order, and tune scroll sensitivity. To keep your own config outside the repo, run with `BB_CONFIG=/path/to/my-platforms.js npm start`.

## Known limits

- **Google sign-in** refuses apps like this one, so use [Import login](#signing-in-to-youtube-google) instead. Shorts also works fine logged out.
- These sites change often. Expect to tweak `config/platforms.js` now and then.
- This is for personal use. Respect each platform's terms.

## Development

```bash
npm run check   # syntax check
npm test        # cookie-import parser
npm run smoke   # drives the real app against a fake feed (test/mock-feed.html)
                # on headless Linux: xvfb-run -a npm run smoke
```

The smoke test checks the rotation order, that every hidden feed is paused and muted, that the feed you leave advances by exactly one video, that going back doesn't skip, and that wheel and arrow input both work.

`npm run test:ios-agent` runs the iPhone app's in-page script against the same fake feed in Chromium (needs the `playwright` package). The iPhone app itself is compiled by the **Build** GitHub Actions workflow, which also publishes the installable `.ipa`.

```
config/platforms.js        all site-specific selectors and URLs (desktop + iOS overrides)
src/main.js                desktop: window, one view per platform, rotation, login setup
src/feed-preload.js        desktop: runs inside each site (pause/mute, swipes, advancing)
src/ui/                    desktop: the top bar
ios/BrainBlight/           iPhone app (Swift, WKWebView) + its in-page feed-agent.js
scripts/export-ios-config.js  writes ios/BrainBlight/platforms.json from the config
test/                      mock feed, desktop smoke test, iOS agent test
```
