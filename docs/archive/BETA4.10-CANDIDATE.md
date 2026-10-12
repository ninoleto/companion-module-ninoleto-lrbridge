# Companion 0.5.0-beta.4.10 — responsiveness and first-press fixes

This unpublished candidate builds on beta.4.9. Use **Companion 5.0.1** and the existing **LRBridge 0.6.0-beta.4 guarded-set portable application (20261010T165731Z)** with the **Lightroom plug-in beta4.10 update** supplied here.

## Install both updates

1. Keep the beta.4.9 Companion package and export your Companion configuration for rollback.
2. Close Lightroom and LRBridge. Back up `lightroom/LRBridge.lrplugin` inside your current portable LRBridge installation.
3. Extract `LRBridge-Lightroom-Plugin-beta4.10-update.zip` and replace that complete plug-in folder at the **same existing path**. Do not load the plug-in from a separate Downloads folder: it derives bridge paths from its location.
4. Keep the LRBridge executable, `resources/app.asar`, settings and Dust presets. Restart LRBridge and Lightroom. Plug-in Manager should still point to the same plug-in path and show **0.6.0-beta.4 (Companion beta.4.10 test update)**.
5. Import `ninoleto-lrbridge-0.5.0-beta.4.10.tgz` in Companion and select it for the LRBridge connection. Keep host, ports and timing settings.
6. **Re-add Zoom rotary** from Application · Zoom to obtain the press action. Existing Lens Blur, Crop Angle and Healing mappings receive their runtime fixes automatically. Keep the four countdown presets added in beta.4.9; if still using older ones, re-add Auto Tone, Auto White Balance, Color and B&W for their amber countdown appearance.

## What changed

### Lens Blur

Bokeh shapes, Apply on/off and the SDK Depth Refinement tool buttons have their own SDK state, request lane and feedback. They no longer wait for Windows refinement discovery before an SDK button press. Targeted post-action reads follow the actual selected SDK value. Windows refinement controls retain their separate state and automation limitations.

### Crop Angle

The plug-in skips redundant Develop switching and its 200 ms wait when already in Develop. It retains the settling wait when entering Develop and validates the active photo/module before writing.

The module combines pending angle turns into bounded targets while keeping displayed values based on actual SDK feedback. Turn callbacks return promptly so Companion can deliver the next turn. Set and Reset remain explicit barriers; later turns wait until pending Crop commands leave the bridge queue and a fresh SDK read observes the requested value. This preserves command ordering without claiming an operation-specific completion receipt. Angle remains limited to −45° through +45°, with 0.1° rotary steps and at most two decimal places in submitted values. Failed or uncertain writes are not automatically resent.

### Healing Open/Close

Every Open/Close decision now waits for a newer owned SDK tool snapshot, including when the cached tool says it is closed. This fixes the stale Loupe-versus-Crop/Masking case. Older `selectHealingTool` actions and the retained legacy controller button route through the same explicit Open Healing handler. Photo/module changes, pending operations and uncertain results remain guarded.

### Zoom rotary press

Press sends the existing Lightroom zoom toggle once and clears unsent rotary movement. With Navigator's zoomed-out setting on **Fit**, pressing a zoomed image returns it to Fit; pressing again zooms in. With Navigator set to Fill, it returns to Fill. The SDK exposes a toggle, not a dedicated Fit-only command. No keyboard or Windows automation is added.

The accepted beta.4.8 zoom backlog handling remains unchanged. An already submitted step may still complete; unsent steps are canceled. Re-add the rotary preset to get its new press action and label.

## Retained behavior

The beta.4.9 three-second countdown for Auto Tone/Auto White Balance/Color/B&W remains. Text size 25, Shrink to fit, value-sign colors, accepted Color Grading/Healing slider behavior, Point Color range overviews and all setup/automation notes are retained. Preset/action IDs remain compatible.

## Test in Lightroom

- Switch Bokeh shapes and check both Lightroom selection and Companion highlight, including while Windows refinement controls are visible.
- Turn Crop Angle slowly, then quickly in both directions. Check reversal near both limits and Reset between turns. Change photos while work is pending and check that obsolete unsent input is discarded.
- Open Healing on the first press after Crop, Masking, Loupe and a photo change. Test both a newly added preset and an older saved Healing action if present.
- Turn Zoom, press it, then turn again. With Navigator set to Fit, verify the press returns a zoomed image to Fit and does not play back old unsent turns.
- Recheck the beta.4.9 Auto Tone/Auto WB/Color/B&W countdown after slider changes.

## Verification and limits

The TypeScript build and **235 automated tests pass** (32 added since beta.4.9). The new Zoom preset also passes two actual Companion 5.0.1 render checks at text size 25 with Shrink to fit. Test and packaging results are recorded in `CONTRACT-TEST-RESULTS.txt`, `PRESET-RENDER-CHECK-beta4.10-zoom.json` and `DELIVERY-SHA256.json`. This environment cannot run the user's actual Lightroom, Companion surface or Windows UI; the final native responsiveness/first-press check remains a live test.

Crop commands use the existing dedicated LRBridge API. That API does not carry an execution-time photo identity; checks before dispatch and inside the plug-in reduce stale work but cannot recall commands already admitted before a photo change. Unsent old work is canceled. The Lens Blur SDK state endpoint likewise is not a receipt-based mutation API; new code checks available owned state and observes the resulting selection without inventing feedback.

The Adobe-authored [LrApplicationView reference mirror](https://lrc.mcor.dev/modules/LrApplicationView.html) documents the zoom toggle and 100% commands. No unsupported Fit-only API is assumed.

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

The included overlay retains the earlier beta4.6 Remove/Color Grading fixes and adds the Crop change plus updated plug-in metadata. The overlay script accepts only listed baseline, previous-update or current-update hashes and validates every file before writing. Nothing has been published to GitHub or installed on the user's machines.
