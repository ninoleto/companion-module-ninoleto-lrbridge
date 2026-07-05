# companion-module-ninoleto-lrbridge

Bitfocus Companion module for LRBridge.

This repository is not LRBridge itself. It is a Companion module that talks to LRBridge over HTTP.

LRBridge is a separate application for controlling Adobe Lightroom Classic through a local HTTP API.

LRBridge repository:

https://github.com/ninoleto/LRBridge

## Purpose

This module lets Bitfocus Companion control Adobe Lightroom Classic through LRBridge, without creating every command manually as a generic HTTP action.

Typical setup:

- Adobe Lightroom Classic runs on a Windows computer
- LRBridge runs on the same Windows computer as Lightroom
- Bitfocus Companion can run on the same computer or on another machine
- Companion connects to the LRBridge API host and port

Default LRBridge API port: 17891

Example Companion connection:

Host: 192.168.1.x
Port: 17891
Poll interval: 1000 ms

Use the IP address of the computer running LRBridge.

## Status

Experimental v0.1.0 module.

Confirmed working:

- Adjust Lightroom slider
- Reset individual Lightroom slider
- Run LRBridge action

## Companion Actions

This module intentionally exposes only three action types.

### Adjust Lightroom slider

Sends a relative slider adjustment to LRBridge.

Expected LRBridge endpoint pattern:

/adjust?slider=Exposure&amount=1

Example Companion settings:

Slider: Exposure
Amount: 1

### Reset Lightroom slider

Resets one selected Lightroom slider.

Expected LRBridge endpoint pattern:

/reset?slider=Exposure

Example Companion settings:

Slider: Exposure

### Run LRBridge action

Runs a named LRBridge action.

Expected LRBridge endpoint pattern:

/action?action=setAutoTone

Example actions may include:

setAutoTone
setAutoWhiteBalance
cropTool

Available actions depend on the installed LRBridge version.

## What this module intentionally does not include

This module does not include:

- Reset all sliders
- Reset slider group
- Keyboard shortcut sending
- Direct Lightroom keyboard emulation
- Live slider value feedback

Global reset and group reset actions are intentionally excluded because they can be dangerous in real Lightroom workflows.

Keyboard shortcuts should be handled separately, for example with Vicreo Hotkey, unless LRBridge later adds a safe Lightroom-focused shortcut system.

## Architecture

Companion button press
→ Companion LRBridge module
→ HTTP request to LRBridge
→ LRBridge talks to Lightroom Classic
→ Lightroom changes the selected photo

The module should stay focused on LRBridge API control.

Do not add Windows keyboard injection directly inside this Companion module. Companion may run on Linux, macOS, or another machine, while Lightroom usually runs on Windows.

## LRBridge API expectations

The module expects LRBridge to provide these API routes:

/status
/adjust
/reset
/action

/status is used for connection status.

/adjust is used for relative slider changes.

/reset is used for individual slider reset.

/action is used for LRBridge actions such as Auto Tone or Auto White Balance.

## Development

Install dependencies:

corepack enable
corepack prepare yarn@4.17.0 --activate
yarn install

Build:

yarn build

The build output is generated into:

dist/

The dist folder is ignored by Git and should be generated locally.

## Local Companion development

Place this module folder inside Companion's developer module folder.

Example:

/home/nino/companion-module-dev/companion-module-ninoleto-lrbridge

Set Companion's developer module path to the parent folder:

/home/nino/companion-module-dev

Companion should then show the module as:

LRBridge

## Repository notes for future maintainers and AI assistants

This is a small and intentionally focused Companion module.

Before changing the module, preserve these rules:

1. Keep the public action list simple.
2. Do not re-add reset all or reset group actions without a clear safety reason.
3. Do not mix generic keyboard shortcuts into this module.
4. Prefer LRBridge API actions over OS-level automation.
5. Keep LRBridge itself as the source of truth for Lightroom behavior.
6. If new sliders or actions are added, update choices and README together.
7. Test changes in Companion with a real LRBridge connection before release.

Current intended public action list:

- Adjust Lightroom slider
- Reset Lightroom slider
- Run LRBridge action

## License

MIT
