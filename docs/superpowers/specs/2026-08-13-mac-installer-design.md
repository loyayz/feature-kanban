# macOS installer and managed launcher

## Goal and acceptance boundary

Feature Kanban will add a drag-to-Applications macOS distribution that provides the same user-facing managed experience as the Windows installer: the packaged app carries its own Node.js 24 runtime, starts or safely reuses the local board service, launches the official ChatGPT desktop app (with legacy `Codex.app` discovery as a compatibility fallback), injects the Feature Kanban entry through loopback CDP, installs the shared `feature-lifecycle` Skill, and preserves owned-process cleanup and single-instance activation behavior. The launcher uses the official application's existing profile and selected/default workspace; it does not claim a private or supported mechanism for forcing the application into its Codex view.

The release produces two architecture-specific disk images rather than a larger universal binary:

- `FeatureKanban-<version>-macos-arm64.dmg` for a signed/notarized Apple Silicon release.
- `FeatureKanban-<version>-macos-x64.dmg` for a signed/notarized Intel release.

Unsigned development artifacts use the same names with `-unsigned` immediately before `.dmg`, so they cannot be mistaken for release images.
The build promotes a private candidate image to either final name only after every applicable verification step succeeds, so a failed signature, notarization, staple, mount, or Gatekeeper gate cannot replace an existing release-looking artifact.

Both target macOS 14 or later and must be produced on matching physical architecture; x64 execution translated by Rosetta is rejected. Each image contains `Feature Kanban.app` and an Applications link. The app may run from `/Applications` or the current user's `~/Applications`; launching it directly from a mounted disk image stops before any per-user state is changed and explains that it must first be copied to Applications.

Developer ID credentials are not present in the current repository or execution environment. The build therefore supports two explicit modes: an unsigned development DMG with a visible warning, and a Developer ID signed, hardened, notarized, and stapled release when a signing identity and notary keychain profile are supplied. This work can verify the unsigned package structure on Windows and can provide deterministic macOS verification commands, but it cannot claim a notarized artifact or real ChatGPT/Codex integration without a credentialed macOS machine.

Official OpenAI documentation identifies the current product as the ChatGPT desktop app with ChatGPT and Codex in one application and publishes a macOS download, but it does not document executable locations, Chromium remote-debugging arguments, renderer DOM markers, or the `electronBridge` behavior as public integration APIs. App discovery and CDP injection are consequently a compatibility layer that requires real-device validation after ChatGPT desktop updates. See <https://learn.chatgpt.com/docs/app>.

The existing domain terms remain authoritative: a **Managed Codex Instance** is the official desktop process started and supervised by Feature Kanban, even when the current macOS bundle is named `ChatGPT.app`; **Service Ownership** still means that only a board service created by the launcher is stopped by the launcher. “Launch ChatGPT/Codex” below refers to starting that managed official desktop process, not to selecting a particular workspace inside the unified application.

## Approaches considered

### Shared supervisor with platform adapters — selected

Keep the current service ownership, CDP supervision, renderer reinjection, and launcher orchestration as the common control flow. Move operating-system operations behind small platform boundaries: desktop process discovery/launch, native error presentation, single-instance endpoint selection, and packaged Node runtime location. Add a minimal native Swift bootstrap only to make a valid Finder-launchable and signable `.app`; it starts the bundled Node launcher and exits, so all product behavior remains in the existing TypeScript runtime.

This approach minimizes duplicated behavior, protects Windows parity with its existing tests, and makes later fixes to the shared supervisor apply to both platforms. Its cost is a focused refactor of existing internal launcher types and platform selection.

### Separate macOS Node launcher

Copy the Windows orchestration into a parallel macOS launcher and replace only the Windows calls. This reduces edits to current files at first, but duplicates service ownership, CDP cleanup, activation, and error behavior. The two launchers would drift as ChatGPT desktop integration changes, so this approach is rejected.

### Native Swift supervisor

