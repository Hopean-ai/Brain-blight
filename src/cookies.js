'use strict';

// Parses a cookie export from a normal browser so you can sign in there (where
// Google's own checks pass) and carry that login into the app.
//
// Accepted formats:
//   - Netscape "cookies.txt" (e.g. the "Get cookies.txt LOCALLY" extension)
//   - JSON array (e.g. the "Cookie-Editor" extension's Export > JSON)
//
// Returns objects ready for Electron's session.cookies.set().

const SAME_SITE = {
  no_restriction: 'no_restriction',
  none: 'no_restriction',
  lax: 'lax',
  strict: 'strict',
  unspecified: 'unspecified',
};

function toElectronCookie(c) {
  if (!c.name || !c.domain) return null;
  const domain = String(c.domain);
  const host = domain.replace(/^\./, '');
  const path = c.path || '/';
  const secure = !!c.secure || c.name.startsWith('__Secure-') || c.name.startsWith('__Host-');
  const out = {
    url: `${secure ? 'https' : 'http'}://${host}${path}`,
    name: String(c.name),
    value: String(c.value ?? ''),
    path,
    secure,
    httpOnly: !!c.httpOnly,
  };
  // A leading dot (or hostOnly: false) means "this domain and subdomains".
  // __Host- cookies must stay host-only.
  const hostOnly = c.hostOnly ?? !domain.startsWith('.');
  if (!hostOnly && !c.name.startsWith('__Host-')) out.domain = domain.startsWith('.') ? domain : `.${domain}`;
  const exp = Number(c.expirationDate ?? c.expires ?? 0);
  if (!c.session && exp > 0) out.expirationDate = exp;
  const ss = SAME_SITE[String(c.sameSite || '').toLowerCase()];
  if (ss) out.sameSite = ss;
  return out;
}

function parseNetscape(text) {
  const cookies = [];
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (!line.trim() || line.startsWith('#')) {
      continue;
    }
    const f = line.split('\t');
    if (f.length < 7) continue;
    const [domain, includeSub, path, secure, expires, name, ...rest] = f;
    cookies.push({
      domain,
      hostOnly: includeSub.toUpperCase() !== 'TRUE',
      path,
      secure: secure.toUpperCase() === 'TRUE',
      expirationDate: Number(expires) || 0,
      name,
      value: rest.join('\t'),
      httpOnly,
    });
  }
  return cookies;
}

function parseCookieFile(text) {
  const trimmed = text.trim();
  let raw;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed);
    raw = Array.isArray(json) ? json : json.cookies || [];
  } else {
    raw = parseNetscape(text);
  }
  return raw.map(toElectronCookie).filter(Boolean);
}

// Keep only cookies for the sites this platform needs, so a whole-browser
// export doesn't spill unrelated logins into the app.
function forDomains(cookies, domains) {
  if (!domains || domains.length === 0) return cookies;
  return cookies.filter((c) => {
    const host = new URL(c.url).hostname;
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  });
}

module.exports = { parseCookieFile, forDomains };
