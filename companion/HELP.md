# LRBridge Companion 0.6.0-rc.1

This RC preserves the user-accepted **beta4.13** behavior for **Companion 5.0.1**. Import **ninoleto-lrbridge-0.6.0-rc.1.tgz** and select it for your existing LRBridge connection. Keep your buttons and connection settings. Pair it with **LRBridge 0.6.0-rc.1** and the included plug-in; its implementation is the tested **beta4.10** update. No newer plug-in implementation is needed. Module ID, action IDs, preset IDs and mappings are unchanged. Preserve your working installation for rollback.

## Responsiveness and first press

Healing **Use Generative AI On/Off** and **Detect Objects On/Off** now wait for a fresh Lightroom SDK checkbox state before deciding whether a change is needed. If a background selection refresh makes LRBridge reject the request before it is queued, the module refreshes state and may submit once more for the same photo and Remove mode. Uncertain requests and accepted operations are never automatically repeated. Existing button mappings receive this fix automatically.

Lens Blur Bokeh, Apply and Depth Refinement SDK tool buttons use a separate SDK state read. Beta4.11 starts their feedback checks immediately, then every 80 ms within a 2.5-second confirmation window. Recent valid SDK state avoids a redundant pre-action read; explicit Apply on/off does not wait for its previous state. A fresh photo/module context check remains, and selected highlights still come from Lightroom feedback. Windows refinement controls keep their own state reads. Crop Angle combines pending rotary input and keeps displayed feedback authoritative; Reset is still confirmed before later turns. The matching plug-in removes the redundant 200 ms pause while already in Develop. Healing Open/Close obtains fresh tool state before each decision; older Healing Open action IDs use the same handler.

**If your Zoom rotary predates beta4.10, re-add it** to obtain its press action. Turning still zooms out/in. Press uses Lightroom's zoom toggle and clears unsent rotary movement. With Navigator's zoomed-out choice set to **Fit**, pressing while zoomed in returns to Fit; pressing while fitted zooms in. If Navigator is set to Fill, the toggle returns to Fill. This is not a dedicated Fit-only command.

## Point Color feedback

Point Color uses a separate bounded background refresh slot to observe swatches selected directly in Lightroom; unrelated controls no longer occupy that slot. Global and masked Point Color share this dedicated slot. Companion actions and their confirmation reads are unchanged. Displayed values remain actual SDK feedback.

## Auto Tone, Auto White Balance, Color and B&W cooldown

The settling interval is **2200 ms**, matching the Web Controller. Rounded whole seconds briefly show **3**, then **2**, then **1**. While a slider operation is still pending, the guard remains active; the settling countdown follows completion or an uncertain result.

After SDK slider adjustments, these four buttons show an amber **WAIT 3s → 2s → 1s** countdown, then return to their normal appearance. Further adjustments restart the wait. Presses during the wait are blocked and are not queued for later execution. The message means **“Waiting for Lightroom to finish the previous adjustment.”** Slider and knob responsiveness is unchanged.

**If these presets predate beta4.9, re-add Auto Tone, Auto White Balance, Color and B&W from Develop actions** to obtain countdown styling. Existing mapped actions receive the runtime guard automatically, but saved button graphics are not replaced by a module update. All new preset text remains size 25 with Shrink to fit.

This is a Companion-side safeguard based on slider operations sent through this LRBridge connection. Edits made through another controller or directly in Lightroom do not start this module's local countdown. The guard is a settling-time estimate, not an SDK readiness signal.

## Zoom knob

Zoom In/Out keep only the latest unsent direction and wait for space in the LRBridge command queue. Fast turns are coalesced instead of accumulating a long backlog; turning the other way replaces pending movement. The existing Zoom rotary and Zoom In/Out buttons receive this automatically. Zoom toggle and Zoom 100% cancel unsent rotary movement. An already submitted step may still finish before reversal; unrelated Lightroom work may still delay it. Stale pending movement expires rather than playing back after a long pause.

