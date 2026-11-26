# Bug: Week starts on Monday although the saved setting is Sunday

**Issue:** untracked
**Status:** Implemented
**Created:** 2026-11-25

## Problem Statement

**Actual:** The desktop app's week grid starts on Monday. Choosing Sunday in Settings does nothing.

**Expected:** The grid starts on the day implied by the system date locale (`en_CA` → Sunday).

**Root cause:** Notion's web bundle computes the grid start date at load, before the saved `weekStartDay` has been read. It falls back to
`new Intl.Locale(new Intl.DateTimeFormat().resolvedOptions().locale).getWeekInfo().firstDay` (or `.weekInfo`).
The app runs as `en-GB` (`LANG`/`LANGUAGE`), so the fallback is Monday and the grid is never re-aligned. The system date locale (`LC_TIME=en_CA.UTF-8`) is ignored.

## Approach

In the wrapper, make the *default* locale report the first weekday of the system date locale.

- Date locale precedence (POSIX): `LC_ALL`, then `LC_TIME`, then `LANG`. Empty values are skipped.
- If it is unset, `C`, `POSIX`, or cannot be parsed, change nothing.
- Override only `firstDay`, for both `getWeekInfo()` and `weekInfo` (whichever exist), and only for `Intl.Locale` instances matching the app's default locale. Explicitly requested other locales keep their own value.
- The override must be in the page's main world before Notion's scripts run, on every load and reload.

## Acceptance Criteria

| # | Criterion | Test Type |
|---|-----------|-----------|
| 1 | `LANGUAGE=en_GB`, `LC_TIME=en_CA.UTF-8`, saved `sunday`: first column is Sunday | Manual, real app, profile copy |
| 2 | Same, with `LC_TIME=en_GB.UTF-8`: first column is Monday (control, one variable changed) | Manual |
| 3 | Navigator language, date formatting and time zone label are the same as before the change | Manual |
| 4 | An explicit other locale (e.g. `new Intl.Locale("fr-FR")`) keeps its own `firstDay` | Runtime check |
| 5 | Criterion 1 still holds after a page reload | Manual |
| 6 | `npx tsc --noEmit -p tsconfig.node.json` and `npm run prebuild` pass | Automated |

## Non-Goals

- Fixing Notion's load-order bug: a saved choice that differs from the system date locale is still affected.
- Changing the app language, the `.desktop` file or autostart entries.
- Writing any Notion user setting.

## Security Considerations

Nothing from the environment is interpolated into script text. The weekday ICU returns for the date locale is passed to the page through `contextBridge.executeInMainWorld` `args`.

## Verification Notes (2026-11-25)

- Criteria 1–5 passed in the real app (dev build, copy of the logged-in profile).
- Criterion 6 is partial: `npm run prebuild` passes; `tsc` reports one error in `src/main/config.ts` that also occurs on the unchanged HEAD.
- The packaged build (`linux-unpacked`) with a profile copy and `LC_TIME=en_CA.UTF-8` also opened on Sunday.
- Not checked: the installed `.deb`, launch from the `.desktop` entry or autostart (the Plasma session does export `LC_TIME=en_CA.UTF-8`), views other than the week grid.
- Packaging from a checkout that holds old `dist-*` folders bundles them into the app (780 MB package). `electron-builder.yaml` does not exclude them; this build used an extra exclude.
- Only `firstDay` changes, so `minimalDays` still follows the app language.
