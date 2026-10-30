# Review loop index — pr1-hardening — 2026-10-30

Scope: `hardening/pr1-vetted` vs `main` (vetted PR #1 hardening, commit e7bb4d2), lockfile excluded.
Mode: interactive, max 5 cycles. Exit after cycle 2: zero in-repo P0/P1.

| Cycle | Grumpy review | Audit | P0 | P1 | Fixes applied |
|---|---|---|---|---|---|
| 1 | grumpy-review-pr1-hardening-2026-10-30.md | review-audit-pr1-hardening-cycle1-2026-10-30.md | 0 | 2 | f7b7947: no re-post on `--wait` timeout / refused kill (A1); log `err.code` not `err.message` (N2, P2 opt-in) |
| 2 | grumpy-review-pr1-hardening-cycle2-2026-10-30.md | review-audit-pr1-hardening-cycle2-2026-10-30.md | 0 | 0 in-repo (1 carried, user action) | Corrected timeout comment (C2-1, P3) |

Carried, not fixable in repo: AppArmor `/etc/apparmor.d/notify-send` denies `NotificationClosed`, `ActionInvoked` and the
timeout SIGTERM, so Join / Open Calendar never work and `--wait` children orphan. Needs a local override (user, root).

## Open: AppArmor local override (user action)

Copied from the cycle 1 audit (A1/A2):

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

## Cycle 1 action matrix

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

## Cycle 2 action matrix

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

Cut 2026-10-30 in e73322c: per-cycle grumpy reviews and audits (cycles 1-2). Restore: git checkout e73322c^ -- Documents/reviews
