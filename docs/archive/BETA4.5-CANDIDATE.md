# Companion module 0.5.0-beta.4.5 — beta.4 Controller candidate

This expands the public working v0.4.2 Companion module with the Lightroom actions exposed by the supplied LRBridge beta.4 Web Controller. It is an **unpublished test candidate**, not a live-verified release. LRBridge itself was not changed.

## Changes in 0.5.0-beta.4.5

- **Standard-slider feedback:** confirmed Nudge and Reset results now update the shared values used by existing native-slider variables and feedback. They no longer wait for the older background read merely to display a value that Lightroom has already confirmed. In-flight background reads are checked against the current read/confirmation identity and context generation so they cannot overwrite a newer result or a changed photo's state. No guessed requested values are presented as confirmed.
- **Healing completion:** Size, Feather, selected-repair Opacity/Feather, Generative AI, Detect Objects and panel actions use the result for their exact operation. A matching display value alone does not complete an operation. Terminal failures are reported promptly and already-waiting Healing edits are cancelled; missing completion is not silently treated as success or automatically retried. Mode/field availability and photo/tool/repair ownership are checked. Selected-repair feedback retains SDK precision and uses the resulting selection token after a confirmed edit.
- **Rapid Healing Close/Open:** panel actions wait for their matching completion in order. This addresses the module-side pending-state problem without adding a fixed delay. Native interaction still needs checking.
- **Crop Angle:** a recent confirmed value can be reused after validating the current photo/context and Develop revision, avoiding one redundant pre-read per nearby turn. Expired, unavailable or changed-context state is refreshed. Targets use the dedicated API's two-decimal precision. Post-write confirmation and Reset ordering remain intact; the native 200 ms delay is unchanged.
- **Red Eye / Pet Eye:** Open Red Eye now sends the supported `red_eye` operation instead of the rejected `open` value. Pet Eye has a dedicated action/preset. Existing Red Eye action IDs are preserved.
- **Healing Selected Add/Subtract:** these Windows-automation buttons are removed from new presets and action choices. Existing configured IDs remain callable for compatibility. Masking Add/Subtract are unaffected.
- **Preset organization:** Develop actions contains only Reset All, Auto Tone, Color, B&W and Auto White Balance. Other tool actions sit with Crop, Transform, Healing, Masking or Red Eye. Mask creation, adding a component and subtracting a component have separate sections. Application groups match the Web Controller, including clearly grouped secondary-display controls and a new **Zoom rotary**.
- **Preset appearance:** inactive ordinary buttons use `#24364a`, confirmed active/positive values use `#174f7a`, negative rotary/−/+ values use orange `#9a4f16`, Delete uses `#8b1e2d`, Off uses `#651f23`, and On uses teal/green. Existing `#202428` base colours remain, zero restores the base, unavailable numeric values are gray and Reset stays amber. Existing **Rotary → − → Reset → +** order and buttons-last layout remain.
- **Reset All setup:** the preset tooltip and action headline explain its explicit permission checkbox. It is not silently enabled by importing the module. The button label remains Reset All.

**Text size limitation:** base 2.0.4's simple-preset schema cannot represent both fixed size 25 and Shrink to fit. Companion's legacy-style conversion maps `auto` to shrinking and numeric sizes to fixed text. This candidate keeps supported automatic fitting rather than adding an ignored property or migrating the module API. Users can set 25 and Shrink to fit manually in Companion's editor. See the installed `@companion-module/base` preset/style types and Bitfocus Companion's `ParseLegacyStyle` implementation in `companion/lib/Resources/ConvertLegacyStyleToElements.ts` (inspected commit `44deb753798804760a5b13b7d546bf948d12e3d2`).

**Deferred:** Preset Amount's confirmation timing is unchanged. Lightroom/Windows execution time and the existing Crop delay remain. No claim of instant response is made. The working Color Grading, Denoise, Masking and Point Color paths are preserved; LRBridge itself is unchanged.

**User results retained from 4.4:** regular Masking works. Masked Point Color works after selecting a mask in Lightroom; no further fix was needed for that report. Fine Contrast, normal Open Healing and the previously reported working controls remain accepted within the user's testing scope. Denoise Amount and regular Masking feedback were reported responsive. Not every control has been manually tested. All new 4.5 runtime corrections still need native testing; ordinary command-only buttons do not gain invented active-state feedback.

## Retained from 0.5.0-beta.4.4

One unified preset browser, rotary/−/supported Reset/+ order, switches/buttons last, readable Remove/Heal/Clone labels, and opening Healing from another tool using an owned snapshot. Older placed buttons and action IDs remain supported.

## Retained from 0.5.0-beta.4.3

The Masking gesture-ID correction remains in place: `mg-…` for ordinary corrections, `curve_…` for masked Point Curve, and `refine_…` for masked Refine Saturation. Wrong-photo and wrong-mask requests remain rejected, and uncertain writes are not retried.

