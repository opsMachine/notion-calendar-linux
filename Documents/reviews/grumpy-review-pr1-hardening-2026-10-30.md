# Grumpy Dev Review: pr1-hardening (`hardening/pr1-vetted` vs `main`)

**Date:** 2026-10-30
**Commit under review:** `e7bb4d2` "security: scope permissions, fail closed on origin trust, update Electron"
**Scope:** `git diff main..hardening/pr1-vetted -- . ':!package-lock.json'`, plus surrounding code in `src/main/index.ts`, `src/preload/index.ts`, `src/sw-preload/index.ts`, `src/shared/user-agent.ts`. Lockfile checked only for version consistency.
**Not done:** I did not launch, reload, or kill the app. A dev instance built from this branch (`out/main/index.js` built 12:18:43 and contains `MAX_CONCURRENT_WAITING_NOTIFY_SEND`) was already running as PID 621919. All runtime evidence below is read-only: `ps`, `journalctl`, `/proc`, and the files on disk.

**What I ran:**
- `npx electron-vite build` in a `git archive` copy under the scratchpad. It passes, and `src/shared/user-agent.ts` is inlined into the sandboxed `out/preload/index.js`, with no stray `require("../shared/...")`.
- `npx tsc --noEmit -p tsconfig.node.json` shows only the known `src/main/config.ts(12,76)` ElectronStore error.
- Node experiments on `execFile`: a synchronous throw on NUL arguments, and the behaviour when the timeout kill is denied.
- A static scan of Notion Calendar's cached JS bundle for clipboard APIs.

---

## Step 0: Prior findings

| Prior review | Status |
|---|---|
| none | `Documents/reviews/` holds only a README. This is the first review in the repo, so there is nothing to close. |

One meta-finding: `Documents/reviews/` is **untracked** (`?? Documents/reviews/` in git status). If it never gets committed, this ledger dies with the working tree and the next review's Step 0 has nothing to read. Commit it or decide it is scratch.

---

## 1. First Impressions

This is a better-than-average outside PR. The comments explain *why* rather than *what*. `isTrustedNotionOrigin` and `isAllowedUrl` sit side by side with "do not merge the two" written on them. The UA spoof finally lives in one file. Payload logging is gated behind `!app.isPackaged`, with the reason (Zoom `pwd=` in the journal) stated. The build is clean.

The PR's weakness is that its notification flood guard was designed against a `notify-send` that exits when you expect it to. **On this machine it doesn't**, and the kernel audit log says so (section 6). Several README claims are also stronger than the code.

## 2. Architecture & Structure

- `src/main/index.ts` is still one ~1,100-line file holding navigation policy, CSP stripping, notification transport, permission policy, crash healing and tray/menu. The PR adds about 100 more lines to it. Pure policy (origin trust, dedupe, the concurrency cap) is precisely the code that should be pulled into a small module so it can be tested. See finding #7.
- The new `src/shared/` directory is the right structure. It is wired into `tsconfig.node.json`, and electron-vite bundles it into both main and preload, which I verified in the build output.
- Dependencies: Electron `^42.9.2` and electron-builder `^26.15.3` in package.json, with the lockfile resolving **42.11.18** and **26.18.0** (the same versions are installed in node_modules). These are consistent, since the ranges are satisfied. The floor in package.json is just not the version anyone tested. 🟢
- Dependabot now covers npm and github-actions next to devcontainers, with no duplicate ecosystem+directory pairs. Fine.

## 3. Single Authority

**Q1. "Which sites count as Notion?"**

| Site | Answers |
|---|---|
| `src/main/index.ts:26-41` `ALLOWED_HOSTNAMES` | navigation allowlist **and now** IPC, service-worker and permission trust (via `isTrustedNotionOrigin`, :65-74) |
| `:189-195` `CSP_STRIP_HTML_HOSTS` | a separate list, and a subset |
| `:1065-1067` `onBeforeSendHeaders` | hardcoded `https://calendar.notion.com/` and `https://calendar.notion.so/` prefixes |
| `:24` `host` | the canonical calendar origin |
| `:79` `isCalendarDesktopMarketingUrl` | hardcoded `www.notion.com` |
| README security table | lists `calendar.notion.so` for CSP strip but **not** `calendar.notion.com`, which is stale since the October move (pre-existing, but this PR edited the same table) |

