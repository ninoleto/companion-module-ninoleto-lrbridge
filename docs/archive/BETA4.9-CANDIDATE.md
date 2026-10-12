# Companion 0.5.0-beta.4.9 — Develop action cooldown

This unpublished module update is based on beta.4.8. Use **Companion 5.0.1**, the existing **LRBridge 0.6.0-beta.4 guarded-set application (20261010T165731Z)** and the installed **Lightroom plug-in beta4.6 update**.

## What changed

Auto Tone and Auto White Balance retain their shared guard, and Color/B&W treatment buttons now use it too. All four new button presets display amber **WAIT 3s → 2s → 1s**, then restore their normal labels and colors. The countdown restarts after further slider changes. Presses during the wait send no command and are not saved for later execution.

The guard now covers newer native fine/set/reset/nudge paths and expanded slider routes, including Color Grading, Masking, Tone Curve, Point Color and Healing numeric adjustments. It starts when an editing request is dispatched, stays active through existing operation-completion checks, and starts a fresh three-second settling period afterward. Color Grading retains its responsive dispatch behavior; existing feedback determines when its pending edits finish. No slider timing, zoom queue, or feedback polling delay is increased.

No new Lightroom plug-in or LRBridge executable is included. All beta.4.8 zoom protections and beta.4.7 font, feedback, first-press, Point Color overview and setup/automation notes remain.

## Install

1. Keep beta.4.8 and export the current Companion configuration for rollback.
2. Import `ninoleto-lrbridge-0.5.0-beta.4.9.tgz` and select it for the LRBridge connection. Keep your host, ports and timing settings.
3. Keep the current LRBridge application and installed Lightroom plug-in beta4.6 update.
4. **Re-add Auto Tone, Auto White Balance, Color and B&W from Develop actions.** Existing mapped actions get the runtime guard automatically, but Companion preserves their saved button appearance. The four replacement presets provide the countdown. Other beta.4.7/4.8 presets need no replacement.

All generated text remains size 25 with Shrink to fit enabled.

## Test in Lightroom

Adjust Exposure using the normal rotary or Fine steps. Confirm all four buttons turn amber immediately, count down after the adjustment, then return to normal. Press each during the wait: it must not execute, including after the countdown ends. Press it again after the countdown: it should execute once.

Keep turning a knob and confirm the wait stays active. Repeat with Reset, Color Grading and a masked slider. Check that unrelated navigation and read-only feedback do not restart the wait. Recheck Color/B&W, Auto Tone and Auto WB after it expires.

## Timing evidence and limits

Adobe's SDK reference documents a default two-second tracking delay after the last adjustment (`LrDevelopController.setTrackingDelay` and `startTracking`). It does not state that Auto Tone, Auto WB or Color/B&W are guaranteed ready at exactly that point. The module uses the previously accepted three-second safety margin. [Adobe-authored SDK reference mirror](https://lrc.mcor.dev/modules/LrDevelopController.html).

The public module tag v0.4.2, commit `6fa1ddae6599352b24a11963ba6f8bc83b20fbb9`, contained an amber countdown for Auto Tone/Auto WB. Color/B&W are added here based on the user's live Lightroom test.

This is a local safeguard for edits sent through this LRBridge Companion connection, not an SDK readiness probe. Other controllers and direct Lightroom edits do not start its countdown. Legacy `/adjust` and `/reset` responses acknowledge admission rather than completed SDK execution; their countdown is refreshed after the response. An unrelated backlog can therefore outlast the estimate. An uncertain mutation failure retains the settling period; it does not trigger automatic retries.

## Verification

**203 automated tests passed on Node 22.20.0**, including 15 new cooldown integration tests and 3 new preset tests. TypeScript compilation, package manifest and bundled JavaScript syntax checks passed. Full results are in `CONTRACT-TEST-RESULTS.txt`.

The focused Companion 5.0.1 renderer proof covers all four changed buttons in ready, 3s, 2s, 1s and restored states, with and without the top bar: **40 renders, zero fitting failures**. Official preset conversion, variable parsing and feedback priority were verified. All 1,028 preset IDs remain; the other 1,024 preset objects are unchanged from beta.4.8. See `PRESET-RENDER-CHECK-beta4.9.json`. Live Lightroom/Companion/hardware testing remains necessary.

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

The source retains the unchanged beta4.6 Lightroom overlay for reproducing the reference. This revision does not publish a full LRBridge release. Prior candidate notes are retained under `docs/archive`.