Rewrite process discovery, service supervision, CDP communication, injection, Skill deployment, and lifecycle cleanup in a native macOS application. It could offer the most native UI, but it would recreate a substantial tested Node subsystem and introduce two implementations of the same product contract. This is disproportionate to an installer port and is rejected.

The lower-intrusion product alternative is a DMG that installs only a standalone board and the shared Skill. It would add packaging without touching the existing managed launcher and would avoid the private ChatGPT/CDP compatibility boundary, but it would not launch ChatGPT/Codex, inject the native entry, activate an existing managed instance, or stop the owned board service when ChatGPT exits. It does not satisfy the confirmed full-parity requirement.

## Application bundle and installation model

`Feature Kanban.app` is a per-user-capable, non-sandboxed Developer ID application. Its bundle contains:

- the compiled server and launcher;
- the Angular browser assets;
- the injection script and complete cross-tool Skill;
- one architecture-matching Node.js 24 helper in the standard `Contents/MacOS` code location;
- the package manifest and macOS uninstall entry point.

A minimal Swift `CFBundleExecutable` resolves `Contents/Resources`, sets the packaged install-root environment variable, and starts the bundled Node launcher without a terminal window. It does not create a persistent log before Node validates the bundle; a child-launch failure is presented with `NSAlert`. The bootstrap exits after spawning; the Node launcher remains the supervisor. A subsequent Finder launch starts another short-lived bootstrap, whose Node child contacts the existing supervisor and asks it to activate the current ChatGPT/Codex renderer.

The DMG copy itself cannot execute installation code. On the first successful launch from an Applications directory, the Node launcher performs the per-user setup before starting the service or ChatGPT/Codex:

1. Validate the app bundle location and packaged manifest identity.
2. Install `Contents/Resources/app/skills/feature-lifecycle` into `~/.agents/skills/feature-lifecycle` using a staged replacement.
3. Back up pre-existing content under `~/.feature-kanban/skill-backups` and record the deployed directory hash.
4. Write `~/.feature-kanban/macos-installation.json` with product/version identity, bundle path, Skill deployment hash, backup path, and any nonfatal Skill failure.
5. Continue into the common managed-launch flow.

The Skill replacement transaction remains recoverable until the installation record is atomically committed. If record creation fails, the launcher restores the pre-launch Skill state (or preserves and reports the rollback copy if restoration itself fails), leaves any previous valid installation record unchanged, and stops before service or desktop-process mutation.

An unchanged managed Skill is not reinstalled on every launch. Replacing the application with a newer version causes the next launch to compare the new packaged Skill to the recorded deployment and update it with the same backup/rollback semantics as Windows. If the user modified the deployed Skill, the modified directory is backed up before replacement so uninstall can restore it.

Skill installation failure remains nonfatal to the board application, matching Windows behavior: the original Skill is restored when replacement fails, the failure path is written to the installation record, and a native warning is shown before managed launch continues.

The app executable supports an explicit `--uninstall` action documented for Terminal use. Uninstall first refuses to proceed while the managed launcher is active. It validates the exact allowed Skill target and backup root, the installation-record identity, an exact `Feature Kanban.app` name, a non-symbolic-link bundle, the bundle identifier, the embedded package identity, and an app location of `/Applications` or `~/Applications` before any recursive removal. It then applies the existing hash contract:

- If the current Skill still matches the deployed hash, remove it and restore the recorded backup when present.
- If it was modified or is unexpectedly absent, preserve user state and the backup and report the manual recovery path.
- Preserve the database, logs, and Skill backups under `~/.feature-kanban`.
- Remove the macOS installation record and the validated app bundle only after Skill handling finishes.

Running the app from another local directory remains supported only for diagnosis: managed launch reports that it must be copied to Applications, and uninstall will restore a validated Skill record but will require the user to move that nonstandard app bundle to Trash manually rather than recursively deleting an arbitrary path.

## Shared launcher platform boundary