## Retained from 0.5.0-beta.4.2

- **Fine ± buttons and rotary presets:** match the Web Controller's step sizes: Exposure ±0.1; Contrast, Highlights, Shadows, and most other numeric sliders ±1. The old Adobe SDK steps remain available and unchanged.
- **Color Grading:** subsequent turns no longer wait for a complete feedback cycle after every edit. Pending Hue and Saturation targets stay together while Lightroom's feedback catches up. Actual feedback remains separate from pending targets; an unconfirmed command is not shown as confirmed.
- **Numeric Nudge compatibility:** validate the server epoch on the actual beta.4 receipt envelope. The earlier candidate incorrectly expected it inside the Nudge result as well.

**Existing placed buttons do not automatically change their saved action options.** For smaller steps, select **Web Controller · Slider / numeric control → Fine steps (Web Controller ±)**, with step count **1** or **-1**. For a rotary, set that operation for both rotation directions. Alternatively, add the updated presets from **Basic** or the relevant group. The original **Adjust Lightroom slider** action still uses Adobe's larger increments.

The earlier log showed repeated identical Hue requests; it did not contain plug-in execution results. An offline delayed-feedback reproduction demonstrated the module dispatch stall addressed in 4.2. Subsequent user testing reported working Color Grading. That acceptance is preserved within its scope, without claiming every possible cause of an unmoving slider is resolved.

## Install and try it

1. Keep your current module package and export your Companion configuration so you can switch back.
2. Import `ninoleto-lrbridge-0.5.0-beta.4.5.tgz` using Companion's module/package management. Select this version for the LRBridge connection. Keep the existing connection and its host/port settings.
3. Keep the supplied **LRBridge beta.4 guarded-set build, 20261010T165731Z**, and its matching plug-in running on Windows. Companion can run on Zorin; it connects to the Windows PC's LAN address. Commands use port 17891; the existing feedback path uses 17892.
4. **Existing placed buttons keep their saved styles, feedback rules and action options.** Runtime fixes apply to their retained action IDs, but new layout/colour rules do not restyle them automatically. Re-add updated presets to adopt the new appearance, or edit existing buttons manually. Keep the old page available during testing.
5. To try **Reset All**, edit that button's press action and enable **Allow destructive action**. The same explicit setup applies to delete/reset presets marked as requiring permission. Leaving it unchecked sends no editing command and reports the reason in Companion.

No new Lightroom plug-in or LRBridge build is included or required beyond that matching beta.4 package. Do not replace LRBridge with an older public beta for this candidate.

### Focused hands-on checklist

- **Exposure / Contrast:** turn the new Fine-step rotary both ways and watch the value on its button. Check Reset and then change photos; old values must not briefly replace new confirmations. Compare with the previously responsive Denoise/Masking controls without treating them as a new broad acceptance test.
- **Healing:** select Heal and try Size and Feather, then select a compatible existing repair for Opacity and Feather. Select Remove for Generative AI/Detect Objects. Try an ordinary Open/Close sequence and a quick Close/Open sequence. Unsupported fields should report why they are unavailable rather than appearing to accept an edit.
- **Red Eye / Pet Eye:** open each mode, then close it. Check Reset only when you intend to clear the photo's eye corrections and have enabled its permission.
- **Crop Angle:** make a few nearby adjustments, pause, adjust directly in Lightroom, then try another turn. Confirm the next change starts from Lightroom's current value. The retained native delay may still be noticeable.
- **Presets:** check the new tool/mask/Application groups, Zoom rotary and secondary-display actions. Check rotary/−/+ colours below, at and above zero; Off should remain dark red when active. Re-add presets for this appearance check.
- **Reset All:** on a disposable test photo, enable its permission and verify one press resets the photo. Existing accepted controls do not need a full repeat solely for these changes.

## Controls

The candidate contains 198 numeric entries and 290 registered fixed button IDs, of which 288 are offered for new actions. The two retained legacy IDs are Healing Selected Add/Subtract. Configurable profile/preset, curve editing, crop, range-shift and favorite-management actions remain. There are 1,034 presets in 50 sections, including Zoom rotary; duplicate generic tool-open templates are omitted while their action IDs remain available. `CONTROL-COVERAGE.csv` lists every catalog entry.

