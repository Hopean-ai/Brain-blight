import UIKit
import UniformTypeIdentifiers
import WebKit

/// The whole app: one persistent WKWebView per platform, stacked in the same
/// spot. Only the top one is "active". Hidden ones have their media suspended
/// and the injected agent keeps their videos paused. Every "next" advances the
/// platform you are leaving (in the background, so its next video is loaded
/// when you come back) and then shows the next platform.
final class FeedViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate, UIDocumentPickerDelegate {
    private enum Mode: String { case feed, setup }

    private final class Page {
        let platform: Platform
        let webView: WKWebView
        init(platform: Platform, webView: WKWebView) {
            self.platform = platform
            self.webView = webView
        }
    }

    private let config = AppConfig.load()
    private var pages: [Page] = []
    private var active = 0
    private var mode: Mode = .feed
    private var setupIndex = 0
    private var muted = false
    private var lastNav = Date.distantPast
    private var notice: String?

    // UI
    private let container = UIView()
    private let feedBar = UIStackView()
    private let pillStack = UIStackView()
    private let muteButton = UIButton(type: .system)
    private let setupBar = UIStackView()
    private let setupLabel = UILabel()
    private let setupImport = UIButton(type: .system)
    private let setupBack = UIButton(type: .system)
    private var importTarget: Page?
    private let setupNext = UIButton(type: .system)
    private let setupDone = UIButton(type: .system)
    private let noticeLabel = UILabel()

    private static let setupDoneKey = "setupDone"

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildUI()