The launcher introduces a platform-neutral desktop-process contract containing the existing `DesktopProcess` and `ManagedChild` semantics. The current Windows adapter retains its PowerShell/AppX discovery and process-launch implementation. A new macOS adapter provides the same operations without shell string evaluation:

- Resolve an explicit `FEATURE_KANBAN_CODEX_APP` override when present, otherwise check standard `/Applications` and `~/Applications` locations for `ChatGPT.app` first and legacy `Codex.app` second.
- Read `CFBundleExecutable` with structured `plutil` arguments, ensure the executable remains under the selected bundle's `Contents/MacOS`, and require it to be executable.
- Parse untruncated `/bin/ps -axww -o pid=,command=` output and match resolved executable paths to detect an already-running official desktop app.
- Spawn the resolved executable directly with the existing loopback remote-debugging arguments so the supervisor owns the launched process and can terminate only that launch on setup failure.

The common launcher continues to refuse startup when an unmanaged official desktop app is already running. It does not kill or attach to that process. When no conflict exists, it starts or reuses the board service, checks CDP port `46172`, launches the official app with CDP bound to `127.0.0.1`, configures the first renderer, watches replacement renderers, and stops only an owned board service after the managed desktop process exits. The injected board entry can mount in the unified desktop renderer regardless of the currently selected workspace, while native Codex session navigation remains conditional on the existing thread markers or `electronBridge` route capability. When those Codex-specific capabilities are absent, the existing copy-ID fallback remains authoritative; the launcher does not report that it forced or navigated to Codex.

The installed service runtime selects `runtime/node.exe` on Windows and the signed `Contents/MacOS/FeatureKanbanNode` helper on macOS. Keeping the Mach-O helper in a standard nested-code location allows strict outer signature validation. Static assets, version, fixed ports, environment sanitization, health identity, data directory, and ownership semantics do not change.

Windows keeps its per-user named pipe. macOS uses a short Unix-domain socket below `~/.feature-kanban`, derived from the same user-home identity. If a crash leaves a socket path behind, a new launcher first attempts a connection; it removes and recreates only a verified socket at the exact generated endpoint after connection refusal. It never treats an arbitrary file or symbolic link as a stale socket.

Native fatal messages continue through PowerShell/WPF on Windows and use `/usr/bin/osascript` with arguments, not interpolated AppleScript source, on macOS. Product error messages and failure exit status remain consistent.

## Packaging, signing, and notarization

The macOS staging tool is implemented as testable TypeScript plus a small macOS shell orchestrator. The TypeScript layer assembles the `.app`, writes an XML `Info.plist`, copies only declared resources, preserves executable modes, and writes a manifest with product, version, target platform, architecture, Node version, and an exact stable payload set. Every stable payload other than the manifest itself, Apple-generated `_CodeSignature` metadata, and the outer app's main Swift executable receives an exact size and SHA-256. The main executable remains listed with required executable mode and inspected architecture, but its byte integrity is explicitly delegated to the enclosing app signature because Apple code signing modifies the main Mach-O in place; unsigned images are development-only. It refuses an architecture mismatch between the requested artifact and the running Node binary. Building both artifacts therefore uses one matching macOS build job per architecture rather than emulation or an unverified mixed-architecture bundle.

Apple's code-signing guidance requires nested code to use standard bundle locations, be signed from the inside out, and treats the main executable as an in-place signed object. This is why the Node helper lives directly in `Contents/MacOS`, its signed bytes remain manifest-hashed, and the main executable uses the explicit outer-signature integrity mode. See <https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html>.

The shell layer requires macOS/Xcode command-line tools, compiles the small Swift bootstrap for the current architecture, invokes the staging/verifier, and uses `hdiutil` to create a compressed DMG containing the app and Applications link. It derives artifact names from the verified manifest rather than caller-provided free-form paths.

