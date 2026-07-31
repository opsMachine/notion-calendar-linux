import {
  BrowserWindow,
  Tray,
  Menu,
  app,
  shell,
  session,
  ipcMain,
  nativeImage,
} from "electron";
import { execFile } from "child_process";
import * as path from "path";
import { optimizer } from "@electron-toolkit/utils";
// Side effects: userData path + name must run before Store ctor (see config.ts).
import config from "./config";

// Before `app.ready`. Reduces automation-oriented signals some sites combine with UA heuristics.
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");

const host = "https://calendar.notion.so";

const ALLOWED_HOSTNAMES = new Set([
  "calendar.notion.so",
  "calendar-api.notion.so",
  // Email/password (and other first-party) sign-in often leaves calendar.* for www / apex Notion.
  "notion.so",
  "www.notion.so",
  // Marketing download funnel; allow in-window so we do not spawn Chrome (noisy + confusing).
  "www.notion.com",
  // Referenced in calendar CSP (connect-src); the SPA may top-level navigate here after auth / workspace flows.
  "app.notion.com",
  "exp.notion.so",
  "calendar-te.notion.so",
]);

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only gate http(s). Other schemes (e.g. blob:, about:) have no hostname here; blocking them breaks loads.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true;
    }
    return ALLOWED_HOSTNAMES.has(parsed.hostname);
  } catch {
    return true;
  }
}

/** Client-side redirect from the calendar SPA to "get the official desktop app" marketing. Keep users on the web app. */
function isCalendarDesktopMarketingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== "www.notion.com") return false;
    const p = u.pathname.toLowerCase();
    return p.startsWith("/product/calendar") || p.startsWith("/product/notion-calendar");
  } catch {
    return false;
  }
}

/** After this many blocked marketing navigations, stop calling `loadURL` (avoids thrash). Reset via View → Open Notion Calendar (home). */
const MAX_MARKETING_REDIRECT_RELOADS = 5;
const marketingRedirectReloadsByWebContentsId = new Map<number, number>();

// Never reset the marketing-redirect counter on `did-navigate` to calendar.notion.so: the SPA
// loads there first, then client-navigates to www.notion.com/product/calendar/… — resetting
// on every calendar navigation undoes the cap and causes an infinite reload loop.

function marketingRedirectReloadCount(contents: Electron.WebContents): number {
  return marketingRedirectReloadsByWebContentsId.get(contents.id) ?? 0;
}

function bumpMarketingRedirectReloadCount(contents: Electron.WebContents): number {
  const next = marketingRedirectReloadCount(contents) + 1;
  marketingRedirectReloadsByWebContentsId.set(contents.id, next);
  return next;
}

function resetMarketingRedirectReloadCount(contents: Electron.WebContents): void {
  marketingRedirectReloadsByWebContentsId.delete(contents.id);
}

function reloadCalendarHome(contents: Electron.WebContents): void {
  void contents.loadURL(host, { userAgent: CHROME_UA });
}

function attachWebNavigationGuards(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedUrl(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isCalendarDesktopMarketingUrl(url)) {
      event.preventDefault();
      const n = bumpMarketingRedirectReloadCount(contents);
      if (n > MAX_MARKETING_REDIRECT_RELOADS) {
        console.warn(
          "[NotionCalendar] stayed on marketing page after",
          MAX_MARKETING_REDIRECT_RELOADS,
          "reload attempts; use View → Open Notion Calendar (home) or sign in on the web.",
        );
        return;
      }
      reloadCalendarHome(contents);
      return;
    }
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  contents.on("will-redirect", (event, url) => {
    if (isCalendarDesktopMarketingUrl(url)) {
      event.preventDefault();
      const n = bumpMarketingRedirectReloadCount(contents);
      if (n > MAX_MARKETING_REDIRECT_RELOADS) {
        console.warn(
          "[NotionCalendar] redirect to marketing page exceeded retry limit; open DevTools → Network if this persists.",
        );
        return;
      }
      reloadCalendarHome(contents);
      return;
    }
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

// Notion Calendar (post ~2026-05-05) can redirect unofficial wrappers to the download page.
// Spoof macOS in both the UA string and Client Hints — Statsig / feature gates often use
// Sec-CH-UA-Platform ("Linux") even when User-Agent is overridden.
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

/** Strip Chromium's default Linux hints and send macOS-aligned low-entropy hints. */
function applyMacClientHints(headers: Record<string, string | string[] | undefined>): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().startsWith("sec-ch-ua")) {
      delete headers[key];
    }
  }
  headers["Sec-CH-UA"] =
    '"Chromium";v="135", "Google Chrome";v="135", "Not;A=Brand";v="99"';
  headers["Sec-CH-UA-Mobile"] = "?0";
  headers["Sec-CH-UA-Platform"] = '"macOS"';
}

