# Installer finalization failure repair

## Problem and confirmed root cause

A first installation copied `app`, `runtime`, and `installer`, then replaced the shared `feature-lifecycle` Skill, but stopped before creating shortcuts, `installation.json`, or the Windows uninstall registration. Windows PowerShell 5.1 reproduces the exact failure: when `$previousInstallation` is `$null`, `@($previousInstallation.shortcuts)` produces a one-element array containing `$null`. The existing `Count -ge 1` branch then sends an empty string to `Get-FeatureFullPath -Path`, which terminates installation.

The resulting directory is not a valid installation under the current uninstall safety contract because it has no identity manifest. IExpress also hides the launched PowerShell window, so the terminating error is not visible enough to the user.

## Chosen approach

The approved repair combines the narrow root fix with recoverable finalization and visible bootstrap errors.

1. Treat a missing previous installation as zero previous shortcuts. Existing valid installations still reuse their recorded desktop shortcut when it is one of the two allowed desktop candidates.
2. Compute the intended desktop and Start Menu shortcut paths, then write a valid `installation.json` before creating either shortcut or registering the uninstall entry. The manifest records both intended paths; uninstall already treats absent shortcuts as harmless, so it can clean up whether failure occurs before, during, or after shortcut creation.
3. Keep the current final successful state: after shortcuts are created, register the per-user uninstall entry and report success. The manifest written before finalization already contains the same successful installation data and needs no second format or recovery-only schema.
4. Wrap the extracted EXE bootstrap call in an error handler that displays the underlying installation error in a Windows message box, falls back to error output if the UI cannot be shown, and exits nonzero. Temporary extraction cleanup remains in `finally`.

This is not a fully transactional installer. Failures before the manifest is written, such as invalid paths or package-copy failures, may leave only files created during that attempt; failures after Skill replacement retain the installed Skill and its recorded backup so the normal uninstall script can apply the existing hash-based restoration rules.

## Alternatives considered

The smallest alternative only changes the null-array expression and adds a regression test. It fixes the observed crash but preserves silent errors and the possibility of another post-copy failure creating an installation that the safety-checked uninstaller refuses to remove.

A full transaction would stage every file, shortcut, Skill replacement, and registry mutation and roll all of them back on any failure. It offers stronger atomicity but substantially expands destructive cleanup logic and rollback state. That risk and complexity are not justified for this targeted repair.

## Production changes

`installer/install.ps1` will normalize previous shortcut records through explicit null handling. It will create the installation manifest after Skill deployment and shortcut-path selection but before shortcut creation. No install locations, registry key names, shortcut names, Skill destinations, backup rules, or uninstall identity checks change.

`scripts/build-windows-installer.ps1` will generate a bootstrap that catches installation errors and reports them visibly before returning failure to IExpress. Successful and canceled installs retain their existing behavior.

`test/installer/skill-installation.test.ts` will exercise first-install shortcut history as an empty collection and existing-install shortcut history as preserved values under Windows PowerShell 5.1. It will also verify that a manifest containing intended shortcuts is written before shortcut creation in the production workflow without touching the real Desktop or registry.

`test/installer/package-manifest.test.ts` will verify that the generated bootstrap contains a visible failure path and a nonzero exit, while retaining temporary extraction cleanup.

`docs/installation.md` will state that installation failures are displayed and that once the identity manifest has been written, the installed uninstall script can safely remove a partially finalized installation even if the Windows application entry was not registered.

## Data and control flow

On first install, previous shortcut history resolves to an empty collection. The installer validates and copies the package, installs or records a failed Skill deployment, selects intended shortcut paths, and writes `installation.json`. It then creates shortcuts and the uninstall registry entry. Any later failure leaves enough identity and Skill/shortcut metadata for `installer\uninstall.ps1 -InstallRoot <path>` to perform guarded cleanup.

The EXE bootstrap expands its payload, invokes `install.ps1`, and always removes the temporary extraction directory. If invocation throws, it displays the exception message and exits with status 1. A canceled folder dialog returns normally and does not show an error.

## Error handling and recovery boundaries

- Invalid install roots and pre-copy validation failures continue to stop before shared Skill or registry mutation.
- Skill deployment failures remain nonfatal and are recorded in `installation.json` as today.
- Shortcut or registry failures become visible. Because the manifest already exists, manual invocation of the installed uninstall script is safe and supported.
- Uninstall continues to validate a fixed local drive, exact `Feature Kanban` directory name, non-reparse-point root, matching manifest product, and matching normalized install root before recursive deletion.
- Business data and logs under `%USERPROFILE%\.feature-kanban` remain preserved by uninstall. Existing Skill backup and modified-Skill protection semantics remain unchanged.

## Verification

Run the installer-specific TypeScript/PowerShell tests, package-manifest verification, production build, and full `npm run check`. Build a fresh `FeatureKanbanSetup.exe` and verify that it is nonempty. Automated tests must use temporary paths and must not create real Desktop shortcuts, change the real uninstall registry key, replace the active user Skill, or launch Codex.

The acceptance contract is:

- First-install shortcut history is empty rather than a single null entry.
- A normal first installation can proceed past shortcut selection.
- After manifest creation, every finalization failure leaves a path accepted by the guarded uninstall script.
- EXE-driven installation errors are visible and return failure.
- Existing update, Skill backup/restore, custom path, shortcut, and uninstall safety behavior remains unchanged.

## Change-surface contract

The delivery target is limited to the Windows installer finalization failure. Existing production files modified are `installer/install.ps1` and `scripts/build-windows-installer.ps1`; user documentation and installer tests are updated accordingly. The approved behavioral change is that installer finalization writes its identity manifest before shortcut/registry operations and EXE bootstrap errors become visible. This changes installation error and recovery semantics but does not change application runtime, API, database, lifecycle stages, Codex launcher behavior, ports, permissions, installation destinations, Skill destination, or successful uninstall behavior.

Runtime capacity impact is negligible: one small manifest write is moved earlier and an error-only message box may be displayed. No performance, concurrency, load, or long-running runtime behavior changes. Real interactive installation and failure injection are not performed against the active user environment during automated verification; fresh EXE construction and isolated PowerShell behavior tests provide the non-destructive evidence.

The lower-intrusion alternative is the one-line null check. It was rejected because it would not meet the approved requirement that post-copy failures be visible and leave a safely removable partial installation.