Unsigned mode stops after deterministic package and disk-image verification and clearly labels the artifact unsigned. Signed mode requires a `Developer ID Application` identity. The shell copies Node into a private build directory and compiles the Swift bootstrap there, signs the temporary nested Node helper with a secure timestamp and Hardened Runtime plus the JIT entitlement required by V8, then gives those inputs to the staging layer. Staging generates the payload manifest after nested signing. The shell signs the enclosing application last, which applies Hardened Runtime and the Developer ID signature to the main Swift executable without re-signing the Node helper. It then verifies signatures and the still-valid payload manifest, creates and signs the DMG, submits it with `xcrun notarytool --keychain-profile ... --wait`, staples the accepted ticket, and validates Gatekeeper and stapling. Supplying only part of the signing/notary configuration is an error; the build never mutates the developer's active Node executable and never silently presents an ad-hoc or partially signed image as a release.

Apple requires Developer ID-distributed software to use valid executable signatures, Hardened Runtime, secure timestamps, and notarization; `notarytool` is the supported scripted submission tool. The Node JIT exception is restricted to the Node executable rather than granted to the whole bundle. See <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution> and <https://developer.apple.com/documentation/security/hardened-runtime>.

No npm packaging framework or runtime dependency is added. Windows IExpress staging, PowerShell installation/uninstallation, package layout, and `FeatureKanbanSetup.exe` remain intact.

## Error and recovery behavior

- Launching from the mounted DMG or another unsupported location fails before Skill, service, or ChatGPT state changes.
- A missing or malformed package manifest fails before per-user state changes.
- A missing ChatGPT/Codex app produces a native error with the checked locations and the override name; it does not start a second board service.
- An unmanaged running official app is never terminated or modified.
- Board-port or CDP-port conflicts retain the existing fail-safe behavior.
- If the managed desktop app starts but CDP discovery or injection fails, only the process launched by Feature Kanban and an owned board service are stopped.
- Skill replacement is staged and rollback-backed. A Skill error is recorded and warned but does not change board/server semantics.
- A stale Unix socket is recovered only after connection failure and exact socket-type/path validation.
- Uninstall never recursively removes an unrecognized, symlinked, nonstandard, or identity-mismatched app path.

The app does not add automatic rollback of a successfully copied `.app`; drag-to-Applications installation is a Finder operation. It does not modify the official ChatGPT/Codex application, its profile, or its files.

## Verification strategy

Automated tests are required because this change introduces platform dispatch, destructive-uninstall guards, package identity, and failure-recovery rules. Production implementation precedes the new tests; tests derive from the confirmed design and do not introduce test-only production hooks.

Platform-independent tests run on the current Windows environment and cover:

- platform factory selection and preservation of Windows adapter behavior;
- macOS app candidate ordering, bundle executable containment, process-list parsing, and safe argument construction with injected filesystem/command adapters;
- platform-specific runtime path resolution and single-instance endpoint generation;
- first-install, managed update, modified-Skill backup, replacement rollback, uninstall restore/preserve, and unsafe app-removal rejection in temporary directories;
- macOS staging manifest identity, required files, architecture, modes, hashes, tamper detection, bundle identifiers, and rejection of mismatched runtime metadata;
- signing script contracts, including complete-credential enforcement and `notarytool`/stapling commands;
- all existing launcher, Windows installer, service, UI, injection, and Skill tests.

No automated test launches the user's real ChatGPT/Codex app, installs into the active `~/.agents` directory, changes `/Applications`, opens the real ports, or invokes destructive uninstall against a real bundle.

A matching macOS machine must additionally run the macOS quality gate for each architecture. The gate compiles the Swift bootstrap, stages and verifies the app, builds and verifies the DMG, mounts it read-only to inspect contents, and in signed mode runs `codesign --verify --deep --strict`, `spctl --assess`, `notarytool`, and `stapler validate`. A release candidate then requires a manual smoke test of copy, first launch, Skill deployment, service ownership, ChatGPT/Codex launch, native injection, second-launch activation, managed exit cleanup, modified-Skill uninstall protection, and app deletion. Those macOS and notarization checks are explicitly unverified in the current Windows session. Intel package construction remains required, but compatibility with a currently available official Intel ChatGPT/Codex desktop build is an external availability check rather than a capability this repository can guarantee.

