# Companion 0.5.0-beta.4.11 — Lens Blur responsiveness follow-up

This unpublished candidate builds on beta.4.10 for Companion 5.0.1. It changes the Companion module only. Keep the existing LRBridge beta.4 guarded-set application and Lightroom plug-in beta4.10 update.

## Install

1. Keep the beta4.10 module package for rollback.
2. Import `ninoleto-lrbridge-0.5.0-beta.4.11.tgz` into Companion and select it for the existing LRBridge connection.
3. Keep your buttons, connection settings, Lightroom plug-in and LRBridge application. No preset replacement is required for this update.

If upgrading from an earlier build, first apply the beta4.10 Lightroom plug-in update described in `archive/BETA4.10-CANDIDATE.md`. The source overlay here remains that same plug-in update.

## Why beta4.10 still felt slower

Beta4.10 separated SDK buttons from Windows automation reads, but it still performed two sequential pre-action reads and waited 250 ms before each feedback check. The Web Controller Bokeh path sends its explicit target using current observed state and starts SDK confirmation immediately, with 80 ms follow-ups.

## Changes

- Reuse recent, available SDK state for Bokeh and Depth Refinement tool buttons when it belongs to the photo/module confirmed by the current context check. Refresh cold, stale or unavailable state before dispatch.
- Send explicit Apply on/off after the context check without waiting for the previous Apply value, matching the Web Controller's supported command path.
- Begin SDK-only feedback checks immediately after command admission and repeat every 80 ms within a 2.5-second confirmation window. An in-flight network request remains subject to the connection timeout. Stop when the requested value is observed, the context changes, the connection stops, or a newer Lens action supersedes the follow-up.
- Preserve actual Lightroom feedback. Pending target values are never displayed as confirmed selection. Do not retry uncertain writes.

Only Lens Blur SDK buttons are changed. Windows refinement controls, numeric slider paths, global polling, Crop Angle, Healing, zoom, fonts and cooldowns retain beta4.10 behavior. There is no new Lightroom plug-in or executable in this update.

## Verification and live check

**Build and all 244 automated tests pass**, including nine additional Lens Blur timing and state regressions. Independent review found no blocker. Production changes are confined to Lens SDK handling in `controller-client.ts`; presets and plug-in bytes are unchanged. Automated results and delivery checksums are included in `CONTRACT-TEST-RESULTS.txt` and `DELIVERY-SHA256.json`.

Test Bokeh shapes repeatedly and compare both the actual change in Lightroom and the Companion highlight with the Web Controller. Also test Apply off/on. A first use after a photo change or an unavailable SDK state can still require a fresh read. This removes deliberate Companion waits; it does not guarantee zero Lightroom processing or network latency. Actual Lightroom responsiveness must be tested on the user's system.

The existing Lens endpoint does not carry an execution-time photo binding or per-operation completion receipt. The module checks context before dispatch and verifies observed SDK state afterwards. An admitted command cannot be recalled.

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

Nothing has been published to GitHub or installed on the user's computers.
