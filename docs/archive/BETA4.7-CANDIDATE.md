# Companion 0.5.0-beta.4.7 — test candidate based on beta.4.6

This is a **Companion module update** for Companion 5.0.1. Keep your existing **LRBridge 0.6.0-beta.4 guarded-set application, 20261010T165731Z**, and the **Lightroom plug-in beta4.6 update** installed for the previous test. The plug-in version remains `0.6.0-beta.4 (Companion beta.4.6 test update)`. No new LRBridge executable, Web Controller or Lightroom plug-in is part of this revision.

## Changes

- **Preset fonts:** new presets use Companion 5 layered graphics with **Text Size 25 and Shrink to fit enabled**. Original action IDs, variable names, permissions and colour rules are retained. Re-add presets to obtain new styles; placed buttons retain their saved appearance.
- **First press:** Healing Open/Close, Quick Copy/Paste Settings and Export now capture the current photo context at invocation instead of comparing against an older polled photo. Copy/Paste and Export wait for a fresh usable selection snapshot before sending their command. A real photo or module change while waiting still cancels the action. Mutations are never automatically retried.
- **Feedback scheduling:** subscribed Controller families can refresh with bounded concurrency instead of waiting behind a single slow family. Per-family read spacing remains limited. Process Version and related categorical actions have bounded targeted follow-up reads when an early state response still contains the old value.
- **Healing display:** pending Healing operations retain usable confirmed numeric feedback only for the same photo, tool, mode and selected repair. Changed targets, stale/unavailable state and errors do not retain values. This addresses the gray/blank flicker caused by intermediate pending reads; slider commands are retained.
- **Point Color ranges:** grouped range overview presets display all four Hue/Saturation/Luminance boundaries using existing LRBridge feedback. Existing individual boundary controls remain. Global and selected-mask scopes are separate. Toggle Visualize Range still has no on/off feedback.
- **Warnings:** prominent red-symbol Windows automation notes identify Lens Blur UI controls and Healing Selected Remove/Cancel. Optional VICREO guidance is provided without making it a dependency. Healing new-brush Size/Feather remain SDK controls; their optional wheel/Shift+wheel workaround is documented separately.
- **Preset setup:** Favorites must first be configured in the LRBridge Web Controller. Amount needs a selected compatible preset; Refresh Inventory alone does not configure Favorites.

The accepted beta.4.6 Color Grading and Healing SDK changes remain intact. Healing selected-repair Opacity/Feather are treated as working, following the corrected mapping test report. Lens Blur Focus Range remains retired in Companion. Delete/Reset All permissions remain unchecked. Standard native Develop slider timing settings remain unchanged.

## Install from the tested beta.4.6 setup

1. Export your Companion configuration and keep the beta.4.6 module for rollback.
2. Import `ninoleto-lrbridge-0.5.0-beta.4.7.tgz` through Companion module/package management, and select it for your LRBridge connection. Keep the existing host, ports and feedback setting.
3. Leave LRBridge and the installed Lightroom plug-in beta4.6 update as they are.
4. Add fresh presets to a test page. Existing buttons receive runtime fixes but retain their saved styles and feedback configuration; re-add them for the new font and preset changes.
5. For Lightroom Develop preset controls, configure Favorites in the Web Controller first.

Rollback: select the preserved Companion beta.4.6 module. Restore the exported Companion configuration if you need the previous button styles. The LRBridge application and Lightroom plug-in do not need a rollback for this module-only revision.

## Focused hands-on checks

1. Inspect a fresh Basic, Tone Curve, Healing and range overview button in Companion: **Text Size 25, Shrink to fit enabled**. Check your physical surface and test negative/zero/positive colours.
2. Change photos, then press Open Healing, Quick Copy Settings or Open Export once. Copy from a test photo, change to a disposable destination and press Quick Paste once. Try again after leaving the controls idle for more than five seconds. Confirm the correct photo receives the action.
3. Change Process Version on a disposable photo and compare Lightroom's change with Companion's highlight. Check external Lightroom changes too.
4. Adjust new-brush Size/Feather and selected-repair Opacity/Feather separately. Check that the confirmed values stop blanking during pending operations. Pointer flicker from Windows observation can still occur; use the documented optional workaround if needed.
5. Select a Point Color swatch, compare all three range overview displays with the Web Controller, and change boundaries in both applications. Repeat with a selected mask for masked Point Color. No selected swatch/mask must show unavailable feedback.
6. Confirm Color Grading still behaves as accepted in beta.4.6. Check that guarded destructive actions remain disabled until explicitly enabled.

## Limits and verification

**171 automated tests passed on Node 22.20.0**, with zero failures. TypeScript compilation passed. Results are in `CONTRACT-TEST-RESULTS.txt`. They exercise module logic, actual extracted bridge handlers/state where relevant, and the existing Lua tests with a mocked Lightroom SDK. They cannot establish real Windows automation reliability, Lightroom latency or hardware behaviour. The candidate still needs your live Companion/Lightroom test.

The user-reported intermittent Healing Selected Remove/Cancel and Lens Blur refinement failures remain documented Windows automation limitations; no broad automation rewrite was attempted. The existing Reflections disabled-state admission limitation remains. Native Lightroom AI errors are not fixed by this module update. No claim is made that every intermittent first-press failure has the same cause.

All **1,028 presets** passed **2,056 render checks** using the actual Companion **5.0.1** renderer and Arimo font at 72×72 pixels, with and without the top bar. The checks use fixture values, not a live Lightroom connection. All 1,815 feedback entries and 2,578 overrides passed the official conversion path; representative negative/zero/positive/unavailable colours were rendered and visually checked. Details are in `PRESET-RENDER-CHECK-beta4.7.json`.

Earlier investigation files and archived results describe earlier versions. This document supersedes their installation and version statements. The inherited ESLint 9 setup has no configuration file; no lint pass is claimed.

## Reproduce

Use Node 22.20+ and the pinned Yarn version:

```sh
corepack yarn install --immutable
python3 scripts/extract-controller-reference.py /path/to/LRBridge-0.6.0-beta.4-guarded-set-20261010T165731Z-win-x64-portable.zip ../lrbridge-beta4-reference
python3 scripts/apply-reference-update.py ../lrbridge-beta4-reference
corepack yarn build
corepack yarn test
corepack yarn exec companion-module-build --prerelease
```

The source retains the unchanged beta4.6 three-file Lightroom overlay for reproducing the tested reference. The update script verifies all original/already-updated hashes before copying. Use `LRBRIDGE_REFERENCE` for a different extracted reference path. This overlay is not a new beta4.7 plug-in release.

Nothing has been installed on your computers or published to GitHub. Integrating the tested plug-in into the full LRBridge beta.4 GitHub package remains a later release step.
