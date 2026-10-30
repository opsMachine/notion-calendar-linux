# Grumpy Dev Review: pr1-hardening, cycle 2 (`hardening/pr1-vetted` vs `main`)

**Date:** 2026-10-30
**Commits under review:** `e7bb4d2` (security hardening) and `f7b7947` (fix: no re-post on `--wait` timeout; log `err.code`). The new commit gets most of the attention here.
**Scope:** `git diff main..hardening/pr1-vetted -- . ':!package-lock.json' ':!Documents/reviews'`, plus the surrounding notification and permission code in `src/main/index.ts`.
**Not done:** I did not launch, kill or signal the app or any `notify-send`, and I changed no product code or system config. Every child process I signalled was a `sleep` that I spawned myself in the scratchpad.

**What I ran:**
- `git archive hardening/pr1-vetted` into a scratch dir, then `npx electron-vite build`. It **passes**. `out/main/index.js` contains `notify-send --wait timed out:", err.code ?? err.signal` and `notify-send failed:", err.code`.
- `npx tsc --noEmit -p tsconfig.node.json` shows only the known `src/main/config.ts(12,76)` error.
- An `execFile` error-shape probe (`scratchpad/c2/shapes.js`, `ext.js`) run under system Node 22.22.1 **and under Electron's own Node 24.19.0** (`ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron`). It covers 9 shapes: timeout with a successful kill, timeout with the kill refused (EACCES), external SIGTERM, external SIGKILL, nonzero exit, ENOENT, spawn EACCES, a NUL argument, and the timeout racing a natural exit.
- Read-only `journalctl` for the 12:19:38 dev notification, to check what "timeout" actually means on this desktop.

---

## Step 0: Prior findings

