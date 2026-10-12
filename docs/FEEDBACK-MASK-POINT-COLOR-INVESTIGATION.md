# October 11 — feedback display mismatch and masked Point Color

Investigation baseline: **0.5.0-beta.4.3**. The subsequent 4.4 candidate changes preset organization and Healing only; it retains the Point Color implementation.

## User results

- Regular Masking sliders now work. Preserve the accepted gesture-ID correction.
- Contrast fine steps work well; feedback is slower than the edit.
- SDR Brightness, global Point Color Hue Shift and Reflection Amount have nearly immediate feedback on the user's setup.
- Initially masked Point Color appeared unresponsive. The user subsequently confirmed that no mask had been selected; selecting a mask restored operation. **Masked Point Color is manually accepted within that test scope**, with no additional fix required. Global Point Color also works.

## Feedback mismatch reproduced

The module maintains its original native-slider feedback cache and the newer Controller client's confirmed values. Fine-step completion updates the latter after validating the beta.4 operation receipt. Some presets still display the former.

| Control | Preset variable |
|---|---|
| Contrast | `slider_contrast` (original native cache) |
| SDR Brightness | `control_sdrbrightness` (Controller confirmed value) |
| Global Point Color Hue Shift | `control_point_color_hueshift` |
| Reflection Amount | `control_reflections_amount` |

An isolated reproduction with fresh confirmed Contrast 21 and old native-cache Contrast 20 shows `control_contrast=21` while the preset still displays `slider_contrast=20`. `controller_value` also prefers the old native-cache value. This explains a concrete module-side delay independently of Lightroom performance. Normal native feedback timing and the context-triggered full refresh add their own scheduling delays; physical latency was not measured.

Relevant code: `appendControllerPresets`, `publishControllerValues`, and `controllerFeedbacks` in `src/controller-companion.ts`; `receipted` in `src/controller-client.ts`; native-cache refresh in `src/main.ts`.

A future correction should reconcile confirmed native results with the displayed native values using photo/context and read ordering. Simply increasing polling or letting an older background response overwrite a newer receipt would not resolve that ownership problem. No feedback timing or display implementation was changed in this investigation.

## Masked Point Color: request structure checked, native cause unconfirmed

Two additional tests in `tests/masking-admission.test.mjs` use the exact supplied beta.4 route handlers, Masking state machine and command validator. With an available selected mask and valid local Point Color samples, the current module passes:

- Existing swatches 1–8; all five scalar Set and Fine-step operations, with correct mask/sample identity and SDK value scaling.
- All twelve range boundaries and three full-range translations.

Only SDK execution and returned snapshots are simulated. These passing tests do not override the user's failure or establish a native pass. They are new source tests, not part of the already delivered 4.3 archive's recorded 45-test run.

The supplied screenshot contains `develop.nudge` admissions for `SDRBrightness`; it contains no masked Point Color request or Companion error. Some failures occur before a command is queued and therefore cannot appear in the LRBridge queued-command log.

User follow-up resolves the reported masked Point Color failure: a mask had not been selected. Do not request further logs or reopen that investigation without a new failure. The confirmed native-slider feedback-cache issue remains separate and deferred. Preserve global Point Color, fine steps, Color Grading and accepted regular Masking behavior.