        for platform in config.platforms {
            let page = Page(platform: platform, webView: makeWebView(for: platform))
            pages.append(page)
            container.addSubview(page.webView)
            page.webView.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                page.webView.topAnchor.constraint(equalTo: container.topAnchor),
                page.webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                page.webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                page.webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            ])
        }

        if UserDefaults.standard.bool(forKey: Self.setupDoneKey) {
            // Load every feed up front so each platform's first video is ready.
            pages.forEach { load($0, $0.platform.feedUrl) }
            setActive(0)
        } else {
            startSetup(at: 0)
        }
    }

    // MARK: - Web views

    /// Each platform gets its own persistent cookie/storage jar, so logins
    /// stay separate and survive relaunches. The ID is created once and kept.
    private func storeIdentifier(for platformId: String) -> UUID {
        let key = "store.\(platformId)"
        if let s = UserDefaults.standard.string(forKey: key), let id = UUID(uuidString: s) { return id }
        let id = UUID()
        UserDefaults.standard.set(id.uuidString, forKey: key)
        return id
    }

    private func makeWebView(for platform: Platform) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: storeIdentifier(for: platform.id))
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // Look like mobile Safari rather than an in-app browser.
        configuration.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1"

        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(
            source: bootScript(for: platform) + Self.agentSource,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true,
            in: .defaultClient
        ))
        controller.add(WeakMessageHandler(self), contentWorld: .defaultClient, name: "bb")
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.uiDelegate = self
        webView.navigationDelegate = self
        return webView
    }

    private static let agentSource: String = {
        guard
            let url = Bundle.main.url(forResource: "feed-agent", withExtension: "js"),
            let source = try? String(contentsOf: url, encoding: .utf8)
        else { fatalError("feed-agent.js is missing from the app bundle.") }
        return source
    }()

    private func bootScript(for platform: Platform) -> String {
        let encoder = JSONEncoder()
        let platformJSON = (try? encoder.encode(platform)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let inputJSON = (try? encoder.encode(config.input)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.__bbBoot = { platform: \(platformJSON), input: \(inputJSON) };\n"
    }

    private func load(_ page: Page, _ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        page.webView.load(URLRequest(url: url))
    }

    private func run(_ js: String, in page: Page) {
        page.webView.evaluateJavaScript(js + ";0", in: nil, in: .defaultClient) { _ in }
    }

    private func page(for webView: WKWebView?) -> Page? {
        pages.first { $0.webView === webView }
    }

    // MARK: - Rotation

    private func pushState(_ page: Page) {
        let isActive = pages.indices.contains(active) && pages[active] === page
        page.webView.setAllMediaPlaybackSuspended(!isActive) {}
        run("window.__bb && window.__bb.setState({active: \(isActive), mode: '\(mode.rawValue)', muted: \(muted)})", in: page)
    }

    private func setActive(_ index: Int) {
        guard !pages.isEmpty else { return }
        active = ((index % pages.count) + pages.count) % pages.count
        container.bringSubviewToFront(pages[active].webView)
        pages.forEach(pushState)
        updateBars()
    }

    private func navigate(next: Bool) {
        guard mode == .feed, !pages.isEmpty else { return }
        let cooldown = (config.input?.cooldownMs ?? 450) / 1000
        guard Date().timeIntervalSince(lastNav) >= cooldown else { return }
        lastNav = Date()
        notice = nil

        guard next else {
            setActive(active - 1) // back to the previous platform, nothing skipped
            return
        }
        let leaving = pages[active]
        if pages.count > 1 { setActive(active + 1) }
        run("window.__bb && window.__bb.advance()", in: leaving)
    }

    // MARK: - First-run login

    private func startSetup(at index: Int) {
        mode = .setup
        notice = nil
        setupGo(index)
    }

    private func setupGo(_ index: Int) {
        guard !pages.isEmpty else { return }
        setupIndex = max(0, min(pages.count - 1, index))
        setActive(setupIndex)
        let page = pages[setupIndex]
        load(page, page.platform.loginUrl ?? page.platform.feedUrl)
    }

    private func finishSetup() {
        mode = .feed
        UserDefaults.standard.set(true, forKey: Self.setupDoneKey)
        pages.forEach { load($0, $0.platform.feedUrl) }
        setActive(0)
    }

    // MARK: - Import a login from a browser cookie export

    /// For when a site refuses to sign in inside the app: sign in with a normal
    /// browser, export its cookies to a file, and pick that file here.
    private func startImport() {
        guard pages.indices.contains(setupIndex) else { return }
        importTarget = pages[setupIndex]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.plainText, .json, .text, .data], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let page = importTarget, let url = urls.first else { return }
        importTarget = nil
        guard let data = try? Data(contentsOf: url) else {
            showAlert("Import failed", "That file couldn't be read.")
            return
        }
        let text = String(decoding: data, as: UTF8.self)
        let cookies = CookieImport.cookies(from: text, keeping: page.platform.cookieDomains)
        guard !cookies.isEmpty else {
            let sites = (page.platform.cookieDomains ?? []).joined(separator: ", ")
            showAlert("No \(page.platform.name) login found", "Export the cookies while signed in on \(sites), then try again.")
            return
        }
        let store = page.webView.configuration.websiteDataStore.httpCookieStore
        let group = DispatchGroup()
        for cookie in cookies {
            group.enter()
            store.setCookie(cookie) { group.leave() }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            self.load(page, page.platform.feedUrl)
            self.showAlert(
                "Imported your \(page.platform.name) login",
                "\(cookies.count) cookies imported. The feed is reloading. You should now be signed in. Delete the cookie file afterwards."
            )
        }
    }

    private func showAlert(_ title: String, _ message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            let body = message.body as? [String: Any],
            let type = body["type"] as? String,
            let page = page(for: message.webView)
        else { return }

        switch type {
        case "hello":
            pushState(page)
        case "nav":
            // Only the visible feed may drive navigation.
            if pages.indices.contains(active), pages[active] === page {
                navigate(next: (body["dir"] as? String) != "prev")
            }
        case "advanced":
            if (body["ok"] as? Bool) != true {
                notice = "Couldn't move \(page.platform.name) to its next video. Check its selectors in config/platforms.js."
                updateBars()
            }
        default:
            break
        }
    }

    // MARK: - WKNavigationDelegate / WKUIDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        // Stay in the app: block "open in TikTok/Instagram/YouTube app" links.
        let scheme = navigationAction.request.url?.scheme?.lowercased() ?? ""
        let allowed = ["http", "https", "about", "blob", "data"].contains(scheme)
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard let page = page(for: webView) else { return }
        load(page, mode == .setup ? (page.platform.loginUrl ?? page.platform.feedUrl) : page.platform.feedUrl)
    }

    /// Login flows sometimes open popups. Show them in a sheet that shares the
    /// opener's configuration (and so its login storage).
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.uiDelegate = self
        popup.navigationDelegate = self
        let holder = UIViewController()
        holder.view = popup
        holder.navigationItem.rightBarButtonItem = UIBarButtonItem(
            systemItem: .done,
            primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) }
        )
        present(UINavigationController(rootViewController: holder), animated: true)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        if page(for: webView) == nil, presentedViewController != nil {
            dismiss(animated: true)
        }
    }

    // MARK: - UI

    private func buildUI() {
        let bar = UIView()
        bar.backgroundColor = UIColor(red: 0.043, green: 0.043, blue: 0.059, alpha: 1)
        [bar, container, noticeLabel].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview($0)
        }
        container.backgroundColor = .black

        noticeLabel.font = .systemFont(ofSize: 12)
        noticeLabel.textColor = UIColor(red: 1, green: 0.7, blue: 0.28, alpha: 1)
        noticeLabel.backgroundColor = UIColor.black.withAlphaComponent(0.75)
        noticeLabel.numberOfLines = 2
        noticeLabel.textAlignment = .center
        noticeLabel.isHidden = true

        // Feed bar: platform pills, mute, log in.
        pillStack.axis = .horizontal
        pillStack.spacing = 4
        muteButton.addAction(UIAction { [weak self] _ in self?.toggleMute() }, for: .touchUpInside)
        let loginButton = Self.ghostButton("Log in")
        loginButton.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.startSetup(at: self.active)
        }, for: .touchUpInside)
        feedBar.axis = .horizontal
        feedBar.spacing = 6
        feedBar.alignment = .center
        [pillStack, UIView(), muteButton, loginButton].forEach(feedBar.addArrangedSubview)

        // Setup bar: "Log in to X (1/3)", Back, Next, Done.
        setupLabel.textColor = .lightGray
        setupLabel.font = .systemFont(ofSize: 13)
        setupLabel.adjustsFontSizeToFitWidth = true
        setupLabel.minimumScaleFactor = 0.8
        setupImport.setTitle("Import", for: .normal)
        setupBack.setTitle("Back", for: .normal)
        setupDone.setTitle("Done", for: .normal)
        [setupImport, setupBack, setupDone].forEach { $0.tintColor = .lightGray }
        setupImport.addAction(UIAction { [weak self] _ in self?.startImport() }, for: .touchUpInside)
        setupNext.configuration = Self.pillConfig(title: "Next", selected: true)
        setupBack.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.setupGo(self.setupIndex - 1)
        }, for: .touchUpInside)
        setupNext.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            if self.setupIndex >= self.pages.count - 1 { self.finishSetup() } else { self.setupGo(self.setupIndex + 1) }
        }, for: .touchUpInside)
        setupDone.addAction(UIAction { [weak self] _ in self?.finishSetup() }, for: .touchUpInside)
        setupBar.axis = .horizontal
        setupBar.spacing = 8
        setupBar.alignment = .center
        [setupLabel, UIView(), setupImport, setupBack, setupNext, setupDone].forEach(setupBar.addArrangedSubview)
        setupLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        [feedBar, setupBar].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            bar.addSubview($0)
            NSLayoutConstraint.activate([
                $0.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 8),
                $0.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -8),
                $0.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
                $0.heightAnchor.constraint(equalToConstant: 44),
            ])
        }

        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 44),

            container.topAnchor.constraint(equalTo: bar.bottomAnchor),
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            container.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            noticeLabel.topAnchor.constraint(equalTo: bar.bottomAnchor),
            noticeLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            noticeLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    private func updateBars() {
        let setup = mode == .setup
        feedBar.isHidden = setup
        setupBar.isHidden = !setup

        pillStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for (i, page) in pages.enumerated() {
            let button = UIButton(configuration: Self.pillConfig(title: page.platform.name, selected: i == active))
            button.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                self.notice = nil
                self.setActive(i)
            }, for: .touchUpInside)
            pillStack.addArrangedSubview(button)
        }

        muteButton.setImage(UIImage(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill"), for: .normal)
        muteButton.tintColor = .white

        noticeLabel.text = notice
        noticeLabel.isHidden = notice == nil || setup
        view.bringSubviewToFront(noticeLabel)

        if setup, pages.indices.contains(setupIndex) {
            let last = setupIndex >= pages.count - 1
            setupLabel.text = "Log in to \(pages[setupIndex].platform.name) (\(setupIndex + 1)/\(pages.count))"
            setupBack.isEnabled = setupIndex > 0
            setupNext.configuration = Self.pillConfig(title: last ? "Start" : "Next", selected: true)
            setupDone.isHidden = last
        }
    }

    private func toggleMute() {
        muted.toggle()
        if pages.indices.contains(active) { pushState(pages[active]) }
        updateBars()
    }

    private static func pillConfig(title: String, selected: Bool) -> UIButton.Configuration {
        var c = UIButton.Configuration.filled()
        c.title = title
        c.cornerStyle = .capsule
        c.baseBackgroundColor = selected
            ? UIColor(red: 1, green: 0.24, blue: 0.43, alpha: 1)
            : UIColor(red: 0.11, green: 0.11, blue: 0.14, alpha: 1)
        c.baseForegroundColor = .white
        c.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 11, bottom: 6, trailing: 11)
        c.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attrs in
            var a = attrs
            a.font = .systemFont(ofSize: 13, weight: .medium)
            return a
        }
        return c
    }

    private static func ghostButton(_ title: String) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.tintColor = .lightGray
        b.titleLabel?.font = .systemFont(ofSize: 13)
        return b
    }
}

/// WKUserContentController holds its handlers strongly; this breaks the cycle.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
