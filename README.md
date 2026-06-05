# Unofficial Notion Calendar (Linux desktop)

Electron wrapper for [Notion Calendar](https://calendar.notion.so): **minimize to tray**, **native desktop notifications** (via `notify-send` / libnotify), and **persisted window size and position**.

**Linux only** — there are **no macOS or Windows builds** here; anything outside Linux is untested and unsupported.

**Tested environment:** **Ubuntu 24.04** with **KDE Plasma** (including correct window icon grouping via `StartupWMClass` in packaged builds). Other distros or desktops may work but have not been validated.

## Fork

This repo (**[opsmachine/notion-calendar](https://github.com/opsmachine/notion-calendar)**) is a **fork** of **[dusansimic/notion-calendar](https://github.com/dusansimic/notion-calendar)**. Thanks to the original author for the app baseline and MIT license.

Upstream is a minimal Linux-friendly wrapper; this fork adds updated dependencies, stricter Electron defaults, tray behavior, and Linux-native notification actions.

## Features in this fork

- **Tray** — Closing the window (**X** button or **Ctrl+W**) **hides to the system tray** instead of quitting. Tray menu: show/hide, quit, developer tools. **Single-instance**: launching again focuses the existing window.
- **Start minimized to tray** — In **File → Start minimized to tray**, enable the option to persist across launches, or start once with **`notion-calendar --start-in-tray`** (main window stays hidden until you open it from the tray). For **session autostart**, put flags before any desktop field codes, e.g. `Exec=notion-calendar --start-in-tray %U` in a **`~/.config/autostart/`** `.desktop` file (or your desktop’s login-applications UI).
- **Native notifications (Linux)** — Calendar alerts are **not** shown with Electron’s built-in `Notification` API. The main process runs **`notify-send`** (from **libnotify**) so notifications match your desktop environment (e.g. KDE), including **critical** urgency and **action buttons** where supported.
  - **Click the notification body** → focuses the app (freedesktop **`default`** action).
  - **Join / meeting link** → when a URL is detected in the payload, a single **Join**-style action opens that link in the default browser.
  - **Reminder timing** (e.g. 10 minutes vs 1 minute before) comes from **Source Calendar / per-calendar settings**, not from this wrapper.
- **Bridging** — The page **main world** and **service worker** contexts are patched so `Notification` and `ServiceWorkerRegistration.showNotification` forward to the main process over validated IPC (preload + dedicated service-worker preload).
- **Window state** — Last **width, height, and position** are restored via `electron-store`.
- **Looking like desktop Chrome on macOS (Notion funnel bypass)** — Notion Calendar often **starts at `https://calendar.notion.so`** but their bundle can **client-side navigate** to **`www.notion.com`** (“download the official desktop app”) when it thinks you are on Linux, Electron, or automation-flavored Chromium. This fork aligns **network and JS** signals so the SPA tends to stay on the calendar:
  - Main process: pinned **Chrome-on-macOS** `User-Agent`, macOS **Client Hints** on every request (`CHROME_UA` / `applyMacClientHints` in `src/main/index.ts`), **`disable-blink-features=AutomationControlled`**, and **`Cache-Control: no-cache`** on the calendar main document to reduce stale gate HTML.
  - Preload: main-world **`Navigator.prototype`** overrides for **`userAgent`**, **`platform`**, **`userAgentData`** (incl. high-entropy), **`appVersion`**, **`vendor`**, **`webdriver`**, **`maxTouchPoints`**, plus removing **`process.versions.electron`** when present so in-page checks match the wire UA.
- **Marketing-page guard** — If a navigation to **`www.notion.com`** under **`/product/calendar`** or **`/product/notion-calendar`** still happens, the shell **blocks it** and reloads **`https://calendar.notion.so`** (bounded retries so we do not spin forever). After too many attempts, use **View → Open Notion Calendar (home)** (`Ctrl+Shift+H`) — it **resets that counter** and reloads home with the spoofed UA (also useful after login if you land elsewhere; see limitations below).
- **Packaging** — `npm run build:linux` builds a **`.deb`**. `electron-builder.yaml` also lists rpm/flatpak targets, but the npm script is wired to Debian only right now. Icons and Freedesktop metadata (including `StartupWMClass`) are set so the app groups correctly in the taskbar and launcher on KDE and similar desktops.
- **Developer experience** — Application menu (with **Alt** to reveal the menu bar on Linux when it is hidden), **F12** / **Ctrl+Shift+I** to toggle DevTools, tray entry for DevTools. The main process **logs each notification payload and extracted join URL to stdout** whenever a notification is dispatched—useful when you run **`npm run dev`** or **`npm start`** from a terminal.

## Requirements

- **Linux** with a notification server that supports **`notify-send`** from **libnotify** (standard on Ubuntu and KDE Plasma).
- Install if missing, e.g. `sudo apt install libnotify-bin`.

## Security-related hardening

These are **defense-in-depth** measures; they do not replace a formal audit and do not imply the app is “fully secure.”

| Area | Implementation |
|------|------------|
| Renderer | `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, `sandbox: true` |
| Navigation | In-window navigation is limited to allowed **hostnames** (`calendar.notion.so`, `calendar-api.notion.so`, `notion.so`, `www.notion.so`, `www.notion.com`, `app.notion.com`, `exp.notion.so`, `calendar-te.notion.so`), matched with `URL` / hostname checks (not raw string prefixes, so lookalike domains cannot spoof the list). Other URLs open in the **system default browser**. Specific **`www.notion.com`** product-calendar marketing URLs are blocked and replaced with a reload of **`calendar.notion.so`** (see Features). |
| HTTP response shaping | For **HTML** responses on first-party Notion hosts we load in-app (**`calendar.notion.so`**, **`www.notion.so`**, **`notion.so`**, **`app.notion.com`**), **`Content-Security-Policy`** (and CSP report-only) are removed. **Tradeoff:** CSP is an extra layer against **XSS on those origins**; stripping it only inside this process means **slightly weaker defense-in-depth** than stock Chrome if Notion’s pages were ever vulnerable—you already execute their full web app here, so risk is **scoped and low**, not an open door to the rest of your system. Calendar needs the strip so the preload inline script can run (`script-src` has no `'unsafe-inline'`). Main Notion pages otherwise block some `connect-src` targets their bundle still calls (e.g. **`api.ipify.org`**), which can break client logic in Electron. |
| Representation to Notion | **UA / Client Hints / `navigator` spoofing** tells Notion’s servers and scripts you are **Chrome on macOS**. That bypasses their **unofficial-client** steering; it is **not** a local privilege escalation, but it is intentional misrepresentation toward their site (same broad class as changing UA in a normal browser). |
| New windows | Same hostname allowlist as navigation; external targets are not kept as captive Electron windows |
| IPC | Renderer notification IPC requires the sender frame URL to use an allowed hostname; **`about:blank` / empty senders are rejected**. Service-worker IPC checks the worker **scope** the same way. Payloads are validated and title/body lengths are capped before `notify-send` runs |
| Permissions | Session permission handlers grant **notifications** and **clipboard** read/write (for copy buttons in the calendar UI); other permission requests are denied |
| Native notify | `notify-send` is invoked with `execFile` (no shell), with bounded arguments |

**Repository hygiene:** `.env` files, `*.pem` / `*.key`, and similar patterns are in [`.gitignore`](.gitignore) to reduce the risk of committing secrets or keys by mistake.

- **Email / password sign-in** — Signing in with **email and password in the main calendar page** works in typical use.

## Known limitations

- **Post-login redirect (Notion-controlled)** — After you sign in, Notion’s **servers** may send you to **www.notion.so** / **app.notion.com** (the main Notion app) instead of **calendar.notion.so**. This wrapper cannot change that without a **documented, stable “return to calendar” URL or OAuth `redirect_uri`** from Notion for unofficial clients (we do not have one). Heuristic “snap back” in the shell was **removed** as unreliable duct tape. **Workaround:** **View → Open Notion Calendar (home)** (`Ctrl+Shift+H`) reloads the calendar origin in the same window once your session cookie exists (and resets the marketing-navigation retry counter if needed).
- **Notion may change detection** — If they ship new client checks (TLS, behavioral scoring, etc.), the calendar could start redirecting again; issues are easier to debug with **DevTools → Network** and the main-process logs.
- **OAuth / social sign-in** — Third-party login often relies on **popups** or extra windows to identity providers (e.g. Google). This wrapper’s window and navigation rules treat those flows in ways that **do not complete inside the app** today, so OAuth-based sign-in **may not work**.
- **Notification appearance** — Action styling and colors follow **your Plasma / desktop theme**, not the Notion web app.

If you need OAuth in-app, it would require a dedicated, reviewed approach (e.g. carefully scoped `window.open` / redirect handling for provider URLs), not a quick toggle.

## Development

If your shell sets **`ELECTRON_RUN_AS_NODE=1`** (some Node tooling does), Electron runs as plain Node: `require('electron')` breaks and the window never appears. **`npm run dev`** / **`npm start`** unset it via `env -u ELECTRON_RUN_AS_NODE`. To run the binary yourself after `npm run prebuild`:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron . --no-sandbox
```

(or `npm run run:electron`)

The app uses a **dedicated user-data directory** (`notion-calendar-electron-wrapper` under your OS app config folder) so its Chromium profile does not collide with Google Chrome or other Electron apps — that avoids service-worker DB lock errors and odd “second session” behavior. If the calendar ever wedges, quit the app and delete that folder to reset local storage (you will be signed out of the web session).

```bash
npm install
npm run dev
```

Preview production bundle:

```bash
npm start
```

Linux package (see `electron-builder.yaml`):

```bash
npm run build:linux
```

## License

MIT — see [LICENSE](LICENSE).

---

*Last updated: 2026-05-06 11:49 (America/Toronto)*
