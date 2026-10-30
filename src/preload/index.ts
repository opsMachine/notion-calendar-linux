import { contextBridge, ipcRenderer } from "electron";
import {
  CHROME_APP_VERSION,
  CHROME_FULL_VERSION,
  CHROME_UA,
  NAVIGATOR_PLATFORM,
  NAVIGATOR_VENDOR,
  UA_BRANDS,
  UA_FULL_VERSION_LIST,
  UA_PLATFORM,
  UA_PLATFORM_VERSION,
} from "../shared/user-agent";

// Main-world overrides before any page script runs. Notion's bundle checks
// /electron/i.test(navigator.userAgent); feature gates may also use
// navigator.platform, vendor, appVersion, webdriver, and Client Hints.
// `navigator.platform` is not reliably overridable on the instance — use
// Navigator.prototype. Spoof userAgentData so JS APIs align with the macOS
// UA we send on the wire (see main process + disable-blink-features).
(function injectNavigatorOverrides() {
  const SPOOF_UA = CHROME_UA;
  const brands = UA_BRANDS;
  const script = document.createElement("script");
  script.textContent = `(function(){
    if (window.__notionCalendarNavSpoofApplied) return;
    window.__notionCalendarNavSpoofApplied = true;
    try {
      if (typeof process !== "undefined" && process.versions) {
        delete process.versions.electron;
      }
    } catch (e) {}
    var UA = ${JSON.stringify(SPOOF_UA)};
    var brands = ${JSON.stringify(brands)};
    var platform = ${JSON.stringify(UA_PLATFORM)};
    var fullVersionList = ${JSON.stringify(UA_FULL_VERSION_LIST)};
    var fake = {
      brands: brands,
      mobile: false,
      platform: platform,
      toJSON: function () {
        return { brands: brands, mobile: false, platform: platform };
      },
      getHighEntropyValues: function () {
        return Promise.resolve({
          architecture: "x86",
          bitness: "64",
          brands: brands,
          fullVersionList: fullVersionList,
          mobile: false,
          model: "",
          platform: platform,
          platformVersion: ${JSON.stringify(UA_PLATFORM_VERSION)},
          uaFullVersion: ${JSON.stringify(CHROME_FULL_VERSION)},
          wow64: false,
        });
      },
    };
    try {
      Object.defineProperty(Navigator.prototype, "userAgent", {
        get: function () { return UA; },
        configurable: true,
      });
    } catch (e) {}
    try {
      Object.defineProperty(Navigator.prototype, "platform", {
        get: function () { return ${JSON.stringify(NAVIGATOR_PLATFORM)}; },
        configurable: true,
      });
    } catch (e) {}
    try {
      Object.defineProperty(Navigator.prototype, "userAgentData", {
        get: function () { return fake; },
        configurable: true,
      });
    } catch (e) {}
    var appVer = ${JSON.stringify(CHROME_APP_VERSION)};
    try {
      Object.defineProperty(Navigator.prototype, "appVersion", {
        get: function () { return appVer; },
        configurable: true,
      });
    } catch (e) {}
    try {
      Object.defineProperty(Navigator.prototype, "vendor", {
        get: function () { return ${JSON.stringify(NAVIGATOR_VENDOR)}; },
        configurable: true,
      });
    } catch (e) {}
    try {
      Object.defineProperty(Navigator.prototype, "webdriver", {
        get: function () { return false; },
        configurable: true,
      });
    } catch (e) {}
    try {
      Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
        get: function () { return 0; },
        configurable: true,
      });
    } catch (e) {}
  })();`;
  const run = (): void => {
    if (!document.documentElement) return;
    document.documentElement.prepend(script);
    script.remove();
  };
  run();
  if (!document.documentElement) {
    const onReady = (): void => {
      if (document.readyState === "loading") return;
      document.removeEventListener("readystatechange", onReady);
      run();
    };
    document.addEventListener("readystatechange", onReady);
  }
})();

const sendToMain = ipcRenderer.send.bind(ipcRenderer);

type NotionCalendarNotificationPayload = {
  title: string;
  body: string;
  data?: string;
  actions?: Array<{ action: string; title: string }>;
};

contextBridge.exposeInMainWorld("notionCalendar", {
  showNotification: (payload: NotionCalendarNotificationPayload) => {
    sendToMain("show-notification", {
      title: String(payload.title).slice(0, 256),
      body: String(payload.body ?? "").slice(0, 8192),
      data: payload.data,
      actions: payload.actions?.map((a) => ({
        action: String(a.action).slice(0, 128),
        title: String(a.title).slice(0, 128),
      })),
    });
  },
});