LRBridge currently provides no numeric zoom-level feedback. This controls the backlog; Lightroom itself enforces its zoom limits. The earlier zoom queue protection is retained. The press action was added in beta4.10; existing updated presets can remain.

## Preset appearance and setup

**All new preset text uses Text Size 25 with Shrink to fit enabled.** Presets use Companion 5 layered graphics, retaining their original actions, variables, permissions and colours. Long labels wrap. Existing placed buttons keep their saved styles: re-add the updated presets to obtain this appearance, or edit existing buttons manually.

The preset browser groups each tool with its controls. **Develop actions** contains Reset All, Auto Tone, Color, B&W and Auto White Balance. Mask creation, adding components and subtracting components have separate groups. Application controls follow Modules, Library Views, Develop Views, Zoom, Screen and Secondary Display. **Zoom rotary** turns left to zoom out, right to zoom in, and presses to toggle between zoomed in and Navigator's Fit/Fill view.

Each numeric control keeps **Rotary → − → Reset → +** where Reset is supported. Below zero, only **− is orange**; above zero, only **+ is blue**; at zero both are dark. Rotary backgrounds follow the value sign. On is teal/green, Off is dark red, Delete is red and Reset stays amber. Gray/blank values mean no usable feedback. Command-only actions do not invent active-state feedback.

**Presets — setup required:** Configure your favorite Lightroom Develop presets in the **LRBridge Web Controller** before using them from Companion. Previous/Next Favorite uses that configured list. Amount requires a selected preset that supports an amount; preset inventory refresh alone does not configure favorites. These Lightroom Develop presets are different from the Companion button presets.

Point Color range overview buttons show the four range boundaries in the same order as the Web Controller: lower outer / lower inner, then upper inner / upper outer. Select an existing Point Color swatch; masked Point Color additionally needs an existing selected mask. Individual boundary controls remain available. **Toggle Visualize Range has no on/off feedback**, including in the Web Controller.

## Delete and Reset All

**Enable “Allow destructive action” in the Companion press action settings only when you intend to perform the named action.** Otherwise guarded Delete, Reset All and similar commands will not execute. The setting remains unchecked in generated presets.

## 🔴 Windows automation — may be unreliable

The following controls depend on Lightroom's Windows UI and may not respond reliably: **Lens Blur Subject/Point-area focus, refinement brush Amount/Size/Feather/Flow, Auto Mask, refinement mode, opening/closing refinement controls, Reset Refinement, and Healing Selected Remove/Selected Cancel**.

Use the control directly in Lightroom if it is unreliable. Where a suitable keyboard shortcut exists, you may configure it in **VICREO Listener** and trigger it from Companion. VICREO requires separate setup and is optional; it does not provide shortcuts for controls that Lightroom does not expose.

Healing Selected Remove/Cancel use Windows automation for the actual button activation, with SDK/context checks around it. They are different from selected repair fill-type changes and SDK Delete/Refresh Repair actions. Healing Selected Add/Subtract remain hidden from new presets; existing IDs are retained.

Healing Use Generative AI, Detect Objects, new-brush Size/Feather and Visualize Spots writes use the Lightroom SDK, as do Color Grading, Reflections, People and Red Eye/Pet Eye. Some background Healing selection observation uses Windows automation. If you experience pointer flicker with new-brush Size/Feather, an optional workaround is **VICREO mouse wheel for Size and Shift + mouse wheel for Feather**, with the correct Healing tool active and the cursor over the Lightroom image. Verify it in your setup; it does not replace selected-repair Opacity/Feather controls.

**Lens Blur Focus Range:** numeric boundary and Shift Focus Range actions remain retired in Companion. Saved actions explain this and send no command. Use the LRBridge Web Controller for Focus Range. Focus Range itself uses the SDK; other Lens Blur SDK controls remain available.

## Operation and feedback

For small adjustments choose **Web Controller · Slider / numeric control → Fine steps (Web Controller ±)** with count **1** or **-1**. Exposure moves by 0.1; most other sliders move by 1. Updated presets use Fine steps. **Adjust Lightroom slider** and **Legacy steps** keep Adobe's larger SDK increments.

