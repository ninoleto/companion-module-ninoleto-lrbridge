# LRBridge Companion 0.6.0-rc.1

RC1 preserves the complete user-accepted beta4.13 implementation for Companion
5.0.1. Module ID `ninoleto-lrbridge`, action IDs, preset IDs, mappings and defaults
are retained. There is no new controller behavior in this version bump.

Use LRBridge 0.6.0-rc.1 and its included Lightroom plug-in. Its application is the
accepted beta.4 implementation; its plug-in is the verified beta4.10 update.
The later Companion fixes did not require a newer Lightroom plug-in.

## Install

Verify `ninoleto-lrbridge-0.6.0-rc.1.tgz` against its SHA-256 sidecar, import it into
Companion, and select it for the existing LRBridge connection. Keep your placed
buttons and connection settings. The accepted beta4.13 package remains suitable
for rollback. See the bundled [HELP](../companion/HELP.md) for preset setup and
limits; old preset appearance is not overwritten automatically.

For LRBridge, extract the RC1 portable ZIP into a new folder, preserve settings,
and select/reload its bundled plug-in once before manual validation. Do not
overwrite the working portable installation or apply the historical overlay to
RC1. Command acknowledgements remain distinct from Lightroom SDK confirmation.

## Reproduce the release checks

Use Node **22.20.0 or a compatible 22.x version** and the pinned **Yarn 4.17.0**.
Clone LRBridge alongside this repository and use its matching RC1 source commit
(the release tag is `v0.6.0-rc.1` once published). No private beta ZIP is required.

PowerShell:

```powershell
corepack yarn install --immutable
$env:LRBRIDGE_REFERENCE = (Resolve-Path ../LRBridge).Path
corepack yarn build
corepack yarn test
corepack yarn exec companion-module-build --prerelease
```

POSIX shell:

```sh
corepack yarn install --immutable
export LRBRIDGE_REFERENCE="$(cd ../LRBridge && pwd)"
corepack yarn build
corepack yarn test
corepack yarn exec companion-module-build --prerelease
```

The test suite loads the matching bridge source and plug-in with isolated
HTTP/SDK fixtures. Do not point test helpers at a running Lightroom bridge.
`src/beta4-data.json` and `reference-update/` retain the exact accepted catalog
and historical overlay provenance; neither needs regeneration for a version bump.
The overlay manifest describes beta4.10, not a patch to apply over RC1.

## Verification and publication status

RC1 builds successfully and **265/265 tests pass** with Node 22.20.0 and Yarn
4.17.0 against the integrated RC1 bridge source. The packaged executable
`main.js` is byte-identical to the accepted beta4.13 TGZ; all 18 source files and
the Yarn lockfile are unchanged. The package manifest validates with module ID
`ninoleto-lrbridge`, runtime Node 22, API 2.1.0 and `isPrerelease: true`.

**Publication is blocked by LRBridge's current public-release security findings:**
listeners accept non-loopback connections by default, and command/internal
context admission lacks caller authentication. The earlier complete security
review artifact also remains unreconciled. See LRBridge's
`docs/PUBLIC_RELEASE_BLOCKERS.md`. No GitHub prerelease is claimed.

Source provenance is recorded in [RC1_SOURCE_PROVENANCE.json](RC1_SOURCE_PROVENANCE.json).
The package and source commit manifest, checksums and verification evidence
accompany the prepared artifacts.
