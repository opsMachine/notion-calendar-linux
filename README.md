# Notion Calendar (Linux desktop)

Electron wrapper for [Notion Calendar](https://calendar.notion.so): tray icon, desktop notifications, and window state persistence.

## Fork

This repository is a **fork** of **[dusansimic/notion-calendar](https://github.com/dusansimic/notion-calendar)**. Thanks to the original author for the app baseline and MIT license.

Upstream focuses on a minimal Linux-friendly wrapper; this fork extends that with updated dependencies, stronger Electron defaults, and clearer notification handling.

## Changes in this fork

- **Electron & tooling** — Bumped Electron, electron-vite, electron-builder, TypeScript, and related dev dependencies to current releases used by the project.
- **Preload & renderer bridge** — Preload script built with electron-vite; the page uses a small `contextBridge` API for notification-related IPC instead of exposing Node to the web app.
- **Notifications** — Web `Notification` usage is bridged to the main process so calendar alerts can use the system notification path consistently on Linux.
- **User-Agent** — A current Chrome-on-Linux user agent is applied so the embedded site behaves like a supported desktop browser where it matters.
- **Icon** — Updated application/tray icon asset.

## Security-related hardening

These are **defense-in-depth** measures; they do not replace a formal audit and do not imply the app is “fully secure.”

| Area | What we do |
|------|------------|
| Renderer | `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, `sandbox: true` |
| Navigation | In-window navigation is limited to the Notion Calendar app and its API host; other URLs are opened in the **system default browser** instead of staying inside the app window |
| New windows | Same host allowlist as navigation; external targets are not kept as captive Electron windows |
| IPC | Notification IPC checks the sender frame URL against the allowlist, validates payload types, and caps title/body length before showing a system notification |
| Permissions | Session permission handlers only grant **notifications**; other permission requests are denied |

## Known limitations

- **OAuth / social sign-in** — Third-party login often relies on **popups** or extra windows to identity providers (e.g. Google). This wrapper’s window and navigation rules treat those flows in ways that **do not complete inside the app** today, so OAuth-based sign-in **may not work**.
- **Email / password sign-in** — Signing in with **email and password in the main calendar page** works in typical use.

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

*Last updated: 2026-03-29 (Europe/Vienna)*