Color Grading retains the working beta.4.6 path. Pending values are not claimed as confirmed values. Failed or uncertain editing commands are not automatically resent. The native Develop slider timing defaults below are unchanged; expanded Controller controls have their own targeted feedback scheduling.

Select an existing mask before adjusting its settings. Use the LRBridge Windows PC LAN address when Companion runs on Zorin. Export reports a request to Lightroom, not completed files. After changing photos, pending operations remain guarded against editing the wrong photo.

# LRBridge Companion Module Help

This module controls Adobe Lightroom Classic through LRBridge.

## Required version

Use **Companion 5.0.1** with **LRBridge beta.4 guarded-set, 20261010T165731Z**, and the **Lightroom plug-in beta4.10 update**. Its version is `0.6.0-beta.4 (Companion beta.4.10 test update)`. Keep it at `lightroom/LRBridge.lrplugin` in the portable installation so it can find the bridge files. The legacy actions below originated with LRBridge v0.5.1; expanded controls require the matching beta.4 build.

## Normal connection settings

```text
Host / IP: IP address of the Lightroom / LRBridge computer
Command API Port: 17891
Feedback / Web Controller Port: 17892
Feedback Timing: Normal, recommended
```

Use `127.0.0.1` only if Companion and LRBridge run on the same machine.

## Important

Use the native LRBridge actions if you want feedback:

- Adjust Lightroom slider
- Reset Lightroom slider
- Run LRBridge action

Generic HTTP actions can still move Lightroom, but they do not trigger this module's action feedback.

## Context-aware feedback

This module requires **LRBridge v0.5.1 or newer** and uses `/context` on the command API port.

When LRBridge reports a selected-photo, Lightroom module, or develop-state change, this module refreshes all slider feedback variables once.

This avoids constant all-slider polling while still updating values after changing photos in Lightroom.

## Feedback timing defaults

The normal Companion connection UI intentionally exposes only the important settings:

- LRBridge Host / IP
- LRBridge Command API Port
- LRBridge Feedback / Web Controller Port
- Feedback Timing

Internal timing values are hidden so normal users do not need to tune them.

| Setting                                         |     Fast |   Normal |     Safe |
| ----------------------------------------------- | -------: | -------: | -------: |
| Action feedback debounce                        |   500 ms |   700 ms |  1000 ms |
| Feedback read delay                             |   500 ms |   700 ms |  1000 ms |
| Context poll interval                           |   500 ms |   500 ms |   500 ms |
| Context full refresh delay                      |   250 ms |   500 ms |  1000 ms |
| Background all-slider polling                   | disabled | disabled | disabled |
| Status poll interval                            |  1000 ms |  1000 ms |  1000 ms |
| HTTP timeout                                    |  2000 ms |  2000 ms |  2000 ms |
| Auto Tone / Auto WB / Color / B&W cooldown                    |  2200 ms |  2200 ms |  2200 ms |
| Ignore develop counter after own slider command |  1500 ms |  1500 ms |  1500 ms |

Normal is recommended. Fast can read old Lightroom values on slower machines or heavy catalogs. Safe is slower but more reliable.

Context/photo-change refresh uses LRBridge `/context`, then refreshes all feedback-supported sliders with one `/feedback/request-many` call. The previous chunked request-many implementation was removed because it could leave early sliders stale.

## Network scope and source

Use LRBridge only on a trusted LAN or trusted private VPN. Its listeners bind
beyond loopback, and command/internal feedback interfaces do not authenticate
callers. Do not expose ports 17890, 17891 or 17892 through public port forwarding
or public tunnels. The owner accepts these known limitations for publication;
they have not been fixed by this release.

Browse the [complete 0.6.0-rc.1 source and contributor handoff](https://github.com/ninoleto/companion-module-ninoleto-lrbridge/tree/v0.6.0-rc.1).
Forks and contributions are welcome under the existing MIT license; continued
maintenance is not promised.
