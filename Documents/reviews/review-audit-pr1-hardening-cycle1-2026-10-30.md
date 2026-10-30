# Review Audit: pr1-hardening, cycle 1 of 5

**Date:** 2026-10-30
**Artifact audited:** `Documents/reviews/grumpy-review-pr1-hardening-2026-10-30.md`
**Branch:** `hardening/pr1-vetted` (single commit `e7bb4d2` on top of `main`), diff `main..hardening/pr1-vetted -- . ':!package-lock.json'`
**Method:** read the changed code at the cited lines, re-ran the machine claims with read-only commands (`cat /etc/apparmor.d/notify-send`, `journalctl`, `ps`, `dpkg`, `apparmor_parser -Q -K` on a scratch copy), and ran two Node experiments in the scratchpad. I did not launch, kill or signal Notion Calendar or any `notify-send`, and I changed no product code or system config.

**Headline:** the Grumpy review is accurate and unusually well evidenced. Every machine claim reproduces. I found **0 P0** and **2 P1** items, both **pre-existing on `main`** (neither is introduced by this branch). I corrected four things the review got wrong or understated, and found six things it missed.

| Origin | Items |
|---|---|
| Introduced by this branch | #3 counter leak on sync throw, #4 permission subframe fallback, #6 README overclaim, new N1 raw NUL byte in source, and the partial gate in N2 (payload still logged through `err.message`) |
| Pre-existing on `main` | #1 and #2 (AppArmor vs `notify-send --wait`), #5 coupling of the trust list, the SW `navigator` gap, the CSP README row |
| Neutral or process | #7 no tests, #8 clipboard hand-test, #9 untracked reviews dir |

---

## Work Queue (claims extracted)

**`/etc/apparmor.d/notify-send` and the journal (machine claims)**
C1. The profile has no `dbus (receive)` and no `signal (receive)` rule.
C2. 437 `NotificationClosed` denials and 45 `GetCapabilities` denials in 14 days; `ActionInvoked` never appears.
C3. This boot: 5 denied `signal=term` events, 4 from `notion-calendar`, 1 from the dev `electron`.
C4. Dev test notification timeline: spawn 12:19:38, SIGTERM denied at 12:21:38 plus a new `notify-send` (PID 628357), PID 623127 still alive at 12:30.
C5. Four orphaned `--wait` processes from `/opt/Notion Calendar` under `systemd --user`, aged about 1:36, 20:06, 1d1:36, 1d17:36.
C6. Node: `execFile` calls back with `EACCES`/`syscall=kill` while the child lives.
C7. Every reminder leaks one `--wait` process, and a button-less duplicate appears 120 s later.
C8. Join/default button probably never worked on this machine; unverified.

