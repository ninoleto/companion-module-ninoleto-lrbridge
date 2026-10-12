# Companion 0.5.0-beta.4.6 — test candidate based on beta.4.5

This is an unpublished candidate built directly from the preserved beta.4.5 source. Use it with the existing **LRBridge 0.6.0-beta.4 guarded-set application, 20261010T165731Z**, plus the supplied **Lightroom plug-in beta4.6 update**. The application executable, server and Web Controller are unchanged. Real Companion/Lightroom testing remains required.

## Changes

- **First press after changing photos:** Reflections, People and Red Eye actions fetch the current photo context at invocation instead of capturing an older cached photo. A photo change after a command is queued still cancels the command.
- **Special-control completion:** these controls check the exact returned operation receipt, server epoch and photo/revision ownership. An already matching display value cannot confirm a different operation. Old in-flight reads cannot complete newer work. Failed or uncertain editing commands are not automatically resent.
- **People:** valid requested-only Open/Detect results are reported honestly. Removal requires a fresh, compatible tool state. Requested means dispatched, not that Lightroom has finished its work.
- **Reflections:** numeric edits now track their exact receipt. Long operations may remain pending for up to 125 seconds, matching the native processing window more closely. This does not shorten Lightroom processing.
- **Healing plug-in:** existing numeric comparison tolerance is also used for pre-write baseline checks. Internal preference/readback checks avoid repeated full Repair/Dust inventory reads; completion still includes the public snapshot and rechecks current preferences after potentially yielding SDK reads. Failure details identify requested/expected/observed values. New-brush preferences and selected-repair fields remain separate.
- **Color Grading plug-in:** an already-ready Develop module skips the redundant module switch and 200 ms wait. A real transition still waits, and photo/module ownership is rechecked around SDK work and between wheel axes.
- **Presets:** only minus turns orange for a negative value; only plus turns blue for a positive value. Rotary feedback still follows either sign. Crowded labels use shorter display names, whole-word line breaks and supported bounded sizes; concise labels retain automatic fitting. Reset and unavailable states remain distinct.
- **Focus Range:** the four numeric range controls and Shift Focus Range action are retired in Companion. Saved range actions return a clear explanation without sending a command. Use the existing Web Controller for Focus Range.
- **Help and guards:** Delete/Reset All setup is prominent, destructive permission stays unchecked, and SDK versus Windows-automation controls are documented accurately.

Standard Develop slider paths/timings, ports, existing settings and the Web Controller are retained. The previous beta.4.5 runtime corrections remain. No speculative logging change was made.

## Install

1. Export your Companion configuration. Keep the beta.4.5 module package and current LRBridge portable folder available for rollback.
2. On the Windows Lightroom/LRBridge computer, close Lightroom and LRBridge. Back up the existing `lightroom/LRBridge.lrplugin` folder from your **20261010T165731Z guarded-set** portable installation.
3. Extract `LRBridge-Lightroom-Plugin-beta4.6-update.zip`. Replace the portable installation's `lightroom/LRBridge.lrplugin` with the complete folder from the ZIP at the **same path**. Do not move the plug-in to an arbitrary download folder: it derives its bridge paths from this location. Keep the executable, `resources/app.asar`, configuration and Dust presets.
4. Restart LRBridge and Lightroom. In Lightroom Plug-in Manager, keep the plug-in pointing to that same `lightroom/LRBridge.lrplugin` folder. The new plug-in version reads `0.6.0-beta.4 (Companion beta.4.6 test update)`.
5. Import `ninoleto-lrbridge-0.5.0-beta.4.6.tgz` through Companion's module/package management and select it for your LRBridge connection. Keep the current host/ports and feedback setting. When Companion runs on Zorin, use the Windows PC's LAN address.
6. Re-add the updated presets to see the new colours, labels and layout; already placed buttons retain their saved styles/options. Keep the old page while testing.

Only three plug-in source files differ: `Info.lua`, `Remove.lua` and `ColorGrading.lua`. The ZIP includes the full plug-in folder to avoid an incomplete replacement.

