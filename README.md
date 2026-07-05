# companion-module-ninoleto-lrbridge

Bitfocus Companion module for LRBridge.

This repository is not LRBridge itself. It is a Companion module that talks to LRBridge over HTTP.

LRBridge is a separate application for controlling Adobe Lightroom Classic through a local HTTP API.

LRBridge repository:

https://github.com/ninoleto/LRBridge

## Purpose

This module lets Bitfocus Companion control Adobe Lightroom Classic through LRBridge, without creating every command manually as a generic HTTP action.

Typical setup:

- Adobe Lightroom Classic runs on a Windows computer.
- LRBridge runs on the same Windows computer as Lightroom.
- Bitfocus Companion can run on the same computer or on another machine.
- Companion connects to the LRBridge API host and port.

Default LRBridge API port: 17891

## Installation

### Normal user installation

For normal Companion users, download the .tgz package from the GitHub release page.

Use this file:

ninoleto-lrbridge-0.1.0.tgz

Do not use Source code zip or Source code tar.gz unless you are a developer.

In Bitfocus Companion:

1. Open the Modules page.
2. Click Import module package.
3. Select ninoleto-lrbridge-0.1.0.tgz.
4. Add a new connection named LRBridge.
5. Set the LRBridge host and port.

### Developer installation

Developers can clone this repository and build manually:

corepack enable
corepack prepare yarn@4.17.0 --activate
yarn install
yarn build

For Companion developer-module testing, place this module folder inside Companion's developer modules folder and set Companion's developer module path to the parent folder.

Example module folder:

/home/nino/companion-module-dev/companion-module-ninoleto-lrbridge

Example developer module path:

/home/nino/companion-module-dev

## Connection host guide

LRBridge must run on the same computer as Adobe Lightroom Classic.

If Bitfocus Companion and LRBridge are running on the same computer, use localhost:

Host: 127.0.0.1
Port: 17891

If Bitfocus Companion is running on another computer, use the LAN IP address of the computer running LRBridge:

Host: 192.168.1.x
Port: 17891

Example:

- Companion runs on Linux/Zorin.
- LRBridge and Lightroom run on a Windows PC.
- Windows PC LAN IP is 192.168.1.11.

Companion connection:

Host: 192.168.1.11
Port: 17891
Poll interval: 1000 ms

Do not use 0.0.0.0 as the Companion connection host.

0.0.0.0 is used by servers to listen on all network interfaces. Clients should connect to 127.0.0.1 or to the real LAN IP address.

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
-> Companion LRBridge module
-> HTTP request to LRBridge
-> LRBridge talks to Lightroom Classic
-> Lightroom changes the selected photo

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

## Development notes

The build output is generated into:

dist/

The dist folder is ignored by Git and should be generated locally.

The packaged Companion module is generated as a .tgz file.

Package build command:

yarn package

Package output example:

ninoleto-lrbridge-0.1.0.tgz

Do not commit package output files. Upload the .tgz file to the GitHub release assets.

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