**`src/main/index.ts`**
C9. `:807-812` the error path cannot tell "kill denied" from "notify-send failed" (finding #1).
C10. `:807` the counter is incremented before an `execFile` that throws synchronously on NUL; the title is not control-stripped (#3).
C11. `:921-934` permission scoping falls back to top-level `getURL()` so cross-origin iframes inherit grants (#4).
C12. `ALLOWED_HOSTNAMES` now answers both "may navigate" and "is trusted"; the PR "makes this worse" (#5).
C13. `isTrustedNotificationSender` ORs three URLs; harmless for IPC.
C14. README: "page script cannot spawn processes without bound" is false (#6).
C15. Cap limits rate, not process count; about 5,760 leaked `--wait` processes per day under a flood.
C16. Dedupe runs before the cap, which is correct.
C17. Dedupe key is `` `${title} ${body}` `` with a space, so `("a b","c")` collides with `("a","b c")`.
C18. "Re-fires on reconnect" comment is unverified.
C19. Remaining unconditional logs carry no payload.
C20. Stale ".so" comment at `:62`; `onBeforeSendHeaders` hardcodes both origins at `:1065-1067`.
C21. `index.ts` is about 1,100 lines.

**Other files and process**
C22. `src/shared/user-agent.ts` is inlined into the sandboxed preload with no stray `require`; one source of truth for the UA.
C23. The SW context does not spoof `navigator.userAgentData` (pre-existing).
C24. package.json floors (`^42.9.2`, `^26.15.3`) sit below the lock (42.11.18, 26.18.0); consistent.
C25. Dependabot has no duplicate ecosystem+directory pairs.
C26. Removing `clipboard-read` looks safe: bundle has no `readText`/`clipboard.read`, paste uses `clipboardData` (#8).
C27. README CSP row is missing `calendar.notion.com` (pre-existing); README IPC row is accurate.
C28. No tests; every guard can regress silently (#7).
C29. Release workflow runs no `tsc` or tests.
C30. `Documents/reviews/` is untracked (#9).

---

## Claim Verification

### Machine claims (AppArmor, journal, processes)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| C1 | Profile has no dbus/signal receive rule | ✅ Confirmed | `/etc/apparmor.d/notify-send` contains only `dbus (send) ... member={GetServerInformation,Notify}` and `include if exists <local/notify-send>`. `/etc/apparmor.d/local/notify-send` does not exist. `dpkg -S` says the file belongs to `apparmor` (5.0.2-0ubuntu1~26.04.1). `abstractions/dbus-session-strict` has `dbus send ... member={Hello,AddMatch,...}` only; no receive rule and no signal rule. |
| C2 | 437 / 45 / 0 in 14 days | ✅ Confirmed (with one correction) | `journalctl --since "14 days ago"`: 437 `operation="dbus_signal"` (all `NotificationClosed`), 45 `dbus_method_call` (`GetCapabilities`), 15 `operation="signal"`, 0 `ActionInvoked`. **Correction:** `ActionInvoked` is absent in the last 14 days but is in the journal **54 times between Aug 18 and Oct 13**, all `apparmor="DENIED" ... member="ActionInvoked" ... label="notify-send" peer_label="plasmashell"`. See finding A2. Also, 437 is inflated by fan-out: every orphan logs a denial for every close signal on the desktop (at 12:19:43 one close produced five denials, one per live `notify-send`). It is not 437 notifications. |
| C3 | 5 denied SIGTERMs this boot | ✅ Confirmed | `journalctl -b`: Oct 28 18:52:00, Oct 29 10:52:00, Oct 29 16:22:00, Oct 30 10:52:00 (`comm="notion-calendar"`, `peer="notion-calendar"`) and Oct 30 12:21:38 (`comm="electron"`, `peer="claude-desktop-unofficial"`). |
| C4 | Dev timeline | ✅ Confirmed | `12:19:38 GetCapabilities pid=623127` (spawn), `12:21:38 kernel: ... operation="signal" ... pid=621919 comm="electron" ... signal=term`, same second `GetCapabilities pid=628357` (the minimal re-post). `ps` now shows `623127 ppid=621919 elapsed 14:55 SNl`, still alive. PID 628357 is gone, as a fire-and-forget process should be. |
| C5 | Four orphans from `/opt` under systemd | ✅ Confirmed | `ps`: PIDs 419177 (1-01:44), 430221 (01:44), 953012 (1-17:44), 1409431 (20:14), all `ppid=3118` (the user manager). Ages differ from the review's by 8 minutes because time passed. Each orphan maps 1:1 to a denied SIGTERM above: 953012 "Marissa & Mitch Time" spawned about 18:50 Oct 28 (denied 18:52), 419177 about 10:50 Oct 29 (denied 10:52), 1409431 "Dev Ops Team" about 16:20 Oct 29 (denied 16:22), 430221 about 10:50 Oct 30 (denied 10:52). So the leak rate is one process per reminder, not an estimate. |
| C6 | Node `execFile` yields `EACCES`/`kill` with the child alive | ✅ Confirmed | My repro (scratchpad `t1.js`, Node 22.22.1, `_handle.kill` forced to return `-EACCES`): `cb EACCES kill killed undefined alive? true`. Real-app confirmation, which the review did not use: the installed app's own stdout in the journal has `[NotionCalendar] notify-send failed: kill EACCES` lines on Oct 1, 2, 8 and many more (156 `notify-send failed` lines Aug 34, Sep 85, Oct 37). The failure path has run for months. |
| C7 | Every reminder leaks a process and re-posts button-less at 120 s | ✅ Confirmed, and **pre-existing on main** | The installed app is 0.2.4 (`dpkg -l notion-calendar`), and its `app.asar` has 0 hits for `MAX_CONCURRENT_WAITING_NOTIFY_SEND`, so it is the pre-branch code. 10:50:00 `GetCapabilities` (spawn), 10:52:00 SIGTERM denied, 10:52:00 `GetCapabilities pid=436232` (re-post). Same pattern Oct 29 16:20:00 / 16:22:00 (re-post pid 1413564). |
| C8 | Join button probably never worked; unverified | ✅ Confirmed, and stronger than stated | The review said "zero ActionInvoked lines in 14 days most likely means nobody clicked". Wrong inference: they exist outside that window. Example: `Sep 08 15:02:57 ... member="ActionInvoked" ... mask="receive" ... label="notify-send" peer_label="plasmashell"`; others Aug 18, Aug 28, Sep 13, Sep 17, Sep 20, Sep 23, Sep 29, Oct 13. About nine distinct click moments, all denied. No manual click is needed to settle it. |

### `src/main/index.ts`

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| C9 | Error path conflates kill failure with notify-send failure | ✅ Confirmed (pre-existing logic, new slot accounting on top) | `:808-813`: `waitingNotifySendCount -= 1; if (err) { console.error(...); notifySendMinimal(title, body); return; }`. Any `err` re-posts. This includes a **successful** timeout kill (Node: `killed=true`, `signal=SIGTERM`), so even on a healthy machine an unattended reminder is re-posted button-less after 120 s. The review only frames the EACCES variant. |
| C10 | Counter leaks on sync throw | ⚠️ Partially True | Node test: `execFile('echo',['a\0b'],cb)` throws `ERR_INVALID_ARG_VALUE` synchronously, the callback never runs, counter stays 1. Real. But (a) a NUL must reach the args: `parseNotificationPayload` (`:688-689`) does `String(o.title).trim().slice(0,256)` with no control stripping, so it can. (b) The review's fix ("strip C0 in `parseNotificationPayload`") is incomplete: `buttonLabel` comes from `actions[].title` (`pickJoinButtonLabel`, `:646`) and goes into `--action=join=${buttonLabel}` unstripped. Stripping only title/body leaves a path. (c) The synchronous throw itself is pre-existing, and there is no `uncaughtException` handler in `index.ts`, so on main a NUL already produced Electron's main-process error dialog. The branch only added the leaked slot (8 such events saturate the cap; each needs a NUL). Low likelihood; Notion event titles are the only realistic source. |
| C11 | Permission check falls back to top-level URL | ✅ Confirmed | `:921-926`: loop over candidate URLs, then `return isTrustedNotionOrigin(contents.getURL())`. For a frame whose `requestingOrigin` is untrusted, the loop fails and the top-level URL (calendar) passes. README says grants go "only to Notion origins". The review's impact estimate (Chromium also needs Permissions-Policy delegation) is fair. Not mentioned: the trust list includes `notion.so` / `www.notion.so`, which render user-authored pages with embeds, so "a cross-origin iframe inside a trusted top-level page" is a normal shape here, not a contrived one. What an embed could get: `notifications`, and `clipboard-sanitized-write` (clipboard overwrite). |
| C12 | `ALLOWED_HOSTNAMES` double duty; "the PR makes this worse" | ⚠️ Partially True (the "worse" part is ❌) | The coupling exists (`:26-41` feeds both predicates). But before the branch, `isTrustedNotificationSender` already used `isAllowedUrl` against the same set, so IPC trust was not widened. Permissions went from "any origin in the session" (`GRANTED_SESSION_PERMISSIONS.has(permission)` with the webContents ignored) to "this list": a narrowing. The branch improves this; it does not worsen it. Remaining risk is conceptual drift only. All listed hosts are Notion-operated. |
| C13 | OR across three URLs is harmless for IPC | ✅ Confirmed | `:577-596`. `nodeIntegrationInSubFrames: false` (`:460`) and `sandbox: true`, `contextIsolation: true` (`:458,461`); the preload bridge exists only in the main frame, so OR is moot for IPC. |
| C14 | README "cannot spawn processes without bound" is false | ✅ Confirmed | `notifySendMinimal` (`:741-746`) has no cap and is reached past the cap (`:788-794`) and from every error path. And `--wait` slots are freed at 120 s while the child lives (C6/C7). The sentence is false on both counts. |
| C15 | Cap limits rate, not count; about 5,760 leaked per day | ⚠️ Partially True | Logic right: 8 slots per 120 s window is 8 x 720 = 5,760/day at saturation. But that is a theoretical ceiling for an XSS-driven flood; the realistic leak is one per reminder (C5). Also each leaked child is cheap, but every extra live `notify-send` adds log noise for **every** desktop notification (C2 fan-out), so the cost grows with `orphans x all-notifications`. |
| C16 | Dedupe before cap is correct | ✅ Confirmed | `:790` `if (isDuplicateNotification(title, body)) return;` precedes the cap check at `:792`. |
| C17 | Dedupe key uses a space; collides | ❌ Incorrect | `/usr/bin/grep -anP '[\x00-\x08...]' src/main/index.ts` → `761:  const key = \`${title}^@${body}\`;`. The separator is already a **NUL byte** (the review's tooling rendered it as a space). No collision. But see new finding N1: a raw NUL byte in source makes `grep`, `file` and some diff tools treat `index.ts` as binary. |
| C18 | "Re-fires on reconnect" is unverified | 🔍 Can't Verify | No spec or log in the repo documents it (`Documents/specs/*.md` has no "reconnect"/"re-fire"). Agree it should be softened or cited. Cosmetic. |
| C19 | Remaining unconditional logs carry no payload | ❌ Incorrect | `:744` and `:811` log `err.message`. For any non-`EACCES` failure Node builds the message from the command line. Repro: `execFile('sh',['-c','exit 3','--','SECRET_TITLE','SECRET_BODY'])` → `"Command failed: sh -c exit 3 -- SECRET_TITLE SECRET_BODY\n"`. For `notify-send` that is title, body and the join-button label. On this machine only `kill EACCES` is seen, which hides it, but a nonzero exit (no notification daemon, D-Bus down) or a successful timeout kill puts event titles and bodies in the journal, exactly what the new `isPackaged` gate says it prevents. See N2. |
| C20 | Stale comment `:62`; hardcoded origins at `:1065-1067` | ⚠️ Partially True | The `.so` comment is real (it is at `:63`). The hardcoded `onBeforeSendHeaders` prefixes are at **`:1038-1039`**, not `:1065-1067`. Line numbers off, substance right. |
| C21 | `index.ts` about 1,100 lines | ✅ Confirmed | 1,075 lines. |

### Other files and process

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| C22 | `user-agent.ts` inlined into preload, no stray require | ✅ Confirmed | `out/preload/index.js` and `out/main/index.js`: 0 matches for `require("../shared`; `135.0.0.0` present in the preload. (Existing build output inspected; I did not rebuild.) |
| C23 | SW context does not spoof `navigator.userAgentData` | ✅ Confirmed, pre-existing | `src/sw-preload/index.ts` only patches `showNotification`. |
| C24 | package.json floors vs lock | ✅ Confirmed | `package.json` `^42.9.2` / `^26.15.3`; installed `node_modules` electron 42.11.18, electron-builder 26.18.0; `package-lock.json` root entries match the ranges. |
| C25 | Dependabot no duplicates | ✅ Confirmed | YAML parses (checked with PyYAML): devcontainers, npm, github-actions, all `/`. The odd one-space indent is consistent with the original file and valid. |
| C26 | `clipboard-read` removal looks safe | ✅ Confirmed (static only) | Scan of both `Service Worker/CacheStorage` dirs: `readText(` 0, `clipboard.read(` 0, `clipboard-read` 0; `clipboardData.getData` 4 and 5; `writeText(` 25 and 21; `clipboard.write(` 1. Same caveat the review gave: only precached assets, not the 532 MB HTTP cache. A 30-second hand test settles it. |
| C27 | README CSP row stale; IPC row accurate | ✅ Confirmed | README row lists `.so` hosts and `app.notion.com`; `CSP_STRIP_HTML_HOSTS` (`:189-195`) also has `calendar.notion.com`. Pre-existing. |
| C28 | No tests | ✅ Confirmed | No `test` script in `package.json`, no test files. |
| C29 | Release workflow has no tsc/tests | ✅ Confirmed | `release.yml` runs `npm ci` and `npm run build:linux` only. Note `prebuild` is `electron-vite build`, which does not type-check. |
| C30 | `Documents/reviews/` untracked | ✅ Confirmed | `git status`: `?? Documents/reviews/`; `Documents/specs/` is tracked. |

---

## Severity Re-Assessment

| # | Issue | Reviewer | Mine | Delta | Reasoning |
|---|---|---|---|---|---|
| A1 / #1 | `--wait` unkillable and re-posts | 🔴 | **High** | ↓ one notch from Critical | Real, reproducible, months old. But no data loss or security exposure: a duplicate button-less toast and about one idle process per reminder. High because it is a daily user-visible defect and the log fan-out grows with it. |
| A2 / #2 | Join/default action dead | 🔴 | **High** | = | Core feature of the wrapper ("join link actions" is in the package description) is dead on this machine. Reviewer under-evidenced it; journal proves it. |
| #3 | Counter leak on NUL | 🟡 | **Low** | ↓ | Needs a NUL in event text; leak is bounded by 8 events and cleared on restart. Fix is trivial though. |
| #4 | Permission subframe fallback | 🟡 | **Medium** | = | Contradicts the PR's own stated property. Exploit needs iframe delegation by the embedding page. Cheap to fix in this PR. |
| #5 | Split the trust list | 🟡 | **Negligible** | ↓↓ | PR narrowed trust; all hosts are first-party. Design nicety only. |
| #6 | README overclaim | 🟡 | **Low** | ↓ | Documentation accuracy. Reword; no bucket needed. |
| #7 | No tests | 🟡 | **Low** | ↓ | Solo/small wrapper; reviewer applies a larger-team standard. |
| #8 | Clipboard hand test | 🟡 | **Low** | ↓ | Evidence says safe; one manual check. |
| #9 | Untracked reviews dir | 🟡 | **Negligible** | ↓ | Process choice. |
| N2 | Payload in `err.message` | (missed) | **Low-Medium** | new | Privacy leak of titles/bodies to the journal on non-EACCES failures. |

---

## What the Review Missed

**N1. Raw NUL byte in `src/main/index.ts:761` (introduced by this branch).** `const key = \`${title}<0x00>${body}\`;` is a literal NUL character. `file src/main/index.ts` reports `data`; `grep` says "binary file matches" unless `-a`; `main` has 0 control bytes. The compiler is fine, but tooling (grep, some diff viewers, LLM reviewers, which is how the Grumpy review misread it as a space) silently treats the file as binary. Fix: write the escape, `` `${title}\u0000${body}` ``. One line.

**N2. The logging gate is only half done (introduced by this branch).** `logNotificationPayloadForDebug` and the join-URL log are gated by `app.isPackaged`, but `console.error("[NotionCalendar] notify-send failed:", err.message)` (`:811`) and the minimal variant (`:744`) emit the full command line in packaged builds for any failure other than a denied kill (see C19). Fix: log `err.code`/`err.signal`/`err.syscall`, not `err.message`. Two lines.

**N3. Healthy-system behavior of the same bug (pre-existing).** The re-post-on-error path also fires on a **successful** timeout kill, so on a machine without the AppArmor profile every reminder left unattended for 120 s is shown a second time, button-less. The review frames this as an AppArmor-only symptom; the code is wrong independent of AppArmor. The fix below covers both.

**N4. Log fan-out scales with orphans (pre-existing).** Each leaked `notify-send` logs a denial for every `NotificationClosed`/`ActionInvoked` signal Plasma emits for any application. With N live orphans every desktop notification produces N audit lines (5 at 12:19:43). The 437 figure is a symptom of that, and it grows until logout. Reaping the processes (A1 fix (a)) also stops this.

**N5. Dedupe map holds up to about 8.4 KB per key (introduced, Negligible).** Keys are the full title and body (256 + 8,192 chars). A burst of unique notifications within 5 s can pile up megabytes before pruning. Only relevant to the flood model the PR itself cites. Not worth acting on unless the token bucket is added.

**N6. The 120 s re-post is invisible to the 5 s dedupe, and the installed 0.2.4 `.deb` is what actually runs.** The user's live calendar is the pre-branch build, so none of the branch's fixes affect the 4 orphans or the Join problem until a release is installed. Relevant when verifying any fix: test with the dev build and check `journalctl` for the same denial signatures.

No new security flaw in the diff beyond #4. I checked: `GRANTED_SESSION_PERMISSIONS` unchanged other than removing `clipboard-read`; fail-closed `isTrustedNotionOrigin` is correct (`https:` only, exact hostname Set lookup, no suffix matching, `new URL` lowercases the host); SW scope checks work on `worker.scope` and `registration-completed` scope; the dev test notification went through, so no functional regression in the permission or SW paths.

---

## What the Review Got Right (And Why It Matters)

1. **The AppArmor finding is the most valuable thing in the review and is fully real.** The 1:1 mapping of live orphans to denied SIGTERMs, the `kill EACCES` lines in the installed app's own journal, and the re-post pids at the exact SIGTERM second form a closed loop. It means the user has been getting duplicate button-less reminders and a growing set of idle processes since at least August, and the app's own logs recorded it every time without anyone reading them.
2. **It correctly separated "pre-existing" from "this PR" in section 6** and did not blame the branch for the cap not helping.
3. **Compound effect worth stating:** A1 and A2 share one root cause (the profile blocks inbound D-Bus signals and SIGTERM). Fix (a) below resolves both, plus N4. A code-only fix (c) removes the duplicate but leaves the dead Join button and the orphans.
4. **The clipboard analysis was done properly** and matches my independent scan. That cleared the user's open concern.
5. **Single-authority and fail-open/closed analysis** (section 3) is accurate and the right frame, apart from the overstated "makes it worse".

---

## Fixes for the P1 items (precise and minimal)

### A1: `--wait` child can't be killed; re-post at 120 s; leaked processes (P1, pre-existing)

**Code fix (this PR, 3 lines), `src/main/index.ts:808-813`:**

```ts
const child = execFile("notify-send", args, { timeout: 120_000 }, (err, stdout) => {
  waitingNotifySendCount -= 1;
  if (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean };
    // Timeout reached: the reminder was already shown. Re-posting it would duplicate it.
    // `syscall === "kill"` is the EACCES case where the kill itself was refused; `killed` is the
    // case where the kill worked. Neither means notify-send failed to display anything.
    if (e.killed || e.syscall === "kill") {
      console.warn("[NotionCalendar] notify-send timed out; not re-posting");
      return;
    }
    console.error("[NotionCalendar] notify-send failed:", e.code ?? "error");   // see N2
    notifySendMinimal(title, body);
    return;
  }
```

Both conditions are needed. My repro shows `err.killed` is `undefined` in the EACCES case and `err.syscall === "kill"` is the discriminator; on a successful kill, `killed` is true. Keep the `-= 1` as is: holding the slot would saturate the cap permanently on this machine (the child never exits) and silently remove buttons from later reminders, which is worse.

**Machine fix (user action, root; I did not apply it), new file `/etc/apparmor.d/local/notify-send`:**

```
dbus (send)
    bus=session
    path=/org/freedesktop/Notifications
    interface=org.freedesktop.Notifications
    member=GetCapabilities,
dbus (receive)
    bus=session
    path=/org/freedesktop/Notifications
    interface=org.freedesktop.Notifications
    member={ActionInvoked,NotificationClosed,ActivationToken},
signal (receive) set=(term) peer={notion-calendar,claude-desktop-unofficial},
```

Then `sudo apparmor_parser -r /etc/apparmor.d/notify-send`. The profile name `notify-send` is the `include if exists <local/notify-send>` hook, so this file holds bare rules only. I checked syntax by feeding an equivalent scratch profile (including `peer={...}`) to `apparmor_parser -Q -K -I /etc/apparmor.d -o /dev/null`: it parsed with no errors. I could not test the effect without loading it. Existing orphans keep running until killed by the user (`pkill -f 'notify-send.*Notion Calendar'` or logout); I did not touch them.

Verify afterwards: next reminder should show no new `NotificationClosed`/`SIGTERM` denials, and the `notify-send` process should exit on dismiss.

### A2: Join / "Open Calendar" actions dead (P1, pre-existing)

No code change in this repo fixes it. The same local AppArmor override above (the `ActionInvoked` member) is the minimal fix. Verification is one click on a real reminder while watching `journalctl -f | grep -E 'ActionInvoked|notify-send'`: before the override, a denied `ActionInvoked` line appears; after, none and the meeting opens. The long-term fix (in-process D-Bus notifications, no `notify-send`) is a separate PR and is correctly deferred by the review.

---

## Prioritized Action Matrix

| Priority | Issue | Verdict | Effort | Depends On |
|----------|-------|---------|--------|------------|
| P0 | none | n/a | n/a | n/a |
| P1 | A1: `--wait` child unkillable under AppArmor profile; callback re-posts button-less at 120 s; one idle process leaks per reminder (pre-existing; review #1) | ✅ | quick fix (code, 3 lines) + quick fix (user adds local profile file) | none |
| P1 | A2: `ActionInvoked` denied, so Join / Open Calendar buttons never work (pre-existing; review #2) | ✅ (stronger evidence than the review gave) | quick fix (user, same local profile file as A1) | A1 machine fix |
| P2 | #4: permission check falls back to top-level URL, subframes inherit grants (branch) | ✅ | quick fix | none; fix in this PR |
| P2 | N2: `err.message` writes title/body to the journal on non-EACCES failures; the `isPackaged` gate is incomplete (branch) | ✅ (review said ❌ "no payload") | quick fix | folds into the A1 edit |
| P2 | #6: README "cannot spawn processes without bound" is false (branch) | ✅ | quick fix (reword) | A1 (so the new wording is true) |
| P2 | #3: `waitingNotifySendCount` leaks on synchronous `execFile` throw (branch) | ⚠️ (real, but the proposed fix is incomplete and likelihood is low) | quick fix | none |
| P3 | N1: raw NUL byte in `index.ts:761` makes the file binary to tooling (branch) | ✅ new | quick fix | none |
| P3 | #7: no tests, no typecheck in CI | ✅ | half-day (pure-function extraction plus `node --test`) | none |
| P3 | #8: hand-test Ctrl+V into a title and Ctrl+C/V an event after `clipboard-read` removal | ✅ | quick fix (manual, 1 min) | none |
| P3 | #5: separate `TRUSTED_NOTION_ORIGINS` from the navigation list | ⚠️ (PR narrowed trust; "makes it worse" is wrong) | quick fix | none; optional |
| P3 | #9: `Documents/reviews/` is untracked | ✅ | quick fix (user decision) | none |
| P3 | Cosmetic: stale `.so` comment (`:63`), unverified "re-fires on reconnect" comment, package.json floors, SW `userAgentData`, README CSP row, N5 dedupe memory | ✅ / 🔍 | quick fix | none |
| (invalid) | Dedupe key uses a space and collides (review's minor item) | ❌ | n/a | n/a; the key is already NUL-separated |

---

## Disagreements and Judgment Calls

1. **Severity of #1 and #2 (🔴 vs High, P1 not P0).** Neither is introduced by the branch and neither loses data or exposes a secret. They are the most important defects found, but they should not block PR 1. The only part that belongs in PR 1 is the 3-line callback change, because the PR added the counter on top of the same callback.
2. **"The PR makes the trust-list coupling worse" (#5).** Wrong. IPC trust used the same list before; permissions were granted to everything before. The branch only narrows. A separate `TRUSTED_NOTION_ORIGINS` set is optional tidying, not a finding.
3. **Token bucket on all spawns (#6).** Not needed. The attacker model is script on a first-party Notion page. Reword the README sentence to what the code does ("`--wait` children are capped by count and by a 120 s timeout; exact repeats within 5 s are dropped"); skip the limiter unless someone shows a real flood. Note the reworded sentence still needs A1's machine fix to be fully true on this OS, so say "capped" and not "bounded".
4. **Test-suite recommendation (#7).** A fake `execFile` child with failing `kill()` plus splitting `index.ts` into policy modules is a big-team answer for a one-file Electron wrapper with no test runner. If anything, extract `isTrustedNotionOrigin` into a dependency-free file and cover it with ten `node --test` cases (https, http, `blob:`, `data:`, `about:blank`, uppercase host, empty, garbage); keep the rest as hand tests. P3.
5. **"Join button unverified; one click settles it."** Not necessary. The journal already shows nine denied `ActionInvoked` events. The click is still a good post-fix verification.
6. **Review's fix for #3 (strip C0 in `parseNotificationPayload`).** Incomplete, see C10. The smallest correct change is to wrap the `execFile` call in `try/catch` and increment the counter only after it returns (the callback is always async, so increment-after is safe), which covers `buttonLabel`, `title`, `body` and `getAppIconPath()` in one place:

   ```ts
   let child: ReturnType<typeof execFile>;
   try {
     child = execFile("notify-send", args, { timeout: 120_000 }, /* callback */);
   } catch (e) {
     console.error("[NotionCalendar] notify-send spawn threw:", (e as NodeJS.ErrnoException).code);
     return;
   }
   waitingNotifySendCount += 1;
   child.unref();
   ```

   Do not move the increment inside the callback arguments; just after the call.
7. **Fix for #4.** The review's wording is right. Minimal form for `isPermissionRequesterTrusted`:

   ```ts
   const present = candidateUrls.filter((u): u is string => !!u);
   if (present.length > 0) return present.some(isTrustedNotionOrigin);   // decide on the requester only
   if (!contents || contents.isDestroyed()) return false;
   try { return isTrustedNotionOrigin(contents.getURL()); } catch { return false; }
   ```

   Re-test notifications and the copy button in the dev build afterwards; if either breaks, the SW or opaque-origin case needs a narrower fallback.
8. **Scope of the review.** Fair and thorough for a PR review. It spent a lot of space on the AppArmor environment issue relative to the diff, but that was the right call because the new README sentence depends on it.

**Cycle verdict:** P0 count 0, P1 count 2. Both P1 items are pre-existing; the in-repo part of the fix (A1 code change plus N2 log change) is small and belongs in this PR. The AppArmor local override is a user action on the machine. The remaining branch-introduced P2s (#4, #3, #6, N2) are all quick edits.
