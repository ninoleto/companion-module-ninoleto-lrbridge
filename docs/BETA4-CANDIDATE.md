# Companion beta4.13 history — included in RC1

The user accepted this implementation as RC1 on 2026-10-12. Current installation
and reproducible checks are in [RC1 release notes](RELEASE_NOTES_0.6.0-rc.1.md).
The findings below record the original candidate, before that acceptance.

This unpublished module-only candidate builds on beta.4.12 for Companion 5.0.1. Keep the existing LRBridge beta.4 guarded-set application and Lightroom plug-in beta4.10.

## Install

Import `ninoleto-lrbridge-0.5.0-beta.4.13.tgz` into Companion and select it for the existing LRBridge connection. Keep your buttons and settings. Existing Use Generative AI and Detect Objects On/Off mappings receive the fix automatically; no preset replacement is required. Keep beta4.12 for rollback.

## What changed

These four buttons use Lightroom's SDK. Two first-press failures were reproduced against the previous module and real bridge state logic:

- A cached checkbox value could falsely produce “already confirmed.” The first press requested fresh state but skipped the write; the next press then saw the new value.
- A background native-selection refresh could advance the shared Remove revision after the SDK state was read. The bridge then rejected the checkbox request with HTTP 409 before queuing any command.

The module now requires a newer SDK capture owned by the original photo and Develop context before deciding to write or skip. The existing tool, mode, pending-operation and review guards remain.

Only these two explicit checkbox fields may reattempt admission once after the exact HTTP 409 response that proves the bridge did not admit the command. The module first obtains fresh state and retains the original photo/context and Remove mode. Network errors, timeouts, other rejection reasons, missing acknowledgements and failures after admission do not trigger a resend. Confirmed feedback still requires Lightroom's exact operation result and value readback.

The accepted Point Color polling, 2200 ms Auto action settling interval, Lens Blur, Crop Angle, Zoom, fonts and presets are retained. Neither the LRBridge application nor the Lightroom plug-in changes.

## Verification and live check

**Build and all 265 automated tests pass**, including 16 new checkbox freshness, real-bridge revision-race and retry-boundary tests. Independent review found no blocker. The complete report is in `CONTRACT-TEST-RESULTS.txt`. Live Lightroom testing remains required; automated reproductions establish code failure mechanisms, not which mechanism occurred on the user's machine.

1. In Lightroom, open Healing in Remove mode. Set Use Generative AI directly in Lightroom, then immediately press the opposite On/Off target once in Companion. Repeat in both directions.
2. Repeat for Detect Objects. Also alternate the two controls, including after selecting or deselecting an existing repair.
3. Each press should reach the requested checkbox value and show confirmed feedback. An already-matching target should remain unchanged.
4. If a press still fails, retain Companion's LRBridge log for that press and the button name; do not assume the same cause.

## Reproduce

Use the matching LRBridge RC1 source checkout and `LRBRIDGE_REFERENCE` as described
in [RC1 release notes](RELEASE_NOTES_0.6.0-rc.1.md). The old private beta ZIP and
reference overlay application are no longer required. `reference-update/` remains
the unmodified beta4.10 provenance overlay; do not apply it over RC1.