The PR makes this worse in one specific way. `ALLOWED_HOSTNAMES` used to answer "may this window navigate here?". It now also answers "may this caller spawn `notify-send` and hold permissions?". Those are different questions. `www.notion.com` is on the list only so the marketing funnel does not open Chrome (comment at :36). `exp.notion.so`, `calendar-te.notion.so` and `calendar-api.*` are on it because CSP references them. All of them now inherit IPC and permission trust. Today the answers agree, but they diverge the day someone adds a host to the nav list for a login flow, because trust gets widened silently. **Owner:** a separate `TRUSTED_NOTION_ORIGINS` (calendar `.com` and `.so`, plus whatever actually needs permissions), defined next to `host`. → finding #5

**Q2. "What browser do we claim to be?"** This is now answered once, in `src/shared/user-agent.ts`. The wire headers (`applyMacClientHints`, `session.setUserAgent`, `loadURL({userAgent})`) and the preload `navigator` overrides all import it. Credit where due: this was two hand-synced copies before. The one remaining hole is pre-existing: the service-worker context (`src/sw-preload/index.ts`) does not spoof `navigator.userAgentData`, so a worker would see real Linux/Electron brands. 🟢

**Q3. "Is this caller trusted?"** `isTrustedNotionOrigin` is the predicate, but two call sites OR it across *several* URLs:
- `isTrustedNotificationSender` (:575-601) accepts if the sender webContents URL, the senderFrame URL **or** the main-frame URL is trusted.
- `isPermissionRequesterTrusted` (:921-934) accepts if any candidate is trusted, **then falls back to `contents.getURL()`**, which is the top-level page.

For IPC the OR doesn't matter: `nodeIntegrationInSubFrames: false` means only the main frame has the preload bridge. For permissions it does matter. → finding #4

**Q4. "How many `notify-send` processes can be outstanding?"** The answer is `waitingNotifySendCount` (:753), which is correct only if the `execFile` callback fires exactly when the process is gone. It fires at other times (section 6), and it is skipped entirely on a synchronous throw. → findings #1 and #3

## 4. Code Quality

