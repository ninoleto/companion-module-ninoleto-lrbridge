# Contributor handoff — 0.6.0-rc.1

Forks, issues and pull requests are welcome, including contributions using AI
coding agents. The existing [MIT license](LICENSE) and notices remain unchanged.
Continued maintenance, review times and future releases are not promised.

## Source and build

Start from [tag v0.6.0-rc.1](https://github.com/ninoleto/companion-module-ninoleto-lrbridge/tree/v0.6.0-rc.1),
which matches the package source manifest. The homepage on `main` links to this
source; its older module files are not the RC1 baseline. Fork and clone this
repository, and clone the matching
[LRBridge tag](https://github.com/ninoleto/LRBridge/tree/v0.6.0-rc.1) alongside it
as `../LRBridge`. No private beta ZIP is needed.

Use Node **22.20.0** (or a compatible 22.x release) and pinned **Yarn 4.17.0**.
PowerShell, from the module checkout:

```powershell
git switch -c my-change v0.6.0-rc.1
corepack yarn install --immutable
$env:LRBRIDGE_REFERENCE = (Resolve-Path ../LRBridge).Path
corepack yarn build
corepack yarn test
corepack yarn exec companion-module-build --prerelease
```

On POSIX shells set `export LRBRIDGE_REFERENCE="$(cd ../LRBridge && pwd)"` before
the same Yarn commands. If Corepack is unavailable, install it for your Node
toolchain; `packageManager` pins the Yarn version. The generated installable
package is `ninoleto-lrbridge-0.6.0-rc.1.tgz`. `--prerelease` retains the Companion
package's RC metadata; the GitHub release is separately published as a normal
release marked Latest.

## Tested baseline and design

RC1 passes **265/265 tests** with Node 22.20.0 and Yarn 4.17.0. Its `main.js` is
byte-identical to accepted beta4.13. The tested setup is Companion **5.0.1**,
Windows x64 LRBridge beta.4 with Lightroom plug-in beta4.10, and Lightroom
Classic **15.4.1**, packaged together as 0.6.0-rc.1. Later module revisions did
not require a newer Lightroom plug-in. Other Lightroom versions are unverified.

Read `src/` for actions, presets, feedback and queue behavior, `tests/` for
isolated HTTP/SDK regressions, and `companion/HELP.md` for installation and limits.
`reference-update/` and archived beta documents preserve historical provenance;
do not apply their beta4.10 overlay over the matching RC1 source.

Keep module ID `ninoleto-lrbridge`, action/preset IDs and existing mappings
compatible. Preserve SDK-authoritative feedback, photo/context ownership,
Reset completion, command ordering and bounded polling. HTTP acknowledgement
does not prove Lightroom completion. Do not point automated tests at a live
Lightroom bridge or edit a user's photos. Keep credentials and personal
configuration out of source, logs and packages.

## Known limitations and contributions

The owner explicitly accepts LRBridge's documented security limitations for
publication: listeners bind beyond loopback, HTTP/WebSocket command and internal
context endpoints lack caller authentication, and the earlier complete security
review remains unreconciled. Use only a **trusted LAN or trusted private VPN**;
do not expose ports 17890–17892 through public forwarding or tunnels. These
limitations are not claimed fixed. See the [LRBridge publication decision](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/PUBLIC_RELEASE_BLOCKERS.md).

Feedback is polling-based and native confirmation may be delayed or unavailable.
Existing placed presets are not automatically restyled; see
[HELP](companion/HELP.md) for control-specific limitations and setup.

Branch from the release tag and target `release/0.6.0-rc.1` for RC1-based pull
requests. Describe the user-visible change, tests and manual verification.
Keep broad authentication/network changes in a separately reviewed scope.
AI-assisted contributions should include reproduction steps and relevant
context; review generated code and never provide credentials or private catalogs.
