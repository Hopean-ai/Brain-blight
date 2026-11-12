// Three fake platforms, each forced to use a different advance strategy.
const url = require('node:url').pathToFileURL(require('node:path').join(__dirname, 'mock-feed.html')).href;

module.exports = {
  platforms: [
    { id: 'mock-key', name: 'Keys', feedUrl: url + '#keys', loginUrl: url, itemSelector: '.item', advance: [{ type: 'key', key: 'ArrowDown' }], verifyMs: 500 },
    { id: 'mock-click', name: 'Click', feedUrl: url + '#click', loginUrl: url, itemSelector: null, advance: [{ type: 'click', selector: '#nope' }, { type: 'click', selector: '#next' }], verifyMs: 500 },
    { id: 'mock-scroll', name: 'Scroll', feedUrl: url + '#scroll', loginUrl: url, itemSelector: '.item', advance: [{ type: 'scroll' }], verifyMs: 500 },
    { id: 'mock-extra', name: 'Extra', defaultOn: false, feedUrl: url + '#scroll', loginUrl: url, itemSelector: '.item', advance: [{ type: 'scroll' }], verifyMs: 500 },
  ],
  input: { cooldownMs: 300 },
};