/**
 * Notion HTML documents ship strict CSP (no `unsafe-inline` for scripts, tight `connect-src`).
 * (1) Our preload injects a small inline main-world script on calendar — CSP must be stripped there.
 * (2) On www/app Notion, the same CSP blocks third-party calls their own bundle still makes (e.g.
 * `api.ipify.org`), which can surface as failed fetches and odd post-login behavior in Electron.
 * We strip CSP only for **HTML** responses on first-party Notion hosts we navigate to in-app.
 */
const CSP_STRIP_HTML_HOSTS = new Set([
  "calendar.notion.so",
  "www.notion.so",
  "notion.so",
  "app.notion.com",
]);

function urlHostReceivesHtmlCspStrip(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && CSP_STRIP_HTML_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function setupNotionFirstPartyHtmlCspBypass(sess: Electron.Session): void {
  sess.webRequest.onHeadersReceived((details, callback) => {
    try {
      if (!urlHostReceivesHtmlCspStrip(details.url)) {
        callback({});
        return;
      }
      const headers = details.responseHeaders;
      if (!headers) {
        callback({});
        return;
      }
      let contentType = "";
      let hasCsp = false;
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === "content-type") {
          const v = headers[key];
          contentType = (Array.isArray(v) ? v[0] : v) ?? "";
        }
        if (lower === "content-security-policy" || lower === "content-security-policy-report-only") {
          hasCsp = true;
        }
      }
      if (!contentType.toLowerCase().includes("text/html") || !hasCsp) {
        callback({});
        return;
      }
      const out: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (lower === "content-security-policy" || lower === "content-security-policy-report-only") {
          continue;
        }
        out[key] = value;
      }
      callback({ statusLine: details.statusLine, responseHeaders: out });
    } catch {
      callback({});
    }
  });
}

/** Light inset so the web app is not flush against the window frame (KDE/Wayland). */
const WRAPPER_INSET_CSS = `
html { box-sizing: border-box; height: 100%; }
body {
  box-sizing: border-box;
  margin: 0 !important;
  padding: 6px 10px 10px 10px !important;
  min-height: 100%;
}
`;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const NOTIFICATION_PATCH_SCRIPT = `
(function () {
  if (window.__notionCalendarNotificationPatched) return;
  window.__notionCalendarNotificationPatched = true;
  function buildPayload(title, options) {
    options = options || {};
    var body = options.body != null ? String(options.body) : "";
    var payload = { title: String(title), body: body };
    if (options.data !== undefined) {
      try {
        payload.data = typeof options.data === "string" ? options.data : JSON.stringify(options.data);
      } catch (e) {}
    }
    if (options.actions && options.actions.length) {
      payload.actions = options.actions.map(function (a) {
        return { action: a.action, title: a.title };
      });
    }
    return payload;
  }
  var Native = window.Notification;
  function ForwardingNotification(title, options) {
    options = options || {};
    if (window.notionCalendar && typeof window.notionCalendar.showNotification === "function") {
      window.notionCalendar.showNotification(buildPayload(title, options));
    }
    var body = options.body != null ? String(options.body) : "";
    var fake = Object.create(Native.prototype);
    fake.title = String(title);
    fake.body = body;
    fake.tag = options.tag != null ? String(options.tag) : "";
    fake.silent = !!options.silent;
    fake.close = function () {};
    fake.onclick = null;
    fake.onerror = null;
    fake.onshow = null;
    fake.onclose = null;
    return fake;
  }
  ForwardingNotification.prototype = Native.prototype;
  Object.defineProperty(ForwardingNotification, "permission", {
    get: function () { return "granted"; },
  });
  ForwardingNotification.requestPermission = function () {
    return Promise.resolve("granted");
  };
  window.Notification = ForwardingNotification;
  try {
    var SWReg = window.ServiceWorkerRegistration;
    if (SWReg && SWReg.prototype && SWReg.prototype.showNotification) {
      var origShow = SWReg.prototype.showNotification;
      SWReg.prototype.showNotification = function (title, options) {
        if (window.notionCalendar && typeof window.notionCalendar.showNotification === "function") {
          window.notionCalendar.showNotification(buildPayload(title, options || {}));
        }
        return origShow.apply(this, arguments);
      };
    }
  } catch (e) {}
})();
`;

function getAppIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "build", "icon.png");
  }
  return path.join(__dirname, "..", "..", "build", "icon.png");
}

function setupAppMenu(): void {
  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "reload" },
      {
        label: "Open Notion Calendar (home)",
        accelerator: "CmdOrCtrl+Shift+H",
        click: (_item, focusedWindow) => {
          const win =
            focusedWindow instanceof BrowserWindow ? focusedWindow : mainWindow ?? undefined;
          if (win) {
            resetMarketingRedirectReloadCount(win.webContents);
            void win.loadURL(host, { userAgent: CHROME_UA });
          }
        },
      },
      { type: "separator" },
      {
        label: "Toggle Developer Tools",
        accelerator: "CmdOrCtrl+Shift+I",
        click: (_item, focusedWindow) => {
          if (focusedWindow instanceof BrowserWindow) {
            focusedWindow.webContents.toggleDevTools();
          }
        },
      },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
    ],
  };

  const template: Electron.MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          viewMenu,
        ]
      : [
          {
            label: "File",
            submenu: [
              {
                label: "Start minimized to tray",
                type: "checkbox",
                checked: config.get("startMinimizedToTray") === true,
                click: (menuItem) => {
                  config.set("startMinimizedToTray", menuItem.checked);
                },
              },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          viewMenu,
        ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const lastState = config.store.lastWindowState;

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: lastState.width,
    height: lastState.height,
    show: false,
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    title: "Notion Calendar",
    // Dark chrome behind the webview reduces visible flash/jank while the page paints (notably in dev).
    backgroundColor: "#191919",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  };

  if (lastState.x !== undefined && lastState.y !== undefined) {
    windowOptions.x = lastState.x;
    windowOptions.y = lastState.y;
  }

  const window = new BrowserWindow(windowOptions);

  const startInTray =
    config.get("startMinimizedToTray") === true || app.commandLine.hasSwitch("start-in-tray");

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.control && !input.meta && input.key.toLowerCase() === "w") {
      event.preventDefault();
      window.hide();
      return;
    }
    if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
      window.webContents.toggleDevTools();
    }
  });

  window.on("ready-to-show", () => {
    if (!startInTray) {
      window.show();
    }
  });

  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.webContents.on("dom-ready", () => {
    window.webContents.executeJavaScript(NOTIFICATION_PATCH_SCRIPT, false).catch(() => {});
  });

  window.webContents.on("did-finish-load", () => {
    void window.webContents.insertCSS(WRAPPER_INSET_CSS, { cssOrigin: "user" });
  });

  window.loadURL(host, { userAgent: CHROME_UA });

  return window;
}

