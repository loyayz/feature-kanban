# Windows Installer Shortcut Encoding Design

## Problem and evidence

The Windows installer invokes `installer/install.ps1` with Windows PowerShell 5.1. Both `installer/install.ps1` and `installer/uninstall.ps1` are UTF-8 without a byte-order mark, while Windows PowerShell 5.1 reads such scripts with the active ANSI code page. The newly added Chinese shortcut literals are therefore parsed as mojibake. In the failing installation, `installation.json` recorded `C:\programs\Feature Kanban\鍚姩 Codex 涓庝换鍔＄湅鏉?lnk`; the byte sequence for the final Chinese character consumed the period before `lnk`. `WScript.Shell.CreateShortcut` then rejected the path because it no longer ended in `.lnk` or `.url`.

The same decoding risk applies to `installer/uninstall.ps1`: an installer fixed in isolation could create correctly named shortcuts, but an unmarked uninstall script could misparse its hard-coded allowlist and fail to remove them.

## Selected design

Store both Windows end-user PowerShell scripts as UTF-8 with BOM. Windows PowerShell 5.1 recognizes that encoding, and PowerShell 7 remains compatible. The existing staging and IExpress steps copy these files byte-for-byte, so the BOM reaches both the packaged installer payload and the installed uninstall script without new bootstrap logic.

Keep the current Chinese shortcut names, the bundled runtime, and the Windows PowerShell 5.1 bootstrap. Add a Windows-only regression assertion that dot-sources each script through `powershell.exe` and verifies that its parsed function definitions retain the exact Chinese shortcut names. Also assert the source byte markers so packaging cannot silently regress the compatibility contract.

An installation that previously stopped at shortcut creation can be rerun with the rebuilt installer. Its existing product manifest makes the directory an allowed update target; the corrected script rewrites the intended shortcut metadata and completes shortcut and uninstall registration.

The repository's default `npm run check` gate is limited to `npm run typecheck && npm run test`. Production builds, Windows staging, package verification, and IExpress generation remain available as explicit standalone scripts but are not run by the complete development gate. This keeps ordinary validation independent from Windows release packaging.

## Alternatives considered

Renaming the installed shortcuts to ASCII would avoid the decoding edge case but would remove the user-facing Chinese launch names delivered by the Windows launch-entry feature. It is unnecessary because the scripts already have a supported encoding mechanism.

Launching PowerShell 7 would decode unmarked UTF-8 correctly, but Windows does not guarantee that `pwsh.exe` is installed. Adding or bundling it would expand the installer and introduce a new runtime dependency for no functional benefit.

Re-encoding scripts only in `scripts/stage-windows-package.ps1` would repair a release package, but the checked-in scripts would remain unsafe when invoked directly by Windows PowerShell 5.1 and tests could miss source/package divergence. Marking the source files is the smaller and more reliable contract.

Removing the standalone Windows build scripts would prevent release packaging rather than merely removing it from the default gate. Adding a new aggregate release-check alias would introduce an unrequested command. Both are outside the requested scope, so the existing standalone scripts remain unchanged.

## Behavior and failure handling

The installer data flow stays unchanged: select `<chosen folder>\Feature Kanban`, copy the package, install the shared Skill, calculate and persist shortcut paths, create three shortcuts, and register uninstall metadata. The only behavior change is that Windows PowerShell 5.1 interprets the existing non-ASCII literals correctly.

Errors remain visible through the current IExpress bootstrap. No retry, rollback, migration, registry cleanup, or new recovery behavior is introduced. A previously written mojibake manifest is safely replaced during the next installation attempt; shortcut history beyond the allowed desktop entry is not reused.

## Verification

After the production encoding change, run the installer-specific tests under Node.js 24. The regression must prove Windows PowerShell 5.1 parses both shortcut literals exactly and that both end-user scripts begin with the UTF-8 BOM. The final quality gate is `npm run check`, which runs type checking and all tests without production building, Windows staging, package verification, or IExpress generation.

No new production interfaces or test hooks are needed. Automated tests operate on script text and temporary locations; they must not touch the real Desktop, uninstall registry entry, active Skill, or `C:\programs\Feature Kanban`.

## Change-surface contract

The delivery target is limited to Windows PowerShell source encoding for installer-owned Chinese shortcut names.

- Existing production files modified: `installer/install.ps1` and `installer/uninstall.ps1`, changing only their encoding marker, plus `package.json`, changing only the `check` script composition. PowerShell control flow, parameters, shortcut names, registry behavior, Skill deployment, error handling, uninstall safety checks, and every standalone build/package script are protected.
- Existing tests modified: `test/installer/package-manifest.test.ts` and `test/installer/skill-installation.test.ts` enforce the encoding, Windows PowerShell 5.1 parsing, and default-gate composition contracts without adding production seams.
- Existing user documentation modified: `README.md` describes `npm run check` as type checking plus the complete test suite and keeps Windows installer generation as a separate explicit command.
- No application runtime, API, domain model, lifecycle state, database, protocol, transaction, permission, public interface, install destination, bundled Node.js runtime, or package layout changes.
- Resource impact is three bytes per marked script and negligible test time. No load, capacity, or performance validation is required.
- No Windows package or full GUI installation is required for this change. Source BOM assertions, the Windows PowerShell 5.1 parser scenario, the gate-composition assertion, and `npm run check` provide the automated evidence.

## Self-review

The design contains no placeholders. The evidence, selected encoding contract, recovery path, protected behavior, test boundary, and packaging expectations agree. The scope is one installer compatibility defect and does not require decomposition.
