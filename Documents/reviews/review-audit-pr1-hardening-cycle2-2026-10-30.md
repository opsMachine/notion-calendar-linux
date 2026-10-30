# Review Audit: pr1-hardening, cycle 2 of 5

**Date:** 2026-10-30
**Artifact audited:** `Documents/reviews/grumpy-review-pr1-hardening-cycle2-2026-10-30.md`
**Branch:** `hardening/pr1-vetted` (`e7bb4d2` hardening, `f7b7947` cycle-1 fix). Diff: `git diff main..hardening/pr1-vetted -- . ':!package-lock.json' ':!Documents/reviews'`.
**Method:** read every cited line; re-ran the machine claims with read-only `journalctl`, `ps`, `man`, `dpkg`; ran scratch experiments under system Node 22.22.1 and Electron 42.11.18's own Node 24.19.0 (`ELECTRON_RUN_AS_NODE=1`); built the branch from `git archive` in the scratchpad. I did not launch, kill or signal Notion Calendar or any `notify-send`, and I changed no product code or system config. Every child I killed was a `sleep` my own script spawned.

**Scratch files** (all under `/tmp/claude-1000/-home-mitch-Documents-GitHub-notion-calendar/296824cb-f254-4590-90ee-63207192454d/scratchpad/c2a/`): `probe.js` (10 execFile shapes), `mb.js` (maxBuffer), `guard.test.js` (proof that a real-child `node --test` guard runs under Electron's Node), `perm/main.js`, `perm/main_noallow.js`, `perm/main_sbx.js` (permission-handler harness, a throwaway Electron app of my own, hidden window, no Notion code), `arch/` + `b/` (branch archive and its build).

## Headline

**P0: 0. P1: 0 actionable in-repo.** One P1 is carried forward from cycle 1 and cannot be closed by any code change (the AppArmor local override, which is a user action on this machine). The cycle-1 fix `f7b7947` is correct. The Grumpy artifact is accurate on every machine and code claim I could test. I corrected three things:

1. **C2-3 is rated too high.** The facts are right (no guard, rests on Node's error shape) but the severity is P3, not P1.
2. **G#4's exploit path is worse than either prior review said.** I reproduced it in a real Electron harness: a cross-origin iframe gets `notifications` granted with **no Permissions-Policy delegation**. Both earlier reviews assumed delegation was needed. It stays P2 (see ruling d), but the "needs delegation" mitigation both reviews relied on is wrong.
3. **One small tooling claim does not reproduce** (`grep -c 'timed out'` on the bundle returns 1, not 0).

## Rulings on the four questions

| | Question | Ruling |
|---|---|---|
| (a) | Is `f7b7947` correct? | **Yes.** Both timeout shapes skip the re-post. Every genuine failure shape still re-posts. No regression found. Reproduced on two runtimes. |
| (b) | Is C2-1 right that cycle 1's "healthy machines also got duplicates" was wrong? | **Mostly yes (✅ with a caveat).** On Plasma, the evidence says the popup closes at +5 s and a notify-send that can hear it exits. The old duplicate on a healthy desktop is unproven and unlikely. But the claim is inference plus documented `--wait` semantics, not an observed unconfined run. It cannot be observed here, because the profile has applied for the whole journal. |
| (c) | Does "no regression guard" (C2-3) rate P1? | **No. P3.** True fact, inflated severity. |
| (d) | G#4 priority? | **P2 (Medium)**, fix in this PR. Not P1. Evidence is stronger than before, but it is still a strict narrowing of `main`. |

---

## Work Queue (claims extracted)

**Method and environment claims**
M1. `electron-vite build` passes and the bundle contains the new log strings.
M2. `tsc --noEmit -p tsconfig.node.json` shows only the known `config.ts(12,76)` error.
M3. The execFile probe covers 9 shapes under Node 22.22.1 and Electron's Node 24.19.0.
M4. Journal: dev notification spawned 12:19:38, `NotificationClosed` for PID 623127 at 12:19:43.

**Prior-finding ledger (Step 0)**
L1. G#1/A1 closed in code by `f7b7947`; no test.
L2. G#2/A2 out of scope.
L3. G#3 counter incremented before an `execFile` that throws on NUL (`:807-808`).
L4. G#4 permission fallback to `getURL()` (`:925-937`).
L5. G#5 trust list coupled to the nav list, optional P3.
L6. G#6 README `:50` still false.
L7. G#7 no tests, no tsc in CI.
L8. G#8 clipboard hand-test untracked.
L9. G#9 reviews dir now tracked.
L10. N1 raw NUL at `:761`, copied into the bundle; `grep -c 'timed out' out/main/index.js` returns 0.
L11. N2 `err.message` no longer logged (`:744`, `:819`).
L12. N3 "healthy machine re-posts at 120 s" has a wrong premise.
L13. The tally: "2 closed, 1 closed-but-unenforced, 7 open, 1 untracked".

**Code and comment claims**
K1. `f7b7947` is 12 lines of code and cites the audit item; `index.ts` is 1,083 lines.
K2. The `(err as NodeJS.ErrnoException)` cast is unnecessary.
K3. C2-3: the predicate depends on Node internals and has no guard (`:815`).
K4. C2-1: the comment and commit message misstate when the timeout fires (`:811-812`).
K5. C2-2: a signal-killed child logs `null` and re-posts (`:819`).
K6. Section 6 table: 9 rows of execFile shapes and the predicate outcome, plus the `syscall === "kill"` reachability note, the `err.message` leak repro, and the `sh -c` probe pitfall.
K7. No regressions from `f7b7947`; the slot is freed at 120 s deliberately; the action is lost after a successful timeout kill (pre-existing).
K8. Remaining unconditional logs carry no notification payload.
K9. Documentation table: README `:49`, `:50`, comment `:811`, commit message.
K10. Proposed fix for C2-3: extract `isWaitTimeout`, add `node --test`, wire into `release.yml`.

---

## Claim Verification

### Method and environment

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| M1 | Build passes; bundle holds the new strings | ✅ Confirmed | `git archive` into scratch, `electron-vite build`: "built in 29ms". Bundle contains `notify-send --wait timed out:", err.code ?? err.signal`. |
| M2 | tsc shows only `config.ts(12,76)` | ✅ Confirmed | `src/main/config.ts(12,76): error TS2694: Namespace 'ElectronStore' has no exported member 'default'.` Nothing else. `config.ts` is not in the branch diff (`git diff --stat` lists 8 files, none of them `config.ts`), so the error is pre-existing on `main`. |
| M3 | 9 shapes, two runtimes | ✅ Confirmed | My own `probe.js` (10 shapes, including EPERM as a second refused-kill code) gives identical results on Node 22.22.1 and Node 24.19.0 (see the table in the K6 section). |
| M4 | 12:19:38 spawn, 12:19:43 close for 623127 | ✅ Confirmed | `12:19:38 ... GetCapabilities ... pid=623127`, then at `12:19:43` five `member="NotificationClosed" ... mask="receive"` denials for pids 953012, 419177, 1409431, 430221 and **623127**. The re-post repeats the pattern: `12:21:38 GetCapabilities pid=628357`, then five denials (the same four orphans plus 623127, not 628357, which has already exited) at `12:21:43`. |

### Prior-finding ledger

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| L1 | G#1/A1 closed in code, unenforced | ✅ Confirmed | `src/main/index.ts:815` `if (err.killed \|\| (err as NodeJS.ErrnoException).syscall === "kill")` then `return` before `notifySendMinimal`. No test file exists. |
| L2 | G#2/A2 out of scope | ✅ Confirmed | `/etc/apparmor.d/local/notify-send` still does not exist. There are 5 live `notify-send` processes, including 4 orphans from `/opt` under `systemd --user` (ppid 3118), with ages from 8,012 s to 152,012 s. Nothing changed. |
| L3 | G#3 counter incremented before a throwing `execFile` | ✅ Confirmed | `:807` `waitingNotifySendCount += 1;` then `:808` `const child = execFile(...)`. My probe row "NUL arg" gives a synchronous `ERR_INVALID_ARG_VALUE` on **both** runtimes and the callback never runs. No `uncaughtException` handler exists in `index.ts` (grep is empty). |
| L4 | G#4 fallback to `getURL()` | ✅ Confirmed, and **stronger than stated**. See the G#4 section. |
| L5 | G#5 optional P3 | ✅ Agree | `ALLOWED_HOSTNAMES` (`:26-41`) feeds both `isAllowedUrl` and `isTrustedNotionOrigin`. Cycle 1 showed the branch narrowed trust. Negligible. |
| L6 | G#6 README `:50` still false | ✅ Confirmed | README line 50: "...so page script cannot spawn processes without bound". `:788-794`: past the cap the code calls the uncapped `notifySendMinimal`. Dedupe drops only exact title+body repeats. A loop of unique titles is unbounded. False regardless of AppArmor. |
| L7 | G#7 no tests, no tsc in CI | ✅ Confirmed, with context the artifact missed | No `test` script, no test files. The only workflows are `release.yml` (runs on `v*` tags, does `npm ci` and `build:linux`) and `flatpak.yml` (push to `main`, calls a remote workflow). **There is no `pull_request` CI at all**, and Dependabot raises weekly Electron PRs with nothing checking them. |
| L8 | G#8 clipboard hand-test untracked | ✅ Confirmed | No record in the repo, the commit messages or the reviews. |
| L9 | G#9 closed | ✅ Confirmed | `git ls-files Documents/reviews` lists `README.md`, the cycle-1 Grumpy and the cycle-1 audit. The only untracked file is the cycle-2 Grumpy itself (`git status`: `?? Documents/reviews/grumpy-review-pr1-hardening-cycle2-...`), which is expected. |
| L10 | N1 raw NUL, also in the bundle; "`grep -c 'timed out'` returns **0**" | ⚠️ Partially True | The NUL is real. Python count of `\x00` in `src/main/index.ts` is 1, first on line 761 (`main` has 0), and `file` reports `data`. The scratch bundle has 1 NUL byte too. **The "returns 0" part does not reproduce.** GNU grep 3.12: `grep -c 'timed out' out/main/index.js` returns **1**, and `-ac` also returns 1. What actually happens is that a plain `grep 'timed out'` prints `binary file matches` instead of the line. Tooling does misread the file, but the match is not lost. Tiny; does not change priority. |
| L11 | N2 closed | ✅ Confirmed | `:744` and `:819` log `err.code`. The only remaining `err.message` string in `src/` is inside the explanatory comment at `:811`. |
| L12 | N3 premise likely wrong | ✅ Confirmed, see the C2-1 ruling. |
| L13 | Tally | ⚠️ Cosmetic | Closed items are G#1 (code), G#9, N2, which is three. Ledger arithmetic is loose, not material. |

### Code and comment claims

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| K1 | 12 lines, cites audit item; 1,083 lines | ✅ Confirmed | `git diff --stat f7b7947~1 f7b7947 -- src` gives 10 insertions and 2 deletions, so 12 changed lines. The message cites "audit item A1, P1" and "N2, P2". `wc -l src/main/index.ts` gives 1083. |
| K2 | Cast is unnecessary | ✅ Confirmed (trivial) | `@types/node` 25.5.0: `type ExecFileException = Omit<ExecException,"code"> & Omit<NodeJS.ErrnoException,"code"> & { code?: string \| number \| null }`. `syscall` is already on the type. |
| K3 | C2-3: predicate rests on Node internals, no guard | ✅ Confirmed as fact; ⚠️ severity inflated | See ruling (c). |
| K4 | C2-1: comment misstates the mechanism | ✅ Confirmed | See ruling (b). |
| K5 | C2-2: signal death logs `null` and re-posts | ✅ Confirmed (P3) | Both runtimes: `external SIGTERM  code:null signal:'SIGTERM' killed:false -> REPOST`. `:819` logs `err.code`, which is `null`. The only caveat is reach: the callback runs only for a child the app still tracks. An external kill inside the 120 s window is rare (a user `pkill`, a session teardown). After an AppArmor-orphaned child outlives its callback, nothing re-posts. |
| K6 | Section-6 table | ✅ Confirmed, every row | Table below. |
| K7 | No regressions; slot freed on purpose; action lost after timeout kill | ✅ Confirmed | Slot freeing was the cycle-1 audit's decision (`:809` `-= 1` precedes the branch). The success-kill case destroys stdout, so a late click is lost, as before. |
| K8 | Remaining logs carry no payload | ✅ Confirmed | Read the `console.*` lines. They log scope URLs, codes, targets and fixed strings. `:876` logs a SW scope URL only. |
| K9 | Docs-vs-reality table | ✅ Confirmed | All four rows hold. The `:811` comment and commit message get the mechanism wrong (C2-1). |
| K10 | Fix for C2-3 | ⚠️ Partially True | The idea is sound. The detail "run it in `release.yml`" is weak, because that workflow fires only on tag push. See ruling (c). The `_handle.kill` patch that reproduces EACCES does work (my `guard.test.js` row 2). |

**K6 detail: execFile shapes, reproduced by me.** Results are identical on Node 22.22.1 and Electron's Node 24.19.0.

| Shape | `code` | `signal` | `killed` | `syscall` | Predicate | Correct |
|---|---|---|---|---|---|---|
| Timeout, kill ok | `null` | `SIGTERM` | `true` | n/a | skip | ✅ |
| Timeout, kill refused (EACCES), child alive at callback | `EACCES` | n/a | n/a | `kill` | skip | ✅ |
| Timeout, kill refused (EPERM), child alive | `EPERM` | n/a | n/a | `kill` | skip | ✅ |
| External SIGTERM / SIGKILL (via `process.kill`, so Node's `child.killed` stays false) | `null` | `SIGTERM`/`SIGKILL` | `false` | n/a | re-post, logs `null` | ⚠️ C2-2 |
| Nonzero exit | `3` | `null` | `false` | n/a | re-post | ✅ |
| `ENOENT` | `ENOENT` | n/a | n/a | `spawn ...` | re-post, no loop (minimal logs and stops) | ✅ |
| Spawn `EACCES` (non-executable) | `EACCES` | n/a | n/a | `spawn /etc/hostname` | re-post (`syscall` is not `"kill"`) | ✅ |
| NUL in an arg | sync throw `ERR_INVALID_ARG_VALUE` | | | | callback never runs | ❌ G#3 |
| maxBuffer exceeded (**added by me**) | `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` | n/a | n/a | n/a | re-post | ✅ (unreachable: stdout is one action key) |
| Clean exit 0 | no error | | | | success path | ✅ |

---

## Ruling (a): is `f7b7947` correct?

**Yes.** Points checked beyond the Grumpy table:

- **The discriminator is exact.** `killed` catches the successful kill; `syscall === "kill"` catches the refused kill. No other shape in the probe sets either. `syscall` begins `spawn ` for spawn failures, so it cannot be mistaken for `"kill"`.
- **It matches this machine's real history.** The installed app's stdout shows 156 `[NotionCalendar] notify-send failed: kill EACCES` lines since Aug 17 (the journal starts then). Zero are "Command failed" or any other message. That is exactly the shape the fix tests for.
- **One edge I considered and ruled out.** The new code cannot distinguish "displayed and waiting" from "hung before display". A hang before display would now drop the reminder where the old code would have re-posted it. In practice a stuck D-Bus call fails at GDBus's default method timeout (25 s, believed, not run) with a nonzero exit, which takes the re-post branch. A 120 s timeout with nothing displayed is not a realistic state. I record it as considered, not as a finding.
- **Accounting still holds.** The `-= 1` precedes the branch, so the slot is freed in both timeout shapes. The orphan still leaks (A1 machine part).
- **Log hygiene is correct.** `err.code ?? err.signal` yields `SIGTERM` (kill ok) and `EACCES` (refused). The `err.code`-only log at `:819` is the C2-2 nit.

No regression found. The fix removes one of two processes per reminder on this machine (the re-post) and leaves the leak of the other unchanged.

## Ruling (b): C2-1, "healthy machines also got duplicates" was wrong

**✅ Confirmed on the evidence, with a stated limit.**

What supports it:
1. **Timing.** The popup the app posted at 12:19:38 was closed at 12:19:43 (+5 s). The re-post at 12:21:38 closed at 12:21:43 (+5 s). Both closes are visible only because AppArmor denied delivery to each live `notify-send`, which is why they are in the journal. A notify-send that is allowed to receive `NotificationClosed` exits when it arrives.
2. **Documented semantics.** `man notify-send`: "`-w, --wait` Wait for the notification to be closed before exiting." libnotify-bin 0.8.8-1.
3. **The cycle-1 claim had no observation behind it.** Cycle 1's N3 reasoned from the Node error shape ("a successful timeout kill also errors"), which is true, but never established that a healthy notify-send reaches the timeout.

What limits it:
- **No unconfined baseline exists.** The profile applies to the whole journal (Aug 17 on). I may not spawn a `notify-send` to test it, so a healthy exit at +5 s is inferred, not observed.
- **Residual healthy-machine case.** On a server that never emits `Closed` (a daemon that retains the notification, or do-not-disturb handling), a healthy notify-send would still reach 120 s, and the old code would re-post. The new code is right in that case too. So N3 is "unproven and unlikely on Plasma", not "impossible".

**Related correction to the commit message.** It says "every *unattended* reminder appeared twice". On this machine **every** reminder was duplicated, attended or not: the app never learns of the close, so the 120 s timeout re-posts it either way. Spawn 10:50:00 and re-post 10:52:00 are both in the journal. The word "unattended" is too narrow, but only the explanation is wrong; behaviour is fine.

Recommended comment fix (P3, from the Grumpy): "Reaching the 120 s timeout means no close/action signal came back. The notification was already displayed, so do not re-post." Do not rewrite the commit; leave history alone.

## Ruling (c): C2-3 "the fix has no regression guard", does it rate P1?

**⚠️ Partially True. The facts hold; the severity does not. Rate P3.**

Facts that hold: no test exists; the refused-kill branch works because Node sets `ex = e` in `errorhandler` before `exithandler` can stamp `killed`, so it depends on Node/Electron internals; I confirmed the shapes on two runtimes.

Why not P1:
- **Consequence of a regression is cosmetic.** A silent drift would bring back one button-less duplicate toast per reminder. No data loss, no security exposure, no crash.
- **The change has a narrow trigger.** The shape can change only on an Electron major bump (Node major). Electron 42 → Node 24.19.0 behaves identically to Node 22.22.1 today, which is mild evidence of stability across majors.
- **The premise is repo-wide.** The repo has no test runner at all. The same logic makes every guard in the branch P1, which cycle 1 already rated Low for a one-file wrapper. One more unguarded function does not change the picture. That is G#7.
- **The proposed fix does not protect what it claims to.** `release.yml` runs only on `v*` tag push and uses `node-version: 22`. A test there would run on Node 22, not the Node 24.19.0 that ships in Electron 42, and only at release time. Dependabot's weekly Electron PRs have no CI at all. The guard would catch drift late and on the wrong runtime.

If you do want the guard, the cheapest version that tests the right thing: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test test/wait-timeout.test.js`. I verified `--test` works under Electron's Node (my `guard.test.js`: 3 pass). It needs three cases (kill ok, `_handle.kill = () => -13`, external SIGTERM). Use `exec sleep` or a direct `sleep` child, not `sh -c 'sleep 5'` (the Grumpy's probe pitfall is real). Add a `pull_request` trigger or the test never sees a Dependabot bump. That is a half-day item. A zero-cost interim: a one-line comment beside `:815` saying "re-verify on Electron major bump (see Documents/reviews)".

## Ruling (d): G#4, permission fallback to the top-level URL

**P2 (Medium). Fix in this PR. Not P1.** The evidence is stronger than either review had, so I tested it rather than reasoning.

**Experiment.** A throwaway Electron 42.11.18 app (`perm/main.js`) with an `http://localhost` top page and an `http://127.0.0.1` iframe (a different origin). "Trusted" means hostname `localhost`. The handlers are the repo's `isPermissionRequesterTrusted` logic copied verbatim ("current") versus the audit's snippet ("fixed").

| Variant | Frame `Notification.permission` | `requestPermission()` | `permissions.query clipboard-write` | Handler log |
|---|---|---|---|---|
| **current**, iframe with `allow="clipboard-write; notifications"` | `granted` | `granted` | `granted` | `check/request` for the untrusted frame: `requestingUrl http://127.0.0.1/frame`, `isMainFrame false`, **granted: true** |
| **current**, iframe **with no `allow` attribute** | `granted` | `granted` | `denied` (Chromium policy) | notifications still granted |
| **fixed** (decide on requester URLs only), same frames | `denied` | `denied` | `denied` | `granted: false` for the frame, top page still `true` |

What this changes:
- **Both earlier reviews said the exploit "needs Permissions-Policy delegation". For notifications that is wrong.** A cross-origin iframe inside a trusted page gets the grant with no `allow=`. Only `clipboard-write` needs delegation, and Chromium enforces that on its own.
- **The fix works and is tight.** Denial reaches the frame; the main frame stays granted. SW-initiated requests carry the SW origin in `requestingOrigin`, so they are still decided on a URL and do not reach the fallback.
- **The actual write did not complete.** `clipboard.writeText` failed with `NotAllowedError` in both variants (hidden window, no user activation), so I have not shown a silent clipboard overwrite. I also did not trigger a real popup, so whether an iframe `new Notification()` displays through Electron's own path in the packaged app is **unverified**. That is the open piece of the impact.
- **My sandboxed-iframe variant was inconclusive.** `location.origin` in my `sandbox="allow-scripts"` frame still reported `http://127.0.0.1`, so I did not get an opaque origin. I make no claim about opaque-origin frames.

Why still P2:
- **It is a strict narrowing of `main`**, where `GRANTED_SESSION_PERMISSIONS.has(permission)` ignored the requester entirely. Nothing regressed.
- **Reach is narrow.** It needs a cross-origin frame inside a page on the allowlist. Notion pages on `notion.so` can embed third-party URLs, so it is realistic but not common.
- **Impact is bounded:** notification grant, plus clipboard-write when delegated. No read access, no code execution, no data exfiltration.
- It is rated above P3 because the PR's own README sentence ("only to Notion origins") is demonstrably untrue for subframes, in a PR whose purpose is that property. The fix is four lines.

## Severity Re-Assessment

| # | Issue | Reviewer | My rating | Delta | Reasoning |
|---|---|---|---|---|---|
| G#4 | Permission fallback to top-level | 🟡 (top of PR list) | **Medium → P2** | = | Exploit path verified and wider than thought (no delegation for notifications). Still a narrowing of `main`. |
| C2-3 | No guard on timeout classifier | 🟡, "hold the line" | **Low → P3** | ↓ | Cosmetic blast radius; trigger is an Electron major; `release.yml` guard would test Node 22, not 24.19. |
| G#3 | Counter leak on NUL | 🟡 | **Low → P3** | ↓ | Needs a NUL in Notion event text; one leaked slot per event, 8 to degrade, restart clears; the throw (error dialog) is pre-existing. |
| G#6 | README process-bound claim | 🟡 | **Low → P2** | = | Docs accuracy in a security table, quick edit. False independent of AppArmor. Kept at P2 for consistency with cycle 1. |
| G#7 | No tests / no tsc in CI | 🟡 | **Low → P3** | ↓ | Small solo wrapper. Note: no `pull_request` CI exists, which is the bigger gap than the missing test. |
| G#8 | Clipboard hand-test | 🟡 | **Low → P3** | ↓ | Static evidence says safe. One manual minute. |
| G#2 / A2 | AppArmor denies `ActionInvoked` | 🔴 | **High → P1 (carried)** | ↓ one notch | Pre-existing, machine config, journal shows ~9 denied click moments. User action. |
| C2-1 | Wrong mechanism comment | 🟢 | **Low → P3** | = | Documentation only. Worth fixing so the 120 s value is tuned from the right model. |
| C2-2 | Signal death logs `null` | 🟢 | **Negligible → P3** | = | One token: `err.code ?? err.signal`. |
| N1 | Raw NUL byte | 🟢 | **Low → P3** | = | One-line `\u0000`. Tooling nuisance. |
| G#5 | Split trust list | 🟢 | **Negligible → P3** | = | Optional. |

---

## What the Review Missed

I looked for gaps in the diff and in the Grumpy's own claims. The review was thorough, so this list is short.

1. **G#4's "needs delegation" mitigation is false** for notifications (see ruling d). The Grumpy carried it forward from cycle 1 without testing it. Material to the exploit story, not to the priority.
2. **There is no PR CI at all** (only a tag-triggered release build and a `main`-push trigger for flatpak), and Dependabot raises weekly Electron PRs. G#7 and C2-3 both assume CI exists to "wire into". The missing piece is a `pull_request` trigger, not just a test.
3. **The CI Node is not the shipping Node.** `release.yml` pins Node 22; Electron 42 ships 24.19.0. A guard for Node's error shape must run under `ELECTRON_RUN_AS_NODE=1 electron --test` to mean anything. I verified that works.
4. **The commit message's "unattended" is too narrow** (see ruling b). Every reminder on this machine was duplicated.
5. **A latent failure mode in the new branch**, considered and dismissed: a reminder whose notify-send hangs before display would now be dropped at 120 s rather than re-posted. Bounded by the D-Bus method timeout (believed, not run); not a finding.
6. **The `grep -c` claim does not reproduce** (L10), a tooling nit.

No new security flaw beyond G#4. I re-checked `isTrustedNotionOrigin` (https only, exact `Set` lookup, `new URL` lowercases host) and found it sound.

## What the Review Got Right (And Why It Matters)

1. **It verified `f7b7947` against the runtime that ships**, not just the system Node. That is the correct bar, and the probe results match mine row for row. It also noticed `sh -c 'sleep 5'` poisons a timeout probe, a real trap.
2. **C2-1 is a good catch.** It found the +5 s close in the journal and turned it into a model correction. The fix is right either way, but the next person tuning 120 s would otherwise tune from the wrong mental model.
3. **The ledger discipline** ("closed" only when evidenced, nothing closed is enforced) is the right frame, even though I rate the enforcement gap lower.
4. **It kept G#2 out of the code scope** instead of inventing a code workaround.

---

## Fixes for the P0/P1 items

**P0: none.**

**P1 (carried, machine action, not repo code): AppArmor `notify-send` profile denies `NotificationClosed`, `ActionInvoked` and SIGTERM.** Covers A1's machine half (orphaned processes, +5 s close never delivered) and A2 (Join / Open Calendar buttons dead). The code half of A1 is done in `f7b7947`. Nothing in the repo closes this. The minimal fix is the same one given in cycle 1, a new root-owned file; I have **not** applied it and it was **not** applied by anyone (`/etc/apparmor.d/local/notify-send` does not exist):

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

then `sudo apparmor_parser -r /etc/apparmor.d/notify-send`. Existing orphans stay until killed or logout (`pkill -f 'notify-send.*Notion Calendar'`). Verify after: the next reminder produces no new `NotificationClosed` or `signal=term` denials in `journalctl`, the process exits when the popup closes, and one click on a real reminder produces no `ActionInvoked` denial. The syntax was parse-checked in cycle 1 and not re-run now.

## Prioritized Action Matrix

| Priority | Issue | Verdict | Effort | Depends On |
|----------|-------|---------|--------|------------|
| P0 | none | n/a | n/a | n/a |
| P1 (carried, user action) | AppArmor local override: orphaned `--wait` processes, `NotificationClosed` and `ActionInvoked` denied, Join button dead (cycle-1 A1 machine part + A2; Grumpy G#2) | ✅ | quick fix (user, root, one file) | none |
| P2 | G#4: permission handler falls back to top-level `getURL()`, so cross-origin iframes get `notifications` (no delegation needed; verified in Electron 42) | ✅ | quick fix (about 4 lines in `isPermissionRequesterTrusted`, `:925-937`) | none; do in this PR |
| P2 | G#6: README `:50` "cannot spawn processes without bound" is false (minimal path uncapped, `--wait` slots freed at 120 s) | ✅ | quick fix (reword) | none |
| P3 | C2-3: no regression guard on `err.killed \|\| syscall === "kill"` | ⚠️ (facts ✅, P1 rating ❌) | half-day (extract + `electron --test` + `pull_request` trigger); interim: one-line comment | G#7 |
| P3 | G#3: counter incremented before an `execFile` that can throw on NUL | ✅ | quick fix (try/catch, increment after) | none |
| P3 | G#7: no tests, no tsc, no `pull_request` CI | ✅ | half-day | none |
| P3 | G#8: hand-test Ctrl+C / Ctrl+V after `clipboard-read` removal | ✅ | quick fix (manual, about 1 min) | none |
| P3 | C2-1: comment `:811-812` states the wrong mechanism ("timeout is the notification expiring") | ✅ | quick fix (comment) | none |
| P3 | C2-2: signal-killed child logs `null` (`:819`) | ✅ | quick fix (`err.code ?? err.signal`) | none |
| P3 | N1: raw NUL byte at `:761`, also in the bundle | ✅ (the "grep returns 0" detail ❌) | quick fix (`\u0000`) | none |
| P3 | G#5: split `TRUSTED_NOTION_ORIGINS` from the nav list | ⚠️ optional | quick fix | none |
| P3 | Cosmetics: stale `.so` comment `:63`, unverified "re-fires on reconnect" `:756`, package.json floors, SW `userAgentData`, README CSP row | ✅ / 🔍 | quick fix | none |
| closed | G#1 code part (`f7b7947`), N2 log leak, G#9 reviews dir | ✅ | n/a | n/a |

### Exact change for G#4 (P2, the only item I recommend landing in this PR)

`src/main/index.ts`, `isPermissionRequesterTrusted`:

```ts
const present = candidateUrls.filter((u): u is string => !!u);
if (present.length > 0) return present.some(isTrustedNotionOrigin);   // decide on the requester only
if (!contents || contents.isDestroyed()) return false;
try { return isTrustedNotionOrigin(contents.getURL()); } catch { return false; }
```

This is the audit's cycle-1 snippet, and my harness shows it denies the cross-origin frame while the main frame stays granted. Re-test in the dev build: a calendar notification and a copy button. If either breaks, the opaque-origin or SW case needs a narrower fallback. `every` instead of `some` would be stricter and I see no case it breaks, but I could not test the SW path end to end, so I left `some`.

## Disagreements and Judgment Calls

1. **C2-3 priority (disagree).** See ruling (c). The Grumpy's own ledger places it in the same 🟡 tier as G#4, which gets the severity ordering wrong: one is a demonstrated permission gap, the other is a cosmetic-regression risk.
2. **"Wire into `release.yml`" (disagree).** That workflow is tag-only and pins Node 22. Run the test under Electron's Node and give the repo a `pull_request` trigger, or do not bother.
3. **C2-1 "unverified on a desktop without the profile, so say 'on Plasma'" (agree).** I would add that the reasoning is documented `--wait` semantics plus the +5 s journal timing, and that the 156-line history has no unconfined baseline.
4. **G#2 as 🔴 (disagree on label, agree on handling).** Pre-existing, machine-local, non-data-loss: P1 and a user action.
5. **Big-team tilt.** Three of the Grumpy's five backlog items (C2-3, G#3, the test harness) are the kind of hardening a one-file wrapper can skip without harm. The only item I would block the PR on, if anything, is G#4, and only because it is cheap and contradicts the PR's own README.
6. **Not an issue, noted for the loop.** The cycle-2 count is **P0 0, P1 0 in-repo**. If the loop's stop condition is "no actionable P0/P1 code work", it is met. The one carried P1 needs a human with `sudo`, and no further review cycle will change that.