function createTray(): Tray {
  const iconPath = getAppIconPath();
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 });
  const appTray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show / Hide",
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow?.show();
          mainWindow?.focus();
        }
      },
    },
    {
      label: "Developer Tools",
      click: () => {
        mainWindow?.webContents.toggleDevTools();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  appTray.setToolTip("Notion Calendar");
  appTray.setContextMenu(contextMenu);

  appTray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  return appTray;
}

function saveWindowState(): void {
  if (!mainWindow) return;
  const bounds = mainWindow.getNormalBounds();
  config.set("lastWindowState.width", bounds.width);
  config.set("lastWindowState.height", bounds.height);
  config.set("lastWindowState.x", bounds.x);
  config.set("lastWindowState.y", bounds.y);
}

function isTrustedNotificationSender(event: Electron.IpcMainEvent): boolean {
  const sender = event.sender;
  if (!sender || sender.isDestroyed()) return false;
  try {
    const urls: string[] = [];
    const mainUrl = sender.getURL();
    if (mainUrl) urls.push(mainUrl);
    try {
      const frameUrl = event.senderFrame?.url;
      if (frameUrl) urls.push(frameUrl);
    } catch {
      /* frame may be gone */
    }
    try {
      const topUrl = sender.mainFrame?.url;
      if (topUrl) urls.push(topUrl);
    } catch {
      /* ignore */
    }
    for (const url of urls) {
      if (url === "about:blank") continue;
      if (isAllowedUrl(url)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const URL_HINT_KEYS = [
  "url",
  "href",
  "link",
  "joinUrl",
  "meetingUrl",
  "meetingURL",
  "calendarEventUrl",
  "eventUrl",
  "conferenceUrl",
  "conferenceLink",
  "hangoutLink",
  "meetUrl",
  "entryPoints",
  "zoomUrl",
  "zoomMeetingUrl",
  "videoConferenceUrl",
];

/** Meeting links we may open via the desktop shell (https web + common app protocols). */
function isJoinMeetingUrlString(s: string): boolean {
  const t = s.trim();
  return (
    /^https?:\/\//i.test(t) ||
    /^zoommtg:\/\//i.test(t) ||
    /^msteams:\/\//i.test(t)
  );
}

function isSafeExternalMeetingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") return true;
    if (u.protocol === "zoommtg:" || u.protocol === "msteams:") return true;
    return false;
  } catch {
    return false;
  }
}

function pickJoinButtonLabel(actions: Array<{ action: string; title: string }> | undefined): string {
  if (!actions?.length) return "Join call";
  const preferred = actions.find((a) => /join|call|meet|zoom|teams|video|link/i.test(a.title));
  return (preferred ?? actions[0]).title.slice(0, 64);
}

function extractJoinUrlFromParsed(payload: {
  body: string;
  data?: string;
  actions?: Array<{ action: string; title: string }>;
}): string | undefined {
  if (payload.data) {
    try {
      const d = JSON.parse(payload.data) as Record<string, unknown>;
      const stack: unknown[] = [d];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;
        const obj = cur as Record<string, unknown>;
        for (const key of URL_HINT_KEYS) {
          const v = obj[key];
          if (typeof v === "string" && isJoinMeetingUrlString(v)) return v.trim();
          if (v && typeof v === "object") stack.push(v);
        }
        for (const v of Object.values(obj)) {
          if (v && typeof v === "object") stack.push(v);
          if (typeof v === "string" && isJoinMeetingUrlString(v)) return v.trim();
        }
      }
    } catch {
      const m = payload.data.match(/(?:https?:\/\/|zoommtg:\/\/)[^\s"'<>]+/i);
      if (m) return m[0].replace(/[),.;]+$/u, "");
    }
  }
  const bodyMatch = payload.body.match(/(?:https?:\/\/|zoommtg:\/\/)[^\s)\]]+/iu);
  if (bodyMatch) return bodyMatch[0].replace(/[),.;]+$/u, "");
  return undefined;
}

function parseNotificationPayload(data: unknown): {
  title: string;
  body: string;
  data?: string;
  actions?: Array<{ action: string; title: string }>;
} | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  let title = o.title != null ? String(o.title).trim().slice(0, 256) : "";
  let body = o.body != null ? String(o.body).slice(0, 8192) : "";
  if (!title && !body.trim()) return null;
  if (!title) title = "Notion Calendar";
  const out: {
    title: string;
    body: string;
    data?: string;
    actions?: Array<{ action: string; title: string }>;
  } = { title, body };
  if (typeof o.data === "string") out.data = o.data;
  if (Array.isArray(o.actions)) {
    const actions: Array<{ action: string; title: string }> = [];
    for (const item of o.actions) {
      if (!item || typeof item !== "object") continue;
      const a = item as Record<string, unknown>;
      if (typeof a.action === "string" && typeof a.title === "string") {
        actions.push({ action: a.action, title: a.title });
      }
    }
    if (actions.length) out.actions = actions;
  }
  return out;
}

function logNotificationPayloadForDebug(data: unknown): void {
  try {
    console.log("[NotionCalendar] notification payload:", JSON.stringify(data, null, 2));
  } catch {
    console.log("[NotionCalendar] notification payload: (unserializable)");
  }
}

/** Shared notify-send flags. Plasma 6.4+ keeps action notifications resident unless marked transient. */
function buildNotifySendBaseArgs(): string[] {
  return [
    "--app-name=Notion Calendar",
    `--icon=${getAppIconPath()}`,
    "--urgency=normal",
    "--transient",
    "--expire-time=-1",
    "--hint=string:desktop-entry:notion-calendar",
  ];
}

/** Minimal notify-send when the full action-capable command fails (older libnotify, bad flags, etc.). */
function notifySendMinimal(title: string, body: string): void {
  const args = [...buildNotifySendBaseArgs(), "--", title, body];
  execFile("notify-send", args, (err) => {
    if (err) console.error("[NotionCalendar] notify-send (minimal) failed:", err.message);
  });
}

