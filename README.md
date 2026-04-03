# Notion Calendar (Linux desktop)

Electron wrapper for [Notion Calendar](https://calendar.notion.so): **minimize to tray**, **native desktop notifications** (via `notify-send` / libnotify), and **persisted window size and position**.

**Linux only** — there are **no macOS or Windows builds** here; anything outside Linux is untested and unsupported.

**Tested environment:** **Ubuntu 24.04** with **KDE Plasma** (including correct window icon grouping via `StartupWMClass` in packaged builds). Other distros or desktops may work but have not been validated.

## About

Unofficial Electron wrapper for [Notion Calendar](https://calendar.notion.so) on Linux. MIT — see [LICENSE](LICENSE).

Originally by **[Dušan Simić](https://dusansimic.me)** ([dusansimic/notion-calendar](https://github.com/dusansimic/notion-calendar)). This codebase extends that baseline with updated dependencies, stricter Electron defaults, tray behavior, and Linux-native notification handling.

Related community work and packaging were also iterated in **[opsmachine/notion-calendar](https://github.com/opsmachine/notion-calendar)** (optional; not required to run or build this project).

## Features

- **Tray** — Closing the window **minimizes to the system tray** instead of quitting. Tray menu: show/hide, quit, developer tools. **Single-instance**: launching again focuses the existing window.
- **Native notifications (Linux)** — Calendar alerts are **not** shown with Electron’s built-in `Notification` API. The main process runs **`notify-send`** (from **libnotify**) so notifications match your desktop environment (e.g. KDE), including **critical** urgency and **action buttons** where supported.
  - **Click the notification body** → focuses the app (freedesktop **`default`** action).
  - **Join / meeting link** → when a URL is detected in the payload, a single **Join**-style action opens that link in the default browser.
  - **Reminder timing** (e.g. 10 minutes vs 1 minute before) comes from **Source Calendar / per-calendar settings**, not from this wrapper.
- **Bridging** — The page **main world** and **service worker** contexts are patched so `Notification` and `ServiceWorkerRegistration.showNotification` forward to the main process over validated IPC (preload + dedicated service-worker preload).
- **Window state** — Last **width, height, and position** are restored via `electron-store`.
- **Chrome-like user agent** — A pinned Chrome-on-Linux user agent is applied (see `CHROME_UA` in `src/main/index.ts`) so the embedded site behaves like a normal desktop browser session.
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
| Navigation | In-window navigation is limited to the Notion Calendar app and its API host; other URLs are opened in the **system default browser** instead of staying inside the app window |
| New windows | Same host allowlist as navigation; external targets are not kept as captive Electron windows |
| IPC | Renderer IPC checks the sender URL against the Notion hosts; service-worker IPC checks the worker scope. Payloads are validated and title/body lengths are capped before `notify-send` runs |
| Permissions | Session permission handlers only grant **notifications**; other permission requests are denied |
| Native notify | `notify-send` is invoked with `execFile` (no shell), with bounded arguments |

- **Email / password sign-in** — Signing in with **email and password in the main calendar page** works in typical use.

## Known limitations

- **OAuth / social sign-in** — Third-party login often relies on **popups** or extra windows to identity providers (e.g. Google). This wrapper’s window and navigation rules treat those flows in ways that **do not complete inside the app** today, so OAuth-based sign-in **may not work**.
- **Notification appearance** — Action styling and colors follow **your Plasma / desktop theme**, not the Notion web app.

If you need OAuth in-app, it would require a dedicated, reviewed approach (e.g. carefully scoped `window.open` / redirect handling for provider URLs), not a quick toggle.

## Development

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

*Last updated: 2026-04-03 (Europe/Vienna)*
