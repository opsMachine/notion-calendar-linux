# Keep reminder popups on screen for 10 minutes

**Issue:** untracked
**Status:** Implemented
**Created:** 2026-11-25

## Problem Statement

On 2026-11-23 both reminders for an appointment popped up (watcher log) and were missed. Popups are posted with `--transient --expire-time=-1`, so they use Plasma's short default and leave no history. They should stay up long enough to be seen, but not forever, because they pile up.

## Acceptance Criteria

| # | Criterion | Test Type |
|---|-----------|-----------|
| 1 | A reminder popup stays on screen for about 10 minutes unless dismissed, then closes by itself | Manual, real Plasma session |
| 2 | Same with the Join / Open Calendar action path (`--wait`) and the minimal fallback | Manual |
| 3 | Open Calendar and Join still work when clicked late (after the old 120 s limit) | Manual |
| 4 | Do Not Disturb behaviour and the `notion-calendar` identity are unchanged | Check flags |
| 5 | No reminder is posted twice because a `notify-send` process timed out or was killed | Check process / log |
| 6 | `npm run prebuild` passes; `tsc` reports no new errors | Automated |

## Notes

- The `execFile` timeout (120 s) must outlast the popup, or killing `notify-send` may close it or drop its actions.
- Revisit the concurrency cap (8) and the README "Notification flood" row, which both assume 120 s.
- Plasma may ignore or reinterpret `--expire-time` together with `--transient` or actions. Establish this by test, not from memory.

## Non-Goals

- Popups that never expire. Changing calendar reminder times. Changing Plasma settings.
