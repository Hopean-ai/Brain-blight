// Unit test for the cookie-export parser.   node test/cookies.test.js
const assert = require('node:assert/strict');
const { parseCookieFile, forDomains } = require('../src/cookies');

const txt = [
  '# Netscape HTTP Cookie File',
  '.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSAPISID\tabc/def',
  '#HttpOnly_.google.com\tTRUE\t/\tTRUE\t1893456000\t__Secure-3PSID\tsecret',
  'accounts.google.com\tFALSE\t/\tTRUE\t1893456000\t__Host-GAPS\thost',
  '.example.com\tTRUE\t/\tFALSE\t0\tother\tx',
  '',
].join('\n');

const a = parseCookieFile(txt);
assert.equal(a.length, 4);
assert.deepEqual(a[0], { url: 'https://youtube.com/', name: 'SAPISID', value: 'abc/def', path: '/', secure: true, httpOnly: false, domain: '.youtube.com', expirationDate: 1893456000 });
assert.equal(a[1].httpOnly, true);
assert.equal(a[2].domain, undefined, '__Host- cookies stay host-only');
assert.equal(a[3].expirationDate, undefined, 'expiry 0 means session cookie');

const kept = forDomains(a, ['youtube.com', 'google.com']).map((c) => c.name);
assert.deepEqual(kept, ['SAPISID', '__Secure-3PSID', '__Host-GAPS']);

// Cookie-Editor style JSON
const json = JSON.stringify([
  { domain: '.youtube.com', hostOnly: false, name: 'PREF', value: 'f6=1', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction', expirationDate: 1893456000.5 },
  { domain: 'www.youtube.com', hostOnly: true, name: 'VISITOR', value: 'v', path: '/', secure: true, session: true, sameSite: 'lax' },
]);
const b = parseCookieFile(json);
assert.equal(b[0].domain, '.youtube.com');
assert.equal(b[0].sameSite, 'no_restriction');
assert.equal(b[1].domain, undefined);
assert.equal(b[1].url, 'https://www.youtube.com/');
assert.equal(b[1].expirationDate, undefined);

assert.throws(() => parseCookieFile('[not json'));
console.log('COOKIE PARSER TEST PASSED');
