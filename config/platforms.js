// Every site-specific detail lives in this file.
//
// When a site changes its layout and Brain Blight stops advancing, this is the
// only file you should need to touch. Each platform gets:
//
//   id          Stable key. Also names the persistent login partition
//               ("persist:<id>"), so changing it logs you out of that platform.
//   name        Label shown in the top bar.
//   enabled     Set to false to drop a platform from the rotation.
//   feedUrl     Page that shows the vertical short-form feed.
//   loginUrl    Page opened during first-run / "Log in" setup.
//   itemSelector  CSS selector for one feed item (the card that holds a video).
//               Optional: when it matches nothing we fall back to <video> tags.
//   advance     Ordered list of ways to move to the next video. They are tried
//               one by one; after each we wait `verifyMs` and check whether the
//               centred video changed. The first one that works wins.
//                 { type: 'click',  selector: '...' }  click a "next" button
//                 { type: 'scroll' }                   scroll the next item
//                                                      into view
//                 { type: 'key', key: 'ArrowDown' }    press a key in the page
//   verifyMs    How long to wait before deciding a step did nothing.
//   cookieDomains  Sites whose cookies "Import login from browser" keeps for
//               this platform (everything else in the file is ignored).
//   ios         Optional overrides used only by the iPhone app (mobile sites
//               have different URLs and layouts). Run `npm run ios:config`
//               after editing so the iPhone app picks them up.

module.exports = {
  // Order here is the rotation order.
  platforms: [
    {
      id: 'tiktok',
      name: 'TikTok',
      enabled: true,
      feedUrl: 'https://www.tiktok.com/foryou',
      loginUrl: 'https://www.tiktok.com/login',
      cookieDomains: ['tiktok.com'],
      itemSelector: '[data-e2e="recommend-list-item-container"], article[data-scroll-index]',
      advance: [
        { type: 'key', key: 'ArrowDown' },
        { type: 'click', selector: 'button[data-e2e="arrow-right"], [data-e2e="feed-navigation-down"], button[aria-label*="next" i]' },
        { type: 'scroll' },
      ],
      verifyMs: 900,
      ios: {
        advance: [
          { type: 'scroll' },
          { type: 'click', selector: 'button[data-e2e="arrow-right"], button[aria-label*="next" i]' },
          { type: 'key', key: 'ArrowDown' },
        ],
      },
    },
    {
      id: 'instagram',
      name: 'Reels',
      enabled: true,
      feedUrl: 'https://www.instagram.com/reels/',
      loginUrl: 'https://www.instagram.com/accounts/login/',
      cookieDomains: ['instagram.com'],
      // Instagram uses generated class names, so we rely on the <video> fallback.
      itemSelector: null,
      advance: [
        { type: 'scroll' },
        { type: 'key', key: 'ArrowDown' },
      ],
      verifyMs: 900,
    },
    {
      id: 'youtube',
      name: 'Shorts',
      enabled: true,
      feedUrl: 'https://www.youtube.com/shorts',
      loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Fshorts',
      // Google blocks sign-in inside apps. Sign in in your normal browser and
      // use "Import login from browser" instead (see README).
      cookieDomains: ['youtube.com', 'google.com'],
      itemSelector: 'ytd-reel-video-renderer',
      advance: [
        { type: 'click', selector: '#navigation-button-down button, button[aria-label="Next video"]' },
        { type: 'key', key: 'ArrowDown' },
        { type: 'scroll' },
      ],
      verifyMs: 900,
      ios: {
        feedUrl: 'https://m.youtube.com/shorts',
        loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fm.youtube.com%2Fshorts',
        itemSelector: 'ytm-reel-item-renderer, ytm-shorts-player-renderer',
        advance: [{ type: 'scroll' }, { type: 'key', key: 'ArrowDown' }],
      },
    },
  ],

  // Wheel / trackpad tuning (shared by all platforms).
  input: {
    wheelThreshold: 40, // accumulated deltaY before a scroll counts as a swipe
    wheelQuietMs: 220, // a new swipe needs this much wheel silence first
    swipeMinPx: 60, // touch swipe distance
    cooldownMs: 450, // minimum gap between two advances
  },
};
