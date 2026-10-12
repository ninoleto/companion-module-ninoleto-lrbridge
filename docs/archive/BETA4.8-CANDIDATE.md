# Companion 0.5.0-beta.4.8 — zoom queue fix

This unpublished module update is based on beta.4.7. Keep **Companion 5.0.1**, the existing **LRBridge 0.6.0-beta.4 guarded-set application (20261010T165731Z)**, and the installed **Lightroom plug-in beta4.6 update**.

## What changed

Zoom In/Out previously sent every knob detent into LRBridge's FIFO. HTTP acceptance was fast, but Lightroom consumed commands more slowly. Excess turns at a zoom limit therefore delayed an opposite turn.

Zoom now has a separate bounded input handler:

- Keeps only the latest unsent direction; reversing replaces pending movement instead of accumulating a step count.
- Waits for the actual LRBridge queue to be empty before submitting another zoom command. At most one of this handler's commands is queued, with at most one earlier command executing in the serial Lightroom worker.
- Returns from the Companion action callback promptly so later knob events, including reversal, can reach the handler.
- Polls only while input is pending, at 80 ms intervals when the queue is busy. Unsent input expires one second after the most recent turn.
- Drops unsent movement on disconnect and when pressing Fit/Fill or Zoom 100%. Malformed queue state or network errors stop the pending gesture; uncertain commands are not retried.

The existing API exposes no numeric zoom value or min/max feedback. Lightroom continues to enforce its own zoom limits; this update prevents the command backlog. An already submitted command cannot be recalled, and unrelated Lightroom work may still delay execution. Fast spins are intentionally coalesced rather than preserving every physical detent.

All beta.4.7 fonts, feedback changes, Point Color range overviews and setup/automation notes remain. Preset definitions are unchanged. See `archive/BETA4.7-CANDIDATE.md` for that revision's details.

## Install

1. Keep beta.4.7 and export the current Companion configuration for rollback.
2. Import `ninoleto-lrbridge-0.5.0-beta.4.8.tgz` and select it for the LRBridge connection. Keep your host, ports and timing settings.
3. Keep your existing LRBridge application and Lightroom plug-in. No new plug-in installation is required.
4. Existing Zoom rotary and Zoom In/Out button mappings automatically use the fix. If your presets are already from beta.4.7, there is no need to re-add them. Users upgrading from older presets still need to re-add them for the beta.4.7 font changes.

## Test

Turn to maximum zoom, keep turning, then turn one step back. Repeat at minimum zoom. Check that reversal follows promptly instead of waiting through the excess turns. Also check slow single detents and Fit/Fill/100% buttons. Test after starting this version with no leftover zoom backlog from the previous version.

The module cannot remove commands already submitted by an older module instance or another controller. Existing LRBridge commands must finish normally; this fix prevents new accumulation from these Companion Zoom In/Out actions.

## Verification

**185 automated tests passed on Node 22.20.0**, including 14 focused zoom tests. TypeScript compilation passed. The full results are in `CONTRACT-TEST-RESULTS.txt`. Focused tests use the actual beta.4 server command queue and actual Companion action callbacks, with a simulated Lightroom consumer and zoom end stops. HTTP enqueue acknowledgement is deliberately separate from simulated SDK execution. They cover both limits, rapid reversal, slow transport, stalled consumption, input expiry, stop/reset, and failures without replay.

The preset renderer evidence in `PRESET-RENDER-CHECK-beta4.7.json` remains applicable because preset generation, labels, graphics, feedback and dependency versions are unchanged. It records 2,056 actual Companion 5.0.1 render checks across 1,028 presets. Live Lightroom/Companion/hardware testing remains necessary.

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

The source retains the unchanged beta4.6 Lightroom overlay for reproducing the reference. This revision does not change that plug-in or publish a full LRBridge release.