Sources: `grumpy-review-pr1-hardening-2026-10-30.md` (G#) and `review-audit-pr1-hardening-cycle1-2026-10-30.md` (A/N#). All were first written today, so "open" means open for 0 days.

| # | Finding (cycle 1) | Status now | Evidence |
|---|---|---|---|
| G#1 / A1 | Timeout callback re-posts the reminder button-less at 120 s; frees the slot while the child lives | **CLOSED (code part)**, `f7b7947` | `index.ts:808-821`. The probe under Electron's Node shows that both timeout shapes skip the re-post and every real failure still re-posts (section 6). **No test**: a regression fails nothing. The leaked processes are AppArmor, so out of scope. |
| G#2 / A2 | Join / Open Calendar actions denied (`ActionInvoked`) | **OUT OF SCOPE**: machine config, handed to the user | Unchanged and not made worse. |
| G#3 | `waitingNotifySendCount += 1` before an `execFile` that throws synchronously on NUL | **OPEN, 0 days** | `index.ts:807-808` are unchanged. Re-confirmed under Electron's Node: `ERR_INVALID_ARG_VALUE`, thrown synchronously, and the callback never runs. |
| G#4 | `isPermissionRequesterTrusted` falls back to the top-level `getURL()` | **OPEN, 0 days** | `index.ts:925-937` are unchanged. |
| G#5 | Split `TRUSTED_NOTION_ORIGINS` from the nav allowlist | **OPEN, downgraded** to optional P3 by the audit. No user decision is recorded. | `index.ts:26-41`, `:65-74` |
| G#6 | README "page script cannot spawn processes without bound" | **OPEN, 0 days** | `README.md:50` is unchanged. `notifySendMinimal` is still uncapped, and `--wait` slots are still freed while the child lives. f7b7947 made the code no *more* true. |
| G#7 | No tests, and no tsc in CI | **OPEN, 0 days**. Now covers the new fix too (C2-3). | No test files. `release.yml` is unchanged. |
| G#8 | Hand-test the clipboard after the `clipboard-read` removal | **UNTRACKED** | Nothing in the repo, the commit messages or the reviews records whether Ctrl+V / copy-paste was tried. |
| G#9 | `Documents/reviews/` untracked | **CLOSED**, `f7b7947` | `git ls-files Documents/reviews` lists all three files. |
| N1 | Raw NUL byte in `index.ts:761` | **OPEN, 0 days** | `file src/main/index.ts` → `data`. **New:** the byte is copied into the bundle, so `grep -c 'timed out' out/main/index.js` returns **0** even though the string is present (`grep -a` finds it). Tooling now misreads the build output as well as the source. |
| N2 | `err.message` logs title/body in packaged builds | **CLOSED**, `f7b7947` | Both sites (`:744`, `:819`) log `err.code`. No `err.message` is left in `src/`. `err.cmd` still holds the command line, but it is never logged. |
| N3 | "On a healthy system every unattended reminder is re-posted at 120 s" | **Premise likely wrong** (see C2-1). The fix is still correct. | The journal shows `NotificationClosed` for PID 623127 at 12:19:43, 5 s after the 12:19:38 spawn. |
| 🟢s | Stale `.so` comment `:63`, "re-fires on reconnect" `:756`, package.json floors, SW `userAgentData`, README CSP row | **OPEN, 0 days** | Unchanged. |

**Count: 2 closed, 1 closed-but-unenforced, 7 open, 1 untracked.** Everything is from the same day, so the age is not the story yet. The story is that **nothing closed is enforced**: the one P1 fix that landed has no executable guard, and its discriminator depends on Node internals (C2-3).

---

## 1. First Impressions

`f7b7947` is a good fix commit. It is small (12 lines of code), it cites the audit item it closes, and it separates "skip the re-post" from "log less". The commit message says what was verified and what is *not* fixable in the repo. The comment explains *why* `syscall === "kill"` is needed, which is the one non-obvious part. I could not break the predicate with any error shape `execFile` produces. My complaints are about the comment's explanation of *when* the timeout fires, two log-quality nits, and the fact that a hand-verified fix has nothing holding it in place.

## 2. Architecture & Structure

Unchanged since cycle 1. `index.ts` is now 1,083 lines, and the notification policy (cap, dedupe, the error classifier) is still inline in `dispatchNativeNotification`. The new classifier `err.killed || syscall === "kill"` is exactly the kind of pure decision that should live in a tiny module with tests (C2-3). Nothing new in dependencies.

## 3. Single Authority

**Q4 (cycle 1): "How many `notify-send` processes are outstanding?"** The answer is still `waitingNotifySendCount` (`:754`). On this machine it is still wrong after 120 s, because the slot is freed while the child lives. The audit chose that deliberately, since holding the slot would saturate the cap permanently. That is defensible, but the README sentence at `:50` still claims a process bound that the counter does not provide. One question, two answers that disagree: G#6.

**Q5 (new): "Did this notification fail, or did it just time out?"** It is answered in exactly one place, `:812-821`. That is good. But the answer is inferred from the *shape of a Node error object*, not from anything the app owns. See C2-3.

**Q6 (new): "When does a notification end?"** There are three answers:
- the code comment at `:811-812`: "The 120 s timeout is the notification expiring"
- the base args `:733-734`: `--transient --expire-time=-1`, which means the server default
- the desktop, which closed the 12:19:38 popup at 12:19:43

They disagree. See C2-1.

## 4. Code Quality

- `(err as NodeJS.ErrnoException).syscall` is a cast where `ExecFileException` already extends `ErrnoException` in `@types/node`. It is harmless, and tsc is clean. 🟢
- `console.error("[NotionCalendar] notify-send failed:", err.code)` prints `null` for a signal-terminated child (C2-2).
- The comment block at `:811-814` explains the *mechanism* correctly and the *trigger* incorrectly (C2-1).

## 5. Hall of Shame

🟡 **C2-3, `src/main/index.ts:815`: the P1 fix rests on Node internals, with no guard**
```ts
if (err.killed || (err as NodeJS.ErrnoException).syscall === "kill") {
```
The EACCES branch works only because Node's `execFile` `errorhandler` sets `ex = e` *before* `exithandler` runs, so `ex ||= genericNodeError({killed: ...})` never stamps `killed` on it. I confirmed this in Node 22.22.1's `execFile` source and empirically under Electron 42's Node 24.19.0. If a Node upgrade changes how a refused kill is surfaced (throwing instead of emitting `'error'`, or a different `syscall` string), the predicate silently goes false. The 120 s button-less duplicate would then come back, and nothing would fail. The commit says each branch was "checked against real child processes", but that check was not committed. **Fix:** extract `function isWaitTimeout(err): boolean` into a dependency-free file. Add a `node --test` that drives real `execFile` children for the four shapes in section 6 (the `_handle.kill` patch reproduces EACCES without AppArmor). Run it in `release.yml`. That is the "Enforced" fate for this finding and the first brick of G#7.

🟢 **C2-1, `:811-812`: the comment and commit message misstate when the timeout fires**
```ts
// The 120 s timeout is the notification expiring, not notify-send failing: re-posting it
// would show every reminder twice.
```
With `--transient --expire-time=-1`, Plasma expires the popup on its own default and emits `NotificationClosed`. Here that happened at **12:19:43 for PID 623127, spawned at 12:19:38**: five denied `NotificationClosed` deliveries in that second, one of them to 623127. A notify-send that is allowed to *receive* that signal exits with code 0 about 5 s after display, long before 120 s. So the 120 s timeout is "we never heard the close", which on this machine is the AppArmor denial. It is not the notification expiring. The commit message's "every unattended reminder appeared twice" was true **only under AppArmor**. Audit N3's healthy-machine claim looks wrong. Skipping the re-post is still the right behaviour, because the notification was shown either way. Only the explanation is off, and the next person to tune the 120 s will tune it from the wrong model. **Fix:** "Reaching the 120 s timeout means we never received the close/action signal. The notification was already displayed, so do not re-post." This is unverified on a desktop without the AppArmor profile, so say "on Plasma" rather than generalising.

🟢 **C2-2, `:819`: signal deaths log `null`, and an external kill re-posts**
Under Electron's Node, a `notify-send` killed by someone other than our timeout gives `{code: null, signal: "SIGTERM", killed: false}`. That logs `notify-send failed: null` and re-posts the reminder button-less. The `null` throws away the only useful fact. Use `err.code ?? err.signal`, as `:816` already does. The re-post itself is a judgement call. A user who `pkill`s a stuck notifier on a non-AppArmor desktop gets a duplicate, while a crash of the notification daemon would arguably deserve one. Leave it, but log the signal.

## 6. Logic & Business Rules: does f7b7947 handle every `execFile` error shape?

The probe drives real children through `execFile(file, args, {timeout}, cb)` and applies the commit's predicate. It runs under **Electron 42's Node 24.19.0**, which is the runtime that matters:

| Shape | `code` | `signal` | `killed` | `syscall` | Predicate → | Correct? |
|---|---|---|---|---|---|---|
| Timeout, kill succeeds | `null` | `SIGTERM` | `true` | n/a | skip, logs `SIGTERM` | ✅ |
| Timeout, kill refused (EACCES; this machine) | `EACCES` | n/a | unset | `kill` | skip, logs `EACCES` | ✅ |
| Timeout races a natural exit | `null` | `SIGTERM` | `true` | n/a | skip | ✅ |
| External SIGTERM / SIGKILL | `null` | `SIGTERM`/`SIGKILL` | `false` | n/a | **re-post**, logs `null` | ⚠️ C2-2 |
| Nonzero exit (no daemon, bad flag) | `3` | `null` | `false` | n/a | re-post, logs `3` | ✅ |
| `notify-send` missing | `ENOENT` | n/a | n/a | `spawn notify-send` | re-post → minimal also logs `ENOENT`, no loop | ✅ |
| Spawn EACCES | `EACCES` | n/a | n/a | `spawn …` | re-post (`syscall` ≠ `"kill"`, so it is not misclassified) | ✅ |
| NUL in any arg | — | — | — | — | **synchronous throw; callback never runs** | ❌ still G#3 |
| maxBuffer exceeded | `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` | n/a | unset | n/a | re-post | ✅ (unreachable, since stdout is one action key) |

Notes:
- `syscall === "kill"` can come only from execFile's own `kill()`. That is called on timeout, maxBuffer (which pre-sets `ex`, so it never reaches the kill error) and AbortSignal (not used). So the predicate cannot misfire on a non-timeout failure. ✅
- Message hygiene: a nonzero exit's `err.message` does contain the title (`"Command failed: … SECRET"` reproduced), which confirms N2 was real and is now closed. EACCES and ENOENT messages carry no args.
- Probe pitfall, recorded so nobody repeats it: `sh -c 'sleep 5'` gave `killed: true` for an *external* SIGTERM about half the time. The orphaned `sleep` held the stdout pipe open, `'close'` waited, and our 5 s timeout fired first. `notify-send` has no grandchildren, so this does not apply to it. Use `exec sleep` in any future test.

**Regressions?** None found.
- On this machine, each reminder now spawns 1 process instead of 2, and the one that leaks is the same one that leaked before. So it is not worse for the AppArmor issue.
- When the timeout kill succeeds, `kill()` destroys stdout, so an action clicked after 120 s is lost. That is pre-existing and unchanged.
- The cap still frees slots at 120 s while the child lives. That was deliberate per the audit and is unchanged.

**Claimed fixed but not fixed?**
- The commit's two claims (A1 re-post, N2 logging) hold.
- The README Notification-flood row (G#6) was *not* claimed and is still false.
- The commit message's healthy-machine framing ("every unattended reminder appeared twice") is likely overstated (C2-1).

## 7. Test Strategy & Execution

There are still no tests. The new fix is the clearest case yet for a minimal test harness. The bug lives on the "callback fired, process still alive" axis, which cycle 1 said a handed-in fake cannot express. A real `execFile` child with `_handle.kill` patched to return `-13` *does* express it, and runs in under a second (my probe does exactly this). Today the only instrument for this axis is the journal on Mitch's machine. C2-3 / G#7.

## 8. Security & Performance

- N2 is closed: packaged builds no longer write titles or bodies via `err.message`. The remaining unconditional logs (`:128`, `:149`, `:430`, `:776`, `:789`, `:816`, `:819`, `:876`, `:898`, `:1000-1003`) carry no notification payload. `:876` logs a SW scope URL, which is fine.
- G#4 (subframe permission fallback) is still the only security-relevant open item in the diff. It is unchanged, Medium per the audit, and a quick fix.
- No new attack surface in f7b7947.

## 9. Documentation vs. Reality

| Claim | Reality | Verdict |
|---|---|---|
| README `:50` "page script cannot spawn processes without bound" | Minimal path uncapped; `--wait` slots freed while child lives | **Still false** (G#6) |
| README `:49` grants "only to Notion origins" | Subframes inherit via `getURL()` fallback | **Still overstated** (G#4) |
| `index.ts:811` "The 120 s timeout is the notification expiring" | Popup closed 5 s after spawn, and the timeout means the close was never received | **Wrong mechanism** (C2-1) |
| f7b7947 message: "Checked each branch against real child processes" | Reproduced independently, and true. But not committed | True, unenforced (C2-3) |

---

## Verdict

`f7b7947` does what it says. Across every error shape `execFile` can produce under Electron's own Node, it skips the re-post for both timeout variants, still falls back on genuine failures, and no longer leaks titles to the journal. I found no regression. What's left on the branch is the same short list cycle 1 left, minus two:
- G#4, the permission fallback, which is the only open security-relevant item
- G#3, the synchronous-throw counter leak
- G#6, the README sentence that is still false
- N1, the NUL byte, which now also poisons the build output for grep

On top of those come a wrong-mechanism comment and a log nit from this commit. None is 🔴. The thing I'd hold the line on is C2-3: the P1 fix is guarded by nothing but a commit message, and it rests on how Node shapes a refused kill.

## Priority backlog

No 🔴 items introduced or open in code. Top items for this PR, in order:
1. 🟡 **G#4**: decide permissions on `requestingOrigin`/`requestingUrl` only, and fall back to `getURL()` only when both are absent (audit's snippet).
2. 🟡 **C2-3**: extract `isWaitTimeout(err)` and add a `node --test` with real children (timeout-ok, kill-EACCES via `_handle.kill`, nonzero exit, ENOENT). Wire it into `release.yml`.
3. 🟡 **G#3**: wrap `execFile` in try/catch and increment the counter after it returns.
4. 🟡 **G#6**: reword README `:50` to what the code does ("`--wait` notifiers are capped by count with a 120 s timeout; exact repeats within 5 s are dropped").
5. 🟢 **N1, C2-1, C2-2**: `\u0000` escape; reword the timeout comment; log `err.code ?? err.signal` at `:819`.

## Finding ledger

| # | Finding | Severity | Fate | Enforced by | Fails today if it regresses? |
|---|---------|----------|------|-------------|------------------------------|
| G#1 / A1 | Re-post on `--wait` timeout (both kill-ok and kill-EACCES) | 🟡 (was P1) | **Fixed** in `f7b7947` | — (hand-verified only) | **No** → see C2-3 |
| C2-3 | Timeout classifier `err.killed \|\| syscall === "kill"` relies on Node execFile internals, untested (`index.ts:815`) | 🟡 | Handed to user. Rec: extract and add `node --test` with real children, and run it in `release.yml` | — | **No** |
| G#2 / A2 | Join / Open Calendar actions denied by AppArmor | 🔴 (pre-existing) | Handed to user (machine config, out of scope) | — | **No** |
| G#3 | Counter incremented before `execFile` that throws synchronously on NUL (`:807-808`) | 🟡 | Handed to user. Rec: try/catch + increment after spawn, in this PR | — | **No** |
| G#4 | Permission check falls back to top-level `getURL()`; subframes inherit grants (`:925-937`) | 🟡 | Handed to user. Rec: fix in this PR | — | **No** |
| G#6 | README `:50` process-bound claim false | 🟡 | Handed to user. Rec: reword in this PR | — | **No** |
| G#7 | No tests; no tsc in CI | 🟡 | Handed to user. Rec: start with C2-3 + `isTrustedNotionOrigin` cases | — | **No** |
| G#8 | Clipboard hand-test after `clipboard-read` removal: result never recorded | 🟡 (UNTRACKED) | Handed to user: do the 1-min test and note the result in the PR body | — | **No** |
| N1 | Raw NUL byte at `:761`; also lands in `out/main/index.js` (grep sees binary) | 🟢 | Handed to user. Rec: `\u0000` | — | **No** |
| C2-1 | Comment/commit say the 120 s timeout is "the notification expiring". The journal shows close at +5 s; the timeout means the close was never received (`:811-812`) | 🟢 | Handed to user. Rec: reword | — | **No** |
| C2-2 | Signal-terminated child logs `failed: null` and re-posts (`:819`) | 🟢 | Handed to user. Rec: `err.code ?? err.signal` | — | **No** |
| G#5 | Nav allowlist doubles as trust list | 🟢 (audit-downgraded) | Handed to user: optional | — | **No** |
| G#9 | Reviews dir untracked | — | **Fixed** in `f7b7947` | git | n/a |
| N2 | `err.message` leaked titles/bodies | — | **Fixed** in `f7b7947` | — | **No** |
