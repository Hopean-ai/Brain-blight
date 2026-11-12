# Brain Blight on iPhone

The iPhone app works the same way as the desktop app: TikTok, Instagram Reels and YouTube Shorts each run as their own logged-in page, only one is visible, and every swipe up moves the platform you're leaving to its next video and then shows the next platform. Swipe down goes back a platform without skipping anything.

Apple won't allow an app like this in the App Store, so you install it yourself ("sideloading"). It needs **iOS 17 or newer**.

## Option A: no Mac needed (Windows or Mac)

GitHub builds the app for you on every push, so you only have to install it.

1. **Get the app file.** Download **[BrainBlight-unsigned.ipa](https://github.com/Hopean-ai/Brain-blight/releases/latest/download/BrainBlight-unsigned.ipa)**. That link always points at the newest build, and the file is also listed on the repo's **Releases** page. (Each build run on the **Actions** tab also keeps a zipped copy for 30 days.)
2. **Install [Sideloadly](https://sideloadly.io)** on your computer (on Windows, also install iTunes and iCloud from Apple's website, not the Microsoft Store).
3. Plug in your iPhone, open Sideloadly, drag in the `.ipa`, type your Apple ID, and press **Start**. Sideloadly signs the app with your Apple ID and installs it.
4. On the iPhone:
   - **Settings → Privacy & Security → Developer Mode** → turn it on and restart (only asked once).
   - **Settings → General → VPN & Device Management** → tap your Apple ID → **Trust**.
5. Open Brain Blight.

## Option B: Mac with Xcode

```bash
brew install xcodegen
npm run ios:config            # copies config/platforms.js into the app
cd ios && xcodegen generate
open BrainBlight.xcodeproj
```

In Xcode, select the **BrainBlight** target → *Signing & Capabilities* → pick your Team (your Apple ID works). If it says the bundle ID is taken, change it to anything unique. Plug in your iPhone, pick it as the run destination, and press **Run**. You'll also need Developer Mode and Trust, as in step 4 above.

## The 7-day limit

With a free Apple ID, Apple makes sideloaded apps stop opening after **7 days**. Re-install the same way (your logins are kept). Sideloadly can refresh it automatically while your phone and computer are on the same Wi-Fi. A paid Apple Developer account ($99/year) makes it last a year.

## Using it

- **First launch** walks you through each platform's login page. Tap *Next* to move on, or *Done* to skip the rest. Come back any time with **Log in** in the top bar.
- **If a site won't let you sign in** (Google sometimes blocks sign-in inside apps), import the login from your computer's browser instead:
  1. On your computer, open a private/incognito window, sign in to the site (for example youtube.com), and export its cookies with the **Get cookies.txt LOCALLY** extension. Close the window without signing out.
  2. Send the file to your iPhone (iCloud Drive, AirDrop, or email it to yourself and save it to Files).
  3. In the app, tap **Log in**, go to that platform's step, tap **Import**, and pick the file.
  4. Delete the file afterwards, since it holds your login.
- **Swipe up** for next, **swipe down** to go back a platform, **tap a name** in the top bar to jump to it.
- Swipes that start inside a comments or caption panel scroll that panel normally.
- The speaker button mutes and unmutes. Sound plays even with the silent switch on.

## When a site changes

The iPhone app uses the same [`config/platforms.js`](../config/platforms.js) as the desktop app, plus each platform's `ios` overrides (mobile sites have different layouts). After editing it, run `npm run ios:config`, commit, and reinstall from the new build. If a platform stops moving on, the app shows a warning under the top bar.
