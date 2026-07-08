# LRBridge Companion Module Help

This module controls Adobe Lightroom Classic through LRBridge.

## Required version

This module requires **LRBridge v0.5.1 or newer**.

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
