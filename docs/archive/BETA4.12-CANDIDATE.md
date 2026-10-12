# Companion 0.5.0-beta.4.12 — Point Color feedback and cooldown timing

This unpublished module-only candidate builds on beta.4.11 for Companion 5.0.1. Keep the existing LRBridge beta.4 guarded-set application and Lightroom plug-in beta4.10.

## Install

Import `ninoleto-lrbridge-0.5.0-beta.4.12.tgz` into Companion and select it for the existing LRBridge connection. Keep your buttons and settings. No preset replacement or Lightroom plug-in update is required for this revision. Keep beta4.11 for rollback.

## Cooldown

The Web Controller's Auto action interval is 2200 ms, although rounding up makes the button initially show 3 seconds. Companion previously used a full 3000 ms.

Companion now uses **2200 ms** for Auto Tone, Auto White Balance, Color and B&W. During the settling period, the rounded display changes from 3 to 2 after 200 ms; the display updates every 250 ms, then counts down normally. An in-flight slider operation still keeps the guard active. Completion or an uncertain result starts the settling period, so total blocked time can exceed 2.2 seconds. This preserves the guard against acting before a pending adjustment finishes; it is not an SDK readiness signal.

## Point Color

Background Point Color reads previously shared two polling slots with every other expanded control family. Slow reads could delay Point Color values changed in Lightroom or the Web Controller. The reported issue is observing a swatch change made directly in Lightroom; Companion-triggered swatch changes were already responsive.

- Global and masked Point Color share one separate bounded polling slot, with a 450 ms minimum interval per family. The existing 250 ms scheduler means normal refresh opportunities occur around 500 ms. This slot is independent of the two general slots.
- All Companion Point Color action paths are unchanged: swatch selection, scalar/boundary edits and whole-range translation. Only background observation scheduling changes.
- Actual SDK values remain authoritative. The Web Controller can display a local intended value while an edit is still pending; Companion does not report that target as confirmed feedback.

The Lens Blur beta4.11 fix, Crop Angle, Healing, Zoom, fonts and preset definitions are retained. No Lightroom plug-in bytes or LRBridge application files change.

## Verification and live check

**Build and all 249 automated tests pass**, including four new Point Color polling tests and one exact cooldown transition test. Independent review found no blocker. Automated results and delivery checksums are included in `CONTRACT-TEST-RESULTS.txt` and `DELIVERY-SHA256.json`.

Select different Point Color swatches directly in Lightroom and check how quickly Companion follows, including with Lens Blur controls present. Confirm that Companion-triggered swatch changes remain responsive. After a finished slider edit, verify that the displayed 3 drops to 2 promptly and Auto Tone / Auto WB / Color / B&W work when the countdown ends. Pending work can still extend the initial wait. Actual Lightroom responsiveness must be tested on the user's system.

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

The source overlay remains the tested beta4.10 Lightroom plug-in update. Nothing has been published to GitHub or installed on the user's computers.
