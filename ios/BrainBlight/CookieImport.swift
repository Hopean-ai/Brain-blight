import Foundation

/// Parses a cookie export from a normal browser, so a login made there can be
/// carried into the app. Mirrors src/cookies.js on desktop.
///
/// Accepted formats:
///   - Netscape "cookies.txt" (e.g. the "Get cookies.txt LOCALLY" extension)
///   - JSON array (e.g. the "Cookie-Editor" extension's Export > JSON)
enum CookieImport {
    private struct Raw {
        var domain: String
        var hostOnly: Bool
        var path: String
        var secure: Bool
        var httpOnly: Bool
        var expires: Double
        var name: String
        var value: String
        var sameSite: String?
    }

    static func cookies(from text: String, keeping domains: [String]?) -> [HTTPCookie] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let raw = (trimmed.hasPrefix("[") || trimmed.hasPrefix("{")) ? parseJSON(trimmed) : parseNetscape(text)
        return raw.filter { matches($0.domain, domains) }.compactMap(makeCookie)
    }

    private static func matches(_ domain: String, _ allowed: [String]?) -> Bool {
        guard let allowed, !allowed.isEmpty else { return true }
        let host = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
        return allowed.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    private static func parseNetscape(_ text: String) -> [Raw] {
        var out: [Raw] = []
        for var line in text.components(separatedBy: .newlines) {
            var httpOnly = false
            if line.hasPrefix("#HttpOnly_") {
                httpOnly = true
                line = String(line.dropFirst("#HttpOnly_".count))
            } else if line.trimmingCharacters(in: .whitespaces).isEmpty || line.hasPrefix("#") {
                continue
            }
            let f = line.components(separatedBy: "\t")
            guard f.count >= 7 else { continue }
            out.append(Raw(
                domain: f[0],
                hostOnly: f[1].uppercased() != "TRUE",
                path: f[2],
                secure: f[3].uppercased() == "TRUE",
                httpOnly: httpOnly,
                expires: Double(f[4]) ?? 0,
                name: f[5],
                value: f[6...].joined(separator: "\t"),
                sameSite: nil
            ))
        }
        return out
    }

    private static func parseJSON(_ text: String) -> [Raw] {
        guard let data = text.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) else { return [] }
        let list: [[String: Any]]
        if let array = json as? [[String: Any]] {
            list = array
        } else if let object = json as? [String: Any], let array = object["cookies"] as? [[String: Any]] {
            list = array
        } else {
            return []
        }
        return list.compactMap { c in
            guard let name = c["name"] as? String, let domain = c["domain"] as? String else { return nil }
            let session = (c["session"] as? Bool) ?? false
            let expires = (c["expirationDate"] as? NSNumber)?.doubleValue ?? (c["expires"] as? NSNumber)?.doubleValue ?? 0
            return Raw(
                domain: domain,
                hostOnly: (c["hostOnly"] as? Bool) ?? !domain.hasPrefix("."),
                path: (c["path"] as? String) ?? "/",
                secure: (c["secure"] as? Bool) ?? false,
                httpOnly: (c["httpOnly"] as? Bool) ?? false,
                expires: session ? 0 : expires,
                name: name,
                value: (c["value"] as? String) ?? "",
                sameSite: c["sameSite"] as? String
            )
        }
    }

    private static func makeCookie(_ c: Raw) -> HTTPCookie? {
        guard !c.name.isEmpty, !c.domain.isEmpty else { return nil }
        let host = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
        let isHostPrefixed = c.name.hasPrefix("__Host-")
        let secure = c.secure || c.name.hasPrefix("__Secure-") || isHostPrefixed
        // A leading dot means "this domain and its subdomains"; no dot is host-only.
        let domain = (c.hostOnly || isHostPrefixed) ? host : "." + host

        var props: [HTTPCookiePropertyKey: Any] = [
            .name: c.name,
            .value: c.value,
            .domain: domain,
            .path: c.path.isEmpty ? "/" : c.path,
        ]
        if secure { props[.secure] = "TRUE" }
        if c.httpOnly { props[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        if c.expires > 0 { props[.expires] = Date(timeIntervalSince1970: c.expires) }
        switch c.sameSite?.lowercased() {
        case "lax": props[.sameSitePolicy] = HTTPCookieStringPolicy.sameSiteLax
        case "strict": props[.sameSitePolicy] = HTTPCookieStringPolicy.sameSiteStrict
        default: break
        }
        return HTTPCookie(properties: props)
    }
}