## Change-surface contract

### Delivery target and expected additions

New production code is limited to the macOS desktop-process adapter, macOS first-launch/Skill installation and guarded uninstall implementation, platform factory/contracts, Swift bootstrap, macOS package staging/verifier/build scripts, Info/entitlement templates, tests, and installation documentation. New runtime state is limited to the existing `~/.feature-kanban` area, one macOS installation record, a Unix-domain launcher socket while running, and the already approved shared Skill target.

### Existing production behavior to modify

The following existing launcher layers require focused edits:

- `src/launcher/index.ts`: select the platform adapter, perform a read-only macOS location/package preflight before acquiring the single-instance lease, then perform mutating first-launch setup after acquiring the primary lease but before entering the existing managed-launch flow. Invalid/DMG launches therefore create no user state, while secondary launches only notify the primary and cannot race the Skill/record transaction. Windows chooses the same Windows adapter and bypasses macOS setup.
- `src/launcher/codex-supervisor.ts`: depend on the platform-neutral process contract. Port checks, launch arguments, renderer watching, activation, termination-on-setup-failure, and exit polling remain unchanged.
- `src/launcher/service-supervisor.ts`: select the packaged Node executable name by platform. Service URL, environment cleanup, ownership, start polling, and stop behavior remain unchanged.
- `src/launcher/single-instance.ts`: select a Windows named pipe or guarded macOS Unix socket and recover a verified stale macOS socket. Windows endpoint and activation semantics remain unchanged.
- `src/launcher/message-box.ts`: dispatch native fatal/warning presentation by platform. Existing Windows PowerShell/WPF behavior remains unchanged.
- `package.json`: add macOS-specific stage, verify, installer, and quality-gate commands without changing the meaning or output of the current Windows `check` and installer commands.

The Windows PowerShell installer/uninstaller, server/API, database schema and persistence semantics, lifecycle stages and Skill protocol, Angular behavior, injection script, loopback addresses and ports, permissions boundary, and official application files are protected and must not change. Any implementation discovery that requires changing those protected areas invalidates this contract and returns to design authorization before the edit.

### Business, security, and runtime impact

On macOS, Feature Kanban gains authority to discover and launch the official desktop executable, open its loopback CDP endpoint for the managed session, inject the existing renderer script, create and later remove a Unix socket, install/backup/restore the shared Skill, and recursively remove only its strictly validated app bundle during explicit uninstall. These are new macOS process, filesystem, and local-debugging effects. They mirror the accepted Windows product behavior but are not official OpenAI extension APIs.

Runtime capacity remains one local Node service, one SQLite database, one SSE connection per board client, and one loopback CDP listener. The architecture-specific app adds a bundled Node executable and a small native bootstrap but no daemon, login item, kernel/system extension, privileged helper, background update agent, remote listener, telemetry, or administrator-level install step. No load, long-duration, Intel-hardware, Apple-Silicon-hardware, Gatekeeper, notarization, or current ChatGPT desktop compatibility test is executed in this Windows session.

### Lower-intrusion alternative and lost fidelity

The lower-intrusion DMG would package the standalone board and first-launch Skill deployment only. It would add no platform refactor, process discovery, CDP launch, renderer injection, or owned-service coupling. The lost fidelity is the confirmed core of full parity: users would need to start the board separately, would not receive a native ChatGPT/Codex sidebar entry or session navigation, second launch could not activate managed ChatGPT/Codex, and closing ChatGPT/Codex would not clean up an owned board service.

This full-parity design therefore triggers the lifecycle change-surface authorization gate: it refactors existing launcher control flow and introduces new macOS process, local-CDP, filesystem, failure-cleanup, and guarded-recursive-uninstall behavior. Implementation must not begin until that exact surface is explicitly authorized.