function dispatchNativeNotification(data: unknown): void {
  logNotificationPayloadForDebug(data);

  const parsed = parseNotificationPayload(data);
  if (!parsed) {
    console.warn("[NotionCalendar] dropped notification: could not parse payload");
    return;
  }

  console.log("[NotionCalendar] join URL extracted:", extractJoinUrlFromParsed(parsed) ?? "(none)");

  const joinUrl = extractJoinUrlFromParsed(parsed);
  const buttonLabel = pickJoinButtonLabel(parsed.actions);
  const title = parsed.title.slice(0, 256);
  const body = parsed.body.slice(0, 8192);

  const args: string[] = [...buildNotifySendBaseArgs(), "--wait"];

  // `default` opens the calendar when the user clicks the notification body (often not shown as a button).
  // When a meeting link exists, a single `join` action is the only visible button.
  args.push("--action=default=Open Calendar");
  if (joinUrl) {
    args.push(`--action=join=${buttonLabel}`);
  }

  args.push("--", title, body);

  const child = execFile("notify-send", args, { timeout: 120_000 }, (err, stdout) => {
    if (err) {
      console.error("[NotionCalendar] notify-send failed:", err.message);
      notifySendMinimal(title, body);
      return;
    }
    const action = (stdout ?? "").trim();
    if (action === "join" && joinUrl && isSafeExternalMeetingUrl(joinUrl)) {
      void shell.openExternal(joinUrl);
    } else if (action === "default") {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  child.unref();
}

function registerServiceWorkerPreload(sess: Electron.Session): void {
  const swPath = path.normalize(path.join(__dirname, "..", "preload", "sw.js"));
  sess.registerPreloadScript({
    type: "service-worker",
    filePath: swPath,
  });
}

function setupServiceWorkerNotificationBridge(sess: Electron.Session): void {
  const attachWorker = (worker: Electron.ServiceWorkerMain): void => {
    if (!isAllowedUrl(worker.scope)) return;
    worker.ipc.removeAllListeners("show-notification");
    worker.ipc.on("show-notification", (event, data: unknown) => {
      if (!isAllowedUrl(event.serviceWorker.scope)) return;
      dispatchNativeNotification(data);
    });
  };

  const attachAllRunningWorkers = (): void => {
    try {
      const running = sess.serviceWorkers.getAllRunning();
      for (const versionId of Object.keys(running)) {
        const worker = sess.serviceWorkers.getWorkerFromVersionID(Number(versionId));
        if (worker) attachWorker(worker);
      }
    } catch {
      /* ignore */
    }
  };

  sess.serviceWorkers.on("registration-completed", async (_event, details) => {
    const scope = details?.scope;
    if (!scope || !isAllowedUrl(scope)) return;
    try {
      const worker = await sess.serviceWorkers.startWorkerForScope(scope);
      if (worker) attachWorker(worker);
    } catch (e) {
      console.warn("[NotionCalendar] startWorkerForScope failed:", scope, e);
    }
  });

  sess.serviceWorkers.on("running-status-changed", (ev) => {
    if (ev.runningStatus !== "running") return;
    try {
      const worker = sess.serviceWorkers.getWorkerFromVersionID(ev.versionId);
      if (worker) attachWorker(worker);
    } catch {
      /* ignore */
    }
  });

  setTimeout(attachAllRunningWorkers, 0);
  setTimeout(attachAllRunningWorkers, 2000);
}

function setupNotificationForwarding(): void {
  ipcMain.on("show-notification", (event, data: unknown) => {
    if (!isTrustedNotificationSender(event)) return;
    dispatchNativeNotification(data);
  });
}

const GRANTED_SESSION_PERMISSIONS = new Set([
  "notifications",
  "clipboard-read",
  "clipboard-sanitized-write",
]);

function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(GRANTED_SESSION_PERMISSIONS.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return GRANTED_SESSION_PERMISSIONS.has(permission);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerServiceWorkerPreload(session.defaultSession);
    setupNotionFirstPartyHtmlCspBypass(session.defaultSession);

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders } as Record<string, string | string[] | undefined>;
      headers["User-Agent"] = CHROME_UA;
      applyMacClientHints(headers);
      if (
        details.resourceType === "mainFrame" &&
        details.url.startsWith("https://calendar.notion.so/")
      ) {
        headers["Cache-Control"] = "no-cache";
        headers["Pragma"] = "no-cache";
      }
      callback({ cancel: false, requestHeaders: headers as Record<string, string | string[]> });
    });

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
      attachWebNavigationGuards(window.webContents);
    });

    setupPermissions();
    setupNotificationForwarding();
    setupServiceWorkerNotificationBridge(session.defaultSession);
    setupAppMenu();

    session.defaultSession.setUserAgent(CHROME_UA);
    mainWindow = createWindow();
    tray = createTray();

    app.on("before-quit", () => {
      isQuitting = true;
      saveWindowState();
      tray?.destroy();
      tray = null;
    });
  });
}
