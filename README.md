# companion-module-ninoleto-lrbridge

Native Bitfocus Companion connection module for **LRBridge**, a small bridge for controlling Adobe Lightroom Classic through HTTP.

This module is intended for Loupedeck / Razer Stream Controller / Stream Deck style workflows in Companion.

## Version

`0.4.1` - context-aware feedback build for **LRBridge v0.5.1 or newer**.

## What this module does

- Sends native LRBridge slider commands from Companion.
- Sends native LRBridge Lightroom actions from Companion.
- Provides Companion variables for Lightroom slider feedback values.
- Updates the touched slider after native slider actions.
- Polls the new LRBridge `/context` endpoint to detect selected-photo/module/develop-state changes.
- Refreshes all feedback-supported slider values once when LRBridge context changes.
- Keeps constant all-slider polling disabled by default.

## Required LRBridge version

This module requires **LRBridge v0.5.1 or newer** with the context API:

```json
{
  "ok": true,
  "queueLength": 0,
  "activeModule": "develop",
  "selectedPhotoKey": "unique-photo-id-or-path",
  "contextCounter": 123,
  "contextChangedAt": 1783387000000,
  "lastContextReason": "photo",
  "developCounter": 456
}
```

Expected endpoints:

```text
Command API, usually port 17891:
/status
/context
/sliders
/groups
/adjust?slider=Exposure&amount=1
/reset?slider=Exposure
/action?action=setAutoTone

Feedback / Web Controller API, usually port 17892:
/api/feedback/request?slider=Exposure
/api/feedback/value?slider=Exposure
/api/feedback/request-many?sliders=Exposure,Contrast
/api/feedback/all
```

## Companion connection settings

Typical setup when Companion runs on another machine, such as Zorin, and Lightroom/LRBridge runs on the Windows PC:

```text
LRBridge Host / IP: 192.168.1.11
LRBridge Command API Port: 17891
LRBridge Feedback / Web Controller Port: 17892
Feedback Timing: Normal, recommended
```

Use `127.0.0.1` only when Companion runs on the same Windows PC as LRBridge.

Do not use `0.0.0.0` as the host in Companion. `0.0.0.0` is for servers listening on all interfaces, not for clients connecting to LRBridge.

## Actions

The module intentionally keeps the public action list small:

- **Adjust Lightroom slider**
- **Reset Lightroom slider**
- **Run LRBridge action**

Do not use generic HTTP actions if you want action-triggered feedback. Generic HTTP buttons can move Lightroom, but this module cannot know they were pressed, so it cannot update the touched slider immediately.

## Feedback behavior

### Native slider action feedback

When a Companion button uses **LRBridge -> Adjust Lightroom slider** or **LRBridge -> Reset Lightroom slider**, the module waits briefly, requests feedback only for that touched slider, then updates the matching Companion variable.

Example button text:

```text
EXP
$(LRBridge:slider_exposure)
```

The exact prefix depends on the Companion connection name. Use Companion's variable picker.

### Context-aware full refresh

The module polls LRBridge `/context` by default every 500 ms.

When LRBridge reports a changed selected photo, Lightroom module, or develop state, the module waits briefly and then refreshes all feedback-supported slider variables once.

This is meant to solve:

- changing photo in Lightroom
- switching Library / Develop
- manual Lightroom reset or develop-state change, when LRBridge reports `developCounter`

### Background all-slider polling

Background all-slider polling remains available as an emergency/fallback setting, but it is disabled by default.

Keep this at `0` unless you explicitly want constant all-slider polling.

## Variables

Global variables include:

```text
connected
last_status
last_error
queue_length
feedback_last_update
feedback_last_error
context_active_module
context_selected_photo_key
context_counter
context_changed_at
context_last_reason
develop_counter
context_last_update
context_last_error
auto_action_cooldown_active
auto_action_cooldown_remaining_ms
auto_action_cooldown_remaining_s
```

Slider variables are generated for all Web Controller feedback-supported sliders, for example:

```text
slider_exposure
slider_contrast
slider_temperature
slider_tint
slider_clarity
slider_dehaze
```

Use the Companion variable picker to insert the exact variable name with the correct connection prefix.

## Developer notes for humans and AI agents

This repository is the Companion module only. LRBridge itself is a separate app/plugin project.

Important design rules:

- Keep commands on the command API port, normally `17891`.
- Keep feedback on the Web Controller API port, normally `17892`, under `/api/feedback/...`.
- Keep generic HTTP actions out of the feedback design. Native LRBridge module actions are required for action feedback.
- Do not add keyboard shortcut sending to this module.
- Do not add destructive reset-all or reset-group actions unless explicitly requested.
- Keep background all-slider polling disabled by default.
- Prefer context-triggered one-shot full refreshes over constant all-slider polling.
- Preserve the small public action surface.

## Packaging

Developer build:

```bash
yarn install
yarn build
yarn package
```

The Companion installable package is the generated `.tgz` file.


## Feedback timing defaults

The normal Companion connection UI intentionally exposes only the important settings:

- LRBridge Host / IP
- LRBridge Command API Port
- LRBridge Feedback / Web Controller Port
- Feedback Timing

Internal timing values are hidden so normal users do not need to tune them.

| Setting | Fast | Normal | Safe |
| --- | ---: | ---: | ---: |
| Action feedback debounce | 500 ms | 700 ms | 1000 ms |
| Feedback read delay | 500 ms | 700 ms | 1000 ms |
| Context poll interval | 500 ms | 500 ms | 500 ms |
| Context full refresh delay | 250 ms | 500 ms | 1000 ms |
| Background all-slider polling | disabled | disabled | disabled |
| Status poll interval | 1000 ms | 1000 ms | 1000 ms |
| HTTP timeout | 2000 ms | 2000 ms | 2000 ms |
| Auto Tone / Auto WB cooldown | 3000 ms | 3000 ms | 3000 ms |
| Ignore develop counter after own slider command | 1500 ms | 1500 ms | 1500 ms |

Normal is recommended. Fast can read old Lightroom values on slower machines or heavy catalogs. Safe is slower but more reliable.

Context/photo-change refresh uses LRBridge `/context`, then refreshes all feedback-supported sliders with one `/feedback/request-many` call. The previous chunked request-many implementation was removed because it could leave early sliders stale.
