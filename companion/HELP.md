# LRBridge

This module controls Adobe Lightroom Classic through LRBridge.

## Ports

Commands use the LRBridge command API port, normally `17891`.

Feedback uses the LRBridge Web Controller / feedback API port, normally `17892`.

## Recommended settings

```text
LRBridge Host / IP: 127.0.0.1, or the LAN IP of the Lightroom PC
Command API Port: 17891
Feedback / Web Controller Port: 17892
Background All Slider Feedback Poll Interval: 0
Action Feedback Debounce After Slider Move: 500
```

## Important

Use the native LRBridge actions if you want automatic slider feedback.

Generic HTTP actions can move sliders, but they bypass this module. If a button uses generic HTTP, the LRBridge module cannot know which slider moved and cannot update only that slider.

## Button text example

```text
EXP
$(LRBridge:slider_exposure)
```

Use Companion's variable picker to insert the correct connection prefix.