Rollback: close Lightroom/LRBridge, restore your backed-up plug-in folder at the same path, restart both apps, and select the preserved beta.4.5 module in Companion. Restore the exported Companion configuration if you need the previous placed buttons/styles.

## Focused hands-on checks

Use disposable copies where a reset/removal is involved.

1. Add fresh Tone Curve/Basic presets. Inspect text at your normal button size and minus/plus/rotary colours below, at and above zero.
2. In Heal and Clone, test new-brush Size and Feather, including fractional starting values. Separately select an existing compatible repair and test its Feather/Opacity. Test Visualize Spots threshold and one quick Close/Open sequence. Record any rejection's complete detail.
3. In Color Grading, compare repeated turns while already in Develop with the first turn after returning from Library. Check multiple regions and Reset; confirmed values should follow Lightroom.
4. Change photos, then press Red Eye/Pet Eye once. Try People Open/Detect and eligible Remove, allowing Lightroom to finish. Do not interpret a requested-only result as completed detection/removal.
5. On a supported photo, test Reflections Amount, Quality and On/Off, allowing long operations to finish. Record the exact error and whether native Lightroom/Web Controller controls work if On/Off is rejected.
6. Confirm saved Companion Focus Range controls now explain that they are retired. Use the Web Controller for that control.

For guarded actions, enable **Allow destructive action** only when you intend to perform the named action. Importing a preset does not enable it.

## Known limits

- The existing server gate that rejects some Reflections edits while `enabled=false` is unchanged. Native evidence is still needed to distinguish an unavailable effect from a valid re-enable case. This candidate does not claim that every Reflections On/Off issue is fixed.
- Healing precision/read-cost defects are addressed, but the original Feather report is not fully explained by logs alone. Real SDK/UI testing is required to confirm it works on your photos and repair selection.
- Long-operation allowances and skipping a redundant wait do not establish real latency. Standard feedback schedules remain unchanged.
- Fixed-label measurements use a compatible surrogate font, not a running Companion renderer. Check the actual hardware/button layout.
- The test suite executes real plug-in Lua through Fengari with mocked Lightroom SDK calls, and actual extracted bridge handlers/state where applicable. It cannot verify Lightroom UI/SDK behaviour, Windows automation, hardware or a live Companion import.
- The inherited ESLint 9 setup lacks a configuration file; no lint pass is claimed.

## Verification and contents

The final results are recorded in `CONTRACT-TEST-RESULTS.txt`. Coverage includes earlier beta.4.5 regressions plus real-Lua Healing/Color Grading checks, first-press context, exact special-control receipts, stale reads, long-running Reflections, requested-only outcomes and Focus Range retirement.

The catalog now has **194 numeric controls, 290 button entries, 1,022 presets and 49 sections**. Two legacy Healing Selected Add/Subtract IDs are retained but hidden from new choices. Complete coverage is in `CONTROL-COVERAGE.csv`; hardware shortcut/automation guidance is in `companion/HELP.md`.

Archived beta.4.5 documentation is under `docs/archive/`; other version-labelled investigation files are historical evidence. The current instructions in this file supersede their installation/version statements.

## Reproduce

Use Node 22.20+ and the pinned Yarn 4 version:

```sh
corepack yarn install --immutable
python3 scripts/extract-controller-reference.py /path/to/LRBridge-0.6.0-beta.4-guarded-set-20261010T165731Z-win-x64-portable.zip ../lrbridge-beta4-reference
python3 scripts/apply-reference-update.py ../lrbridge-beta4-reference
corepack yarn build
corepack yarn test
corepack yarn exec companion-module-build --prerelease
```

The update script verifies every original or already-updated file hash before copying any file. `reference-update/manifest.json` records the three updated sources. Set `LRBRIDGE_REFERENCE` if the extracted reference is elsewhere.

Preserved beta.4.5 source ZIP SHA-256: `e2b1ea49d397cf50d05edb6282fb0eb3bfb83cf890e5e5028461a9fe68704872`.

Preserved LRBridge app.asar SHA-256: `916b1905e4553561c1386a7b3f6a35bf1b21a99eeb1bf48a8bc3365b69db12d1`.

No upload to GitHub, publication, installation or change to your live setup was performed.