- Naming is good. `isTrustedNotionOrigin` vs `isAllowedUrl`, with fail-closed vs fail-open documented in the JSDoc, is exactly how to keep two similar predicates from being merged by the next tidy-up.
- The comment at :62 still says "must not inherit calendar.notion.so's privileges". Since the move, the calendar is `.com`. 🟢
- The dedupe key is `` `${title} ${body}` ``, so `("a b","c")` and `("a","b c")` collide. That is harmless at a 5 s window, but use `\0` or JSON. 🟢
- The dedupe comment "Notion's service worker re-fires the same reminder on reconnect" is an unverified claim stated as fact. Either cite the observation or soften it. 🟢
- Error handling in the notify path conflates "notify-send failed" with "we failed to kill notify-send" (see #1). That is the one real code-quality defect.

## 5. Hall of Shame

🔴 **`src/main/index.ts:807-812`: the error path cannot tell "kill denied" from "notify-send failed"**
```ts
const child = execFile("notify-send", args, { timeout: 120_000 }, (err, stdout) => {
    waitingNotifySendCount -= 1;
    if (err) {
      console.error("[NotionCalendar] notify-send failed:", err.message);
      notifySendMinimal(title, body);
```
When the 120 s timeout's SIGTERM is refused, Node invokes this callback with `EACCES` (syscall `kill`) **while the child is still running**. The code then (a) frees a slot for a process that is still alive and (b) re-posts the notification without buttons. Section 6 has the evidence. Fix: if `err.syscall === "kill"` or `err.killed`, log and return without re-posting. Separately, fix the reaping (finding #1).

🟡 **`:807-808`: the counter is incremented before a call that can throw synchronously**
```ts
waitingNotifySendCount += 1;
const child = execFile("notify-send", args, ...
```
`execFile` throws `ERR_INVALID_ARG_VALUE` *synchronously* if any argument contains `\0`. I verified this in Node: the counter stays at 1 and the callback never runs. `parseNotificationPayload` (:684-713) does `String(o.title)` without stripping control characters. The title is event-title text, and other people can author the events on your calendar. Each NUL title leaks one slot permanently and throws out of an `ipcMain` listener. Fix: strip C0 controls in `parseNotificationPayload`, and increment only after `execFile` returns (or use try/catch).

🟡 **`:921-934`: permission scoping falls back to the top-level URL**
```ts
for (const url of candidateUrls) { if (isTrustedNotionOrigin(url)) return true; }
if (!contents || contents.isDestroyed()) return false;
return isTrustedNotionOrigin(contents.getURL());
```
A cross-origin iframe on the calendar page has an untrusted `requestingOrigin`. It fails the loop, then passes on `contents.getURL()` because that is the calendar. The JSDoc and README say grants go "only to Notion origins". For subframes, they don't. Real-world impact is limited, because Chromium also requires permissions-policy delegation for iframe clipboard/notification use. But the code doesn't do what it says. Fix: decide on `requestingOrigin`/`details.requestingUrl` alone, and use `getURL()` only when neither is present.

🟡 **README.md security table: "page script cannot spawn processes without bound"**
Past the cap, `notifySendMinimal` (:740-746) spawns a process per call with no limit. Unique titles bypass the dedupe. On this machine the "capped" `--wait` children also never exit (#1). The claim is false twice over. Fix: a token bucket in front of *all* spawns (for example 10/min, drop beyond) and a corrected sentence.

## 6. Logic & Business Rules: the `--wait` / AppArmor problem

This is the most important section, and most of it is **not caused by this PR**. The PR's cap is built on top of it, though, and the README now makes promises that depend on it.

**Evidence (all read-only):**
- `/etc/apparmor.d/notify-send` is shipped by the `apparmor` package (`dpkg -S`). It allows `dbus (send)` of `{GetServerInformation,Notify}` only. There is no `dbus (receive)` rule and no `signal (receive)` rule, and `abstractions/dbus-session-strict` adds neither.
- In the last 14 days, `journalctl` shows **437** `apparmor="DENIED" operation="dbus_signal" member="NotificationClosed" label="notify-send"` and **45** denied `GetCapabilities` calls. **`ActionInvoked` never appears**, either allowed or denied.
- On this boot there are 5 denied `operation="signal" signal=term profile="notify-send"` events, from `notion-calendar` (installed) and from `electron` (this dev build, label `claude-desktop-unofficial`).
- Live timeline for the dev instance's test notification (`notify-send` PID 623127, child of 621919):
  - 12:19:38: spawned with `--wait`.
  - **12:21:38, exactly 120 s later:** the kernel denies SIGTERM from `electron` to 623127, and in the same second a new `notify-send` (PID 628357) runs `GetCapabilities`. That is `notifySendMinimal` re-posting.
  - 12:30: 623127 is still alive (11 minutes).
- Four orphaned `notify-send --wait` processes from the `/opt/Notion Calendar` install are still alive under `systemd --user`, aged 01:36, 20:06, 1-01:36 and 1-17:36.
- A Node reproduction (patching `_handle.kill` to return EACCES) gives `cb err=EACCES syscall=kill` at the timeout. The counter decrements, and the child exits only later on its own.

**What that means today, on main *and* on this branch:**
1. A `--wait` child never learns that its notification closed (the D-Bus signal is denied) and cannot be killed (SIGTERM is denied). It lives until logout. It also outlives the app, because it is reparented to systemd. **Every reminder leaks one process.**
2. Two minutes after every reminder, the callback fires with EACCES and `notifySendMinimal` shows the **same reminder again, without the Join button**. The 5 s dedupe cannot catch a repeat 120 s later.
3. The profile does not permit receiving `ActionInvoked` either. Zero `ActionInvoked` audit lines in 14 days most likely means nobody clicked an action in that time. If someone had, the profile as written would have denied it and logged it. **Whether the Join button works at all on this machine is unverified, and the profile suggests it does not.** One click on a real reminder settles it: watch `journalctl -f | grep ActionInvoked`.

**What this PR changes on top:** the cap does not bound processes. Slots are freed at 120 s by the EACCES path, while the process survives. So under a flood the cap limits *rate* (8 per 2 min of `--wait` children, plus unlimited minimal ones) and leaks around 5,760 `--wait` processes a day. Under normal use it is invisible. The PR is not worse than main here. It just doesn't deliver the README sentence it added.

Fix options (finding #1, handed to the user since it involves system AppArmor config, which I won't touch):
- **(a) Local AppArmor override** in `/etc/apparmor.d/local/notify-send`: `dbus (receive) bus=session path=/org/freedesktop/Notifications interface=org.freedesktop.Notifications member={ActionInvoked,NotificationClosed,ActivationToken},` plus `signal (receive) set=(term) peer={notion-calendar,claude-desktop-unofficial,unconfined},`, and the `GetCapabilities` send. Then `apparmor_parser -r`. This fixes this machine only.
- **(b) Stop shelling out for actions.** Talk to `org.freedesktop.Notifications` over D-Bus from the main process with a small dbus client. That removes the process-per-notification model and the AppArmor dependency entirely. It works for any Ubuntu 25.10+ user of this wrapper, who all get this profile.
- **(c) Minimum code fix regardless:** don't re-post on a kill failure (section 5).

Recommendation: (c) in this PR, plus (a) now on this machine. (b) is the real fix and belongs in its own PR. Per AGENTS.md, the AppArmor finding deserves a `~/system/` folder anchored to the 12:21:38 timeline above.

**Other logic notes:**
- Dedupe runs before the cap check, which is correct (a dropped dupe should not consume a slot).
- Two genuinely distinct reminders with identical title and body within 5 s (for example the same meeting on two calendars) now collapse into one. That's acceptable. 🟢

## 7. Test Strategy & Execution

There is no test suite. Every guard this PR adds is a pure or near-pure function: `isTrustedNotionOrigin`, `isDuplicateNotification`, the cap accounting, `isPermissionRequesterTrusted`, `parseNotificationPayload`. None is exercised by anything, so **if any of them regresses, nothing fails.** The fail-closed property, the PR's headline, is one `if (parsed.protocol !== "https:")` away from silently becoming fail-open, and CI would stay green.

The axis that bit (process lifetime vs. callback timing) isn't unit-testable with a fake `execFile` that you *hand* an exit. A double that computes nothing cannot express "callback fired, process still alive". Any test harness here needs a fake child whose `kill()` can fail.

Fix: move the trust and dedupe/cap logic into `src/main/notification-policy.ts` and `src/main/trust.ts`, and add `node --test` cases. Cover `blob:`, `data:`, `about:blank`, `http:`, uppercase hosts, the subframe origin vs. top URL case, a NUL title, the dedupe window edges, and a fake child whose kill returns EACCES. Add the run to the release workflow.

## 8. Security & Performance

**Clipboard (the open user concern): removing `clipboard-read` looks safe.** I scanned the cached Notion Calendar bundle in `~/.config/notion-calendar-electron-wrapper/Service Worker/CacheStorage` and `~/.config/Notion Calendar/Service Worker/CacheStorage`. It has:
- **Zero** occurrences of `navigator.clipboard.readText` or `navigator.clipboard.read(`.
- `clipboard.writeText` and `clipboard.write(` for copy buttons (covered by `clipboard-sanitized-write`).
- Paste handled through `ClipboardEvent.clipboardData`: Lexical editors, a capture-phase `document.addEventListener("paste", …, true)`, and an `onPaste` that reads `e.clipboardData.getData("text")` and checks `startsWith("Notion")`, which looks like event paste.

`clipboardData` on a user-initiated paste event needs no permission. Ctrl+V in text fields is native and never consults the permission handler. Caveats: lazily loaded chunks may not be in the cache, and the 532 MB HTTP cache (`Cache/`) was not decoded. **Still hand-test:** Ctrl+V into an event title, and Ctrl+C then Ctrl+V on an event in the grid. If grid paste fails, the console will show `NotAllowedError` from `clipboard.read`.

Other security notes:
- Fail-closed origin trust for SW scopes and IPC is correct and worth having. 👍
- Logging gated by `app.isPackaged`: good. The remaining unconditional logs (`notify-send failed: <err.message>`, the startWorkerForScope scope) carry no payload. Fine.
- CSP is still stripped on calendar HTML (pre-existing, documented). It's mentioned here because XSS on calendar origins is exactly the "page script" this PR's flood guard defends against, and that guard is weaker than advertised (#6).

## 9. Documentation vs. Reality

| README claim | Code | Verdict |
|---|---|---|
| "Concurrent `notify-send --wait` processes are capped … so page script cannot spawn processes without bound" | Minimal fallback is unbounded (:740). `--wait` children leak on this OS (section 6). | **False** → #6 |
| Permissions granted "only to Notion origins" | Subframes inherit through the `getURL()` fallback (:929) | **Overstated** → #4 |
| IPC: "`about:blank`, empty, `blob:` and `data:` senders are all rejected" | True in effect, because only the main frame has the bridge and the top URL must be `https:` on the allowlist | OK |
| CSP-strip row lists `calendar.notion.so`, `www.notion.so`, `notion.so`, `app.notion.com` | `CSP_STRIP_HTML_HOSTS` also has `calendar.notion.com` | Stale (pre-existing) 🟢 |
| `user-agent.ts`: "Single source of truth for the spoofed client identity" | True for the main frame and wire. The SW context is not spoofed. | Earned, mostly |

Build and deploy: the release workflow builds the `.deb` on tag. Nothing in it runs `tsc` or tests, and there are no tests to run.

---

## Verdict

The direction is right and much of the craft is good: centralized UA, fail-closed trust predicate, clipboard-read dropped (and, from the bundle scan, very likely harmless), payload logging gated. Merge it **after** two small code changes: don't re-post when the timeout kill fails, and don't count a spawn that threw. Also correct the two README sentences it can't back up. The serious problem it exposes, `notify-send --wait` being unable to hear "closed" or be killed under Ubuntu's shipped AppArmor profile, predates it. That problem means every reminder leaks a process and is shown twice, and the Join button may never have worked on this machine. Nothing in the repo would detect any of it.

## Priority backlog

1. 🔴 **#1**: `--wait` children can't be reaped under the `notify-send` AppArmor profile. Every reminder leaks a process and re-posts without buttons at 120 s. Code fix (c) now; AppArmor override (a) on this machine; D-Bus rewrite (b) as its own PR.
2. 🔴 **#2**: Verify whether clicking Join works at all (`ActionInvoked` likely denied). One manual click.
3. 🟡 **#3 / #4 / #6**: Sync-throw counter leak; permission subframe fallback; README overclaims. All are small and belong in this PR.

## Finding ledger

| # | Finding | Severity | Fate | Enforced by | Fails today if it regresses? |
|---|---------|----------|------|-------------|------------------------------|
| 1 | `notify-send --wait` never exits (AppArmor denies NotificationClosed + SIGTERM). The 120 s timeout yields `EACCES` → slot freed while the process lives → duplicate button-less re-post. Processes leak past app exit. (`src/main/index.ts:807-812`, `/etc/apparmor.d/notify-send`) | 🔴 | Handed to user: (a) local AppArmor override, (b) in-process D-Bus notifications, (c) skip re-post on kill error. Rec: (c) in this PR + (a) now, (b) next. | — | **No** |
| 2 | Join button may be non-functional on this machine (profile has no `dbus receive` for `ActionInvoked`, and there are zero ActionInvoked audit lines in 14 d) | 🔴 | Handed to user: click Join on a real reminder while running `journalctl -f \| grep -E 'ActionInvoked\|notify-send'` | — | **No** |
| 3 | `waitingNotifySendCount += 1` before `execFile` that throws synchronously on NUL args; the title isn't control-stripped (`:807`, `:684-713`) | 🟡 | Handed to user. Fix: strip C0 in `parseNotificationPayload`, increment after spawn. Rec: fix in this PR. | — | **No** |
| 4 | `isPermissionRequesterTrusted` falls back to top-level `getURL()`, so cross-origin subframes inherit `notifications`/`clipboard-sanitized-write` (`:921-934`) | 🟡 | Handed to user. Fix: decide on `requestingOrigin`/`requestingUrl` only, falling back only when both are absent. Rec: fix in this PR. | — | **No** |
| 5 | `ALLOWED_HOSTNAMES` now answers both "may navigate" and "is trusted". Marketing/CSP-only hosts gain IPC + permission trust (`:26-41`, `:65-74`) | 🟡 | Handed to user. Options: separate `TRUSTED_NOTION_ORIGINS` set, or accept. Rec: split. | — | **No** |
| 6 | README "page script cannot spawn processes without bound" is false (unbounded minimal fallback + leaked `--wait` children) | 🟡 | Handed to user. Fix: token bucket on all spawns + reword. Rec: reword in this PR, bucket alongside #1(c). | — | **No** |
| 7 | No tests: every new guard (`isTrustedNotionOrigin`, dedupe, cap, permission check, payload parse) can regress silently | 🟡 | Handed to user. Rec: extract to `src/main/trust.ts` / `notification-policy.ts`, add `node --test`, run in the release workflow. | — | **No** |
| 8 | `clipboard-read` removal: bundle scan finds no `clipboard.read`/`readText` and paste goes through `ClipboardEvent.clipboardData`, but there's no hand test yet | 🟡 | Handed to user: Ctrl+V into an event title, and Ctrl+C/Ctrl+V an event on the grid. Rec: merge, then test. | — | **No** |
| 9 | `Documents/reviews/` untracked: this ledger won't survive for the next Step 0 | 🟡 | Handed to user: commit the dir or declare it scratch | — | **No** |

🟢 (not ledgered): stale ".so" comment at `:62`; dedupe key separator collision; unverified "re-fires on reconnect" comment; package.json floors (`^42.9.2`, `^26.15.3`) below locked/tested (42.11.18, 26.18.0); SW `navigator.userAgentData` not spoofed (pre-existing); README CSP row missing `calendar.notion.com` (pre-existing).