| Web Controller area                                                           | Companion controls                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Develop, Basic, HDR/SDR, Color Mixer, B&W Mixer, Detail, Effects, Calibration | All 110 feedback-supported slider definitions; Set, Adjust and Reset where supported; explicit On/Off presets for switches                                                                                                   |
| Color Grading                                                                 | Hue/Saturation pairs, region luminance, Blending, Balance, region Reset, views                                                                                                                                               |
| Point Color, including Masking Point Color                                    | Five scalar controls, each range boundary, whole-range shift, swatches 1–8, picker and Visualize Range                                                                                                                       |
| Curves                                                                        | Native RGB/red/green/blue point add/move/delete, channel Reset, curve presets, Refine Saturation; separate global and selected-mask actions. Parametric/split sliders are in the Develop catalog                             |
| Masking                                                                       | 19 ordinary corrections plus Refine Saturation, create/add/subtract types, mask/component navigation, visibility, invert, delete, selected reset, local presets; global Grain Size/Roughness with masking-panel preservation |
| Crop, Transform, lens corrections, Profiles                                   | Crop angle/aspects/custom aspect, tool open/close, Upright modes, Constrain Crop, lens switches/sliders, supported profile choices and amount                                                                                |
| Lens Blur, Enhance                                                            | Apply, Bokeh, Visualize Depth, Focus Range, refinement actions/brush values, Auto Mask, Denoise/Amount, Raw Details and Super Resolution                                                                                     |
| Healing/Dust, Reflections, People, Red Eye/Pet Eye                            | Exposed tool actions and numeric controls, including Dust On/Off; Healing Selected Add/Subtract omitted from new choices                                                                                                     |
| Selection, Photo, Application, History                                        | Navigation, flags, stars, labels, rotate, treatment, selection operations, views/modules, display actions, Undo/Redo                                                                                                         |
| Presets, Copy/Paste, Export                                                   | Apply configured favorites, previous/next, Amount, inventory refresh, add/update/remove favorites, guarded Copy/Paste and Export, explicit review acknowledgement                                                            |

Browser-only navigation, jump menus, collapse/layout editing, search, help links and diagnostic-recording buttons are not Lightroom commands and are not duplicated as hardware actions. A graph is represented by curve-edit actions; it is not rendered as an interactive graph on a Companion button. Native tasks such as drawing a mask still require Lightroom, exactly as in the Web Controller. Unsupported Lightroom controls have not been invented.

Use exact unique names or UUIDs for profile/preset actions. Develop presets must first be in Favorites. You can manage Favorites in the Web Controller or with the new Favorite action; existing favorites are preserved. Duplicate names are rejected rather than selecting an arbitrary item. Point Color swatch buttons only select existing samples; they do not create samples.

## Input and feedback behavior

- Legacy SDK slider adjustments still call the original module's direct `/adjust` path. They do not wait for advanced-control state reads, queues or completion polling. The original ±1/±5 actions retain Adobe's SDK step units.
- Fine steps use beta.4's existing Numeric Nudge contract for standard sliders. It reads the actual baseline in Lightroom's serial worker, applies the requested numeric delta, and returns owned SDK feedback. Step sizes come from the Web Controller's `rangeStep`; the server retains its finer `numericStep` rounding for values between those steps. No client-side guessed baseline or LRBridge change is needed.
- Fine batches retain ordered step counts, including direction reversals at minimum/maximum. Reset/Set separate batches. A failed operation or changed photo cancels waiting fine edits. Additional specialized controls use their own displayed units.
- The new native Reset actions use the correlated Reset receipt and the actual value read after that Reset. A following native turn on the same slider waits only until Reset is admitted, so its native relative command is ordered after Reset. Other native sliders remain independent.
- Color Grading retains local pending targets and serializes HTTP admissions, while SDK feedback runs independently. It checks the photo before writing, refreshes the baseline when the Develop revision changes outside a pending edit, and cancels queued edits after an uncertain write. Reset still waits for matching feedback before a following turn. No automatic command retries or changes to the Windows/Lua worker were added.
- Healing uses one serial family queue with operation-correlated completion, preserved tool/repair intent, explicit failure handling and no automatic retry. Crop retains its queue and post-write barrier while avoiding a redundant fresh pre-read when safe. Other specialized controls keep their existing coordination. Separate sections do not share a global command queue in the module. Switching photos or masks can reject a waiting edit instead of applying it to a different selection.
- Background feedback is limited to configured/used families. Extra native feedback is requested only for subscribed controls missing from the original module's feedback list. Unavailable values stay blank/gray. Command-only actions have no invented selected-state feedback.
- A command being accepted is not reported as complete. Export reports that Lightroom accepted the export request; this does not mean files have finished exporting. Uncertain actions are never automatically replayed.
- Absolute Set continues using the compatible public GET `/set` API. This candidate does not replace that path with beta.4's optional guarded Set protocol, which only supports a subset of sliders.

The original background/context feedback timings are retained. New confirmed standard-slider receipts update the shared display immediately and block stale background overwrites; external changes still depend on the existing refresh schedule. Native Lightroom/Windows helper delays still apply. Installed actions across many sections can make external-change feedback less frequent; this needs hardware testing. Exact live latency is **not** established by the automated tests.

