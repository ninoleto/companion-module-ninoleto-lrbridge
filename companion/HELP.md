# LRBridge Companion Module

This module controls Adobe Lightroom Classic through the local LRBridge HTTP API.

## Requirements

- LRBridge running on the Lightroom PC
- Lightroom Classic with the LRBridge Lightroom plugin loaded and polling
- Companion on the same PC or another LAN machine

## Default LRBridge API

- Host: `127.0.0.1`
- Port: `17891`

Use the LAN IP of the Lightroom PC if Companion runs on another computer.

## Notes

This module intentionally uses LRBridge's stable one-way endpoints only:

- `/adjust`
- `/reset`
- `/reset-group`
- `/reset-all`
- `/action`
- `/status`
- `/sliders`
- `/groups`

Do not use LRBridge `/get`, `/last-result`, or `/set` for normal Companion feedback yet.
