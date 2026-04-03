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
import config from "./config";

const host = "https://calendar.notion.so";

const ALLOWED_HOSTNAMES = new Set([
  "calendar.notion.so",
  "calendar-api.notion.so",
]);

function isAllowedUrl(url: string): boolean {
  try {
    return ALLOWED_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

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
            submenu: [{ role: "quit" }],
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
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
    },
  };

  if (lastState.x !== undefined && lastState.y !== undefined) {
    windowOptions.x = lastState.x;
    windowOptions.y = lastState.y;
  }

  const window = new BrowserWindow(windowOptions);

  window.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
      window.webContents.toggleDevTools();
    }
  });

  window.on("ready-to-show", () => {
    window.show();
  });

  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedUrl(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  window.webContents.once("dom-ready", () => {
    window.webContents.executeJavaScript(NOTIFICATION_PATCH_SCRIPT, false).catch(() => {});
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
    const url = sender.getURL();
    if (!url || url === "about:blank") return false;
    return isAllowedUrl(url);
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
  if (typeof o.title !== "string" || typeof o.body !== "string") return null;
  const out: {
    title: string;
    body: string;
    data?: string;
    actions?: Array<{ action: string; title: string }>;
  } = { title: o.title, body: o.body };
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

function dispatchNativeNotification(data: unknown): void {
  console.log("[NotionCalendar] notification payload:", JSON.stringify(data, null, 2));

  const parsed = parseNotificationPayload(data);
  if (!parsed) return;

  console.log("[NotionCalendar] join URL extracted:", extractJoinUrlFromParsed(parsed) ?? "(none)");

  const joinUrl = extractJoinUrlFromParsed(parsed);
  const buttonLabel = pickJoinButtonLabel(parsed.actions);
  const title = parsed.title.slice(0, 256);
  const body = parsed.body.slice(0, 8192);

  const args: string[] = [
    "--app-name=Notion Calendar",
    `--icon=${getAppIconPath()}`,
    "--urgency=critical",
    "--expire-time=0",
    "--wait",
  ];

  // `default` opens the calendar when the user clicks the notification body (often not shown as a button).
  // When a meeting link exists, a single `join` action is the only visible button.
  args.push("--action=default=Open Calendar");
  if (joinUrl) {
    args.push(`--action=join=${buttonLabel}`);
  }

  args.push("--", title, body);

  const child = execFile("notify-send", args, { timeout: 900_000 }, (_error, stdout) => {
    const action = stdout.trim();
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

  sess.serviceWorkers.on("registration-completed", async (_event, details) => {
    if (!isAllowedUrl(details.scope)) return;
    try {
      const worker = await sess.serviceWorkers.startWorkerForScope(details.scope);
      if (worker) attachWorker(worker);
    } catch {
      /* worker may already be running or scope unavailable */
    }
  });

  setTimeout(() => {
    try {
      const running = sess.serviceWorkers.getAllRunning();
      for (const versionId of Object.keys(running)) {
        const worker = sess.serviceWorkers.getWorkerFromVersionID(Number(versionId));
        if (worker) attachWorker(worker);
      }
    } catch {
      /* ignore */
    }
  }, 2000);
}

function setupNotificationForwarding(): void {
  ipcMain.on("show-notification", (event, data: unknown) => {
    if (!isTrustedNotificationSender(event)) return;
    dispatchNativeNotification(data);
  });
}

function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "notifications") {
      callback(true);
      return;
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === "notifications") {
      return true;
    }
    return false;
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

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders["User-Agent"] = CHROME_UA;
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
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