## Verification performed

- New Healing checks use the actual beta.4 Remove routes/state/command validators with SDK execution simulated. They cover exact completion identity, immediate terminal failure, queued-edit cancellation, no early completion from a matching value, SDK precision and repair-token transitions, selection/mode changes, Generative AI/Detect Objects, wrong-photo results, missing receipts, rapid Close/Open and explicitly requested-only repair refreshes.
- Seven focused Crop checks cover recent confirmed baseline reuse, expiry/unavailability, external Develop changes, photo/context/Develop ownership, no guessed baseline, two-decimal request precision and Reset confirmation ordering. SDK feedback is simulated.
- Nine preset tests cover Develop/Application/mask grouping, Zoom rotary, retained-but-hidden Healing IDs, Red Eye/Pet Eye operation names, value/availability colours, semantic button colours, Reset All setup and the documented text-size compatibility limit. Existing complete preset-order checks remain.
- All **91 automated tests passed**. Eight native shared-feedback checks cover immediate display of actual SDK completion, delayed older reads, reused lower request IDs with exact owned snapshots, unavailable values, wrong-photo state, stale context responses, server epoch/connection replacement and existing slider variables. These are contract/integration fixtures, not a live Lightroom pass. See `CONTRACT-TEST-RESULTS.txt`.

- The old 4.3 compiled client reproduces the Open Healing timeout before any editing command is sent. The new client passes actual beta.4 Remove-route/state/command admission with SDK execution simulated, including closed tools, unavailable preferences, idempotent Open/Close, pending work, rejected photo changes, and all three mode selections.
- Generated preset checks verify complete catalog coverage, one visible template per ID, slider quartet order, switches/buttons last, and related categorical choices in their corresponding groups. These inspect the data sent to Companion; they are not a native Companion UI test.

- TypeScript build and Companion package validation.
- Focused contract tests use the exact beta.4 command validator, selected real HTTP handlers and the real Reset receipt state machine. They cover native dispatch isolation, Reset identity/order, Exposure/Contrast/Vibrance/Temperature/Profile Amount, missing/wrong ownership, Point Color scaling and swatch binding, Masking gesture binding, inset Blue-curve endpoints, guarded-action failure behavior, and preset/action references.
- Rapid queued encoder inputs are coalesced without blocking unrelated native adjustments.
- Export's `requested` outcome is distinguished from Copy/Paste's `success`; Windows brush and Masking resets consume returned/confirmed values.
- New focused checks reproduce delayed Color Grading feedback, alternating wheel axes, all regions/scalars, external edits, photo changes, uncertain writes and Reset ordering. Fine-step checks use the actual beta.4 Numeric Nudge receipt implementation, including its real epoch placement and ordered reversals at bounds. These fixtures simulate SDK responses; they are not native Lightroom tests.
- Masking regression: the previous built module is rejected with `409: Invalid Masking correction gesture`; masked curves and Refine Saturation also fail admission. The corrected module passes six new checks using the actual beta.4 handlers, Masking state and command validator, covering every regular correction, required ID prefixes, selection changes and no retry after an uncertain End failure. Original field-only tests remain useful but do not establish backend admission by themselves.

Not performed: a running Companion installation, Zorin hardware, real Lightroom SDK/UI execution, or a native test of every control. The repository has no ESLint 9 configuration, so the existing lint command could not run; dependency/configuration changes were not added to conceal that limitation.

## Reproduce / continue development

Base: `ninoleto/companion-module-ninoleto-lrbridge`, tag v0.4.2, commit `6fa1ddae6599352b24a11963ba6f8bc83b20fbb9`.

Reference: supplied `LRBridge-0.6.0-beta.4-guarded-set-20261010T165731Z-win-x64-portable.zip`; `resources/app.asar` SHA-256 `916b1905e4553561c1386a7b3f6a35bf1b21a99eeb1bf48a8bc3365b69db12d1`.

Use Node 22.20+ and the repository's Yarn 4 version:

```sh
yarn install --immutable
python3 scripts/extract-controller-reference.py /path/to/beta4.zip ../lrbridge-beta4-reference
yarn build
yarn test
yarn package
```

Set `LRBRIDGE_REFERENCE` to a different extracted reference directory if needed. `scripts/import-controller-reference.cjs` regenerates the declarative metadata; it does not run LRBridge. Hashes of the reference Controller/server files are retained in `src/beta4-data.json`.

Implementation: `controller-catalog.ts` describes controls; `controller-client.ts` handles owned requests and receipts; `controller-companion.ts` defines Companion actions, variables, feedback and presets. The original native dispatch functions remain in `main.ts`.

Do not claim a full native pass from these fixtures. Preserve the working installed module while testing this candidate. No commit, push, publication, remote installation or change to the user's LRBridge runtime was performed.
