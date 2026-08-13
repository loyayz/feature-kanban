import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { parseStageMacArguments, stageMacApp } from "../../scripts/stage-macos-package.js";
import {
  MAC_BUNDLE_EXECUTABLE,
  MAC_PACKAGE_MANIFEST_PATH,
  macDmgFileName,
  readThinMachOArchitecture,
  verifyMacAppBundle,
  writeMacPackageManifest,
} from "../../src/installer/macos-package.js";
import { createMacTestFixture, thinMachO } from "./macos-test-fixture.js";

function manifestPath(bundlePath: string): string {
  return resolve(bundlePath, ...MAC_PACKAGE_MANIFEST_PATH.split("/"));
}

test("stages and verifies deterministic architecture-specific macOS payloads", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-package-"));
  try {
    const fixture = createMacTestFixture(root, "arm64");
    const staged = await fixture.stage();
    const verified = await verifyMacAppBundle(staged.bundlePath);
    assert.equal(verified.manifest.architecture, "arm64");
    assert.equal(verified.manifest.nodeVersion, "v24.15.0");
    assert.equal(await readThinMachOArchitecture(resolve(staged.bundlePath, "Contents", "MacOS", "FeatureKanbanNode")), "arm64");
    assert.ok(verified.manifest.files.some((entry) => (
      entry.path === `Contents/MacOS/${MAC_BUNDLE_EXECUTABLE}` && (entry.mode & 0o111) !== 0
    )));
    assert.deepEqual(
      verified.manifest.files.find((entry) => entry.path === `Contents/MacOS/${MAC_BUNDLE_EXECUTABLE}`),
      {
        path: `Contents/MacOS/${MAC_BUNDLE_EXECUTABLE}`,
        integrity: "outer-code-signature",
        size: null,
        mode: 0o755,
        sha256: null,
      },
    );
    assert.equal(
      verified.manifest.files.find((entry) => entry.path === "Contents/MacOS/FeatureKanbanNode")?.integrity,
      "sha256",
    );
    assert.deepEqual(
      verified.manifest.files.map((entry) => entry.path),
      [...verified.manifest.files.map((entry) => entry.path)].sort((left, right) => left.localeCompare(right, "en")),
    );
    assert.equal(macDmgFileName("0.1.0", "arm64", false), "FeatureKanban-0.1.0-macos-arm64-unsigned.dmg");
    assert.equal(macDmgFileName("0.1.0", "x64", true), "FeatureKanban-0.1.0-macos-x64.dmg");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects architecture and Node metadata mismatches before staging", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-metadata-"));
  try {
    const fixture = createMacTestFixture(root, "x64");
    assert.equal(await readThinMachOArchitecture(fixture.runtimePath), "x64");
    await assert.rejects(stageMacApp({
      repoRoot: fixture.repoRoot,
      outputBase: fixture.outputBase,
      architecture: "arm64",
      productVersion: "0.1.0",
      nodeVersion: "v24.15.0",
      runtimePath: fixture.runtimePath,
      bootstrapPath: fixture.bootstrapPath,
    }), /architecture mismatch/);
    await assert.rejects(stageMacApp({
      repoRoot: fixture.repoRoot,
      outputBase: fixture.outputBase,
      architecture: "x64",
      productVersion: "0.1.0",
      nodeVersion: "v24.14.0",
      runtimePath: fixture.runtimePath,
      bootstrapPath: fixture.bootstrapPath,
    }), /24\.15/);
    writeFileSync(fixture.runtimePath, Buffer.from("not-mach-o"));
    await assert.rejects(readThinMachOArchitecture(fixture.runtimePath), /thin 64-bit Mach-O|truncated/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production staging CLI cannot authorize an arbitrary deletion base", () => {
  const repoRoot = resolve("repo-root");
  assert.throws(() => parseStageMacArguments([
    "--repo-root", repoRoot,
    "--output-base", resolve(repoRoot, "outside"),
    "--arch", "arm64",
    "--product-version", "0.1.0",
    "--node-version", "v24.15.0",
    "--runtime", resolve(repoRoot, "node"),
    "--bootstrap", resolve(repoRoot, "bootstrap"),
  ]), /output must be/);
});

test("production staging rejects a symlinked dist/macos output root", async (context) => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-output-link-"));
  try {
    const fixture = createMacTestFixture(root);
    const outputBase = resolve(fixture.repoRoot, "dist", "macos");
    const outside = resolve(root, "outside-output");
    mkdirSync(outside, { recursive: true });
    writeFileSync(resolve(outside, "sentinel.txt"), "keep");
    try { symlinkSync(outside, outputBase, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") { context.skip("Host does not permit directory symlink fixtures"); return; }
      throw error;
    }
    await assert.rejects(stageMacApp({
      repoRoot: fixture.repoRoot,
      outputBase,
      architecture: fixture.architecture,
      productVersion: "0.1.0",
      nodeVersion: "v24.15.0",
      runtimePath: fixture.runtimePath,
      bootstrapPath: fixture.bootstrapPath,
      enforceRepositoryOutput: true,
    }), /output directory is unsafe/);
    assert.equal(readFileSync(resolve(outside, "sentinel.txt"), "utf8"), "keep");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outer app signing may rewrite only the declared main executable entry", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-outer-sign-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    appendFileSync(resolve(staged.bundlePath, "Contents", "MacOS", MAC_BUNDLE_EXECUTABLE), "simulated-code-signature");
    await assert.doesNotReject(verifyMacAppBundle(staged.bundlePath));
    appendFileSync(resolve(staged.bundlePath, "Contents", "MacOS", "FeatureKanbanNode"), "tampered-helper");
    await assert.rejects(verifyMacAppBundle(staged.bundlePath), /size mismatch|hash mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detects payload tampering, unlisted files, traversal, and invalid plist identity", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-tamper-"));
  try {
    const fixture = createMacTestFixture(root);
    let staged = await fixture.stage();
    writeFileSync(resolve(staged.bundlePath, "Contents", "Resources", "app", "inject", "feature-kanban.user.js"), "tampered");
    await assert.rejects(verifyMacAppBundle(staged.bundlePath), /size mismatch|hash mismatch/);

    staged = await fixture.stage();
    writeFileSync(resolve(staged.bundlePath, "Contents", "Resources", "unlisted.txt"), "unlisted");
    await assert.rejects(verifyMacAppBundle(staged.bundlePath), /unlisted|payload set mismatch/);

    staged = await fixture.stage();
    writeFileSync(resolve(staged.bundlePath, "Contents", "_CodeSignature"), "not-a-directory");
    await assert.rejects(verifyMacAppBundle(staged.bundlePath), /code-signature metadata must be a directory/);

    staged = await fixture.stage();
    const manifest = JSON.parse(readFileSync(manifestPath(staged.bundlePath), "utf8")) as { files: Array<{ path: string }> };
    manifest.files[0]!.path = "../outside";
    writeFileSync(manifestPath(staged.bundlePath), JSON.stringify(manifest));
    await assert.rejects(verifyMacAppBundle(staged.bundlePath), /traversal/);

    staged = await fixture.stage();
    const plist = resolve(staged.bundlePath, "Contents", "Info.plist");
    writeFileSync(plist, readFileSync(plist, "utf8").replace("com.featurekanban.app", "com.example.invalid"));
    await writeMacPackageManifest(staged.bundlePath, {
      productVersion: "0.1.0", architecture: "arm64", nodeVersion: "v24.15.0",
    });
    await assert.rejects(verifyMacAppBundle(staged.bundlePath), /bundle identifier/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects symlinked payload inputs when the host permits symlink fixtures", async (context) => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-symlink-"));
  try {
    const fixture = createMacTestFixture(root);
    const linked = resolve(fixture.repoRoot, "skills", "feature-lifecycle", "linked.md");
    const outside = resolve(root, "outside.md");
    writeFileSync(outside, "outside");
    try { symlinkSync(outside, linked, "file"); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") { context.skip("Host does not permit symlink fixtures"); return; }
      throw error;
    }
    await assert.rejects(fixture.stage(), /symbolic link/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS build assets enforce private nvm runtime signing and notarization order", () => {
  const script = readFileSync(resolve(process.cwd(), "scripts", "build-macos-installer.sh"), "utf8");
  const entitlements = readFileSync(resolve(process.cwd(), "installer", "macos", "node.entitlements.plist"), "utf8");
  const bootstrap = readFileSync(resolve(process.cwd(), "installer", "macos", "FeatureKanbanBootstrap.swift"), "utf8");
  assert.match(script, /NODE_SOURCE="\$\{npm_node_execpath:-\}"/);
  assert.match(script, /cp -p -- "\$NODE_SOURCE" "\$RUNTIME_COPY"/);
  assert.match(script, /both FEATURE_KANBAN_SIGNING_IDENTITY and FEATURE_KANBAN_NOTARY_PROFILE/);
  assert.match(script, /sysctl\.proc_translated/);
  assert.match(script, /Refusing to build an x64 artifact under Rosetta/);
  assert.ok(script.indexOf("$RUNTIME_COPY\"") < script.indexOf("stage-macos-package.js"));
  assert.ok(script.indexOf("stage-macos-package.js") < script.indexOf("\"$APP_ROOT\"\n  codesign --verify"));
  const beforeStage = script.slice(0, script.indexOf("stage-macos-package.js"));
  assert.doesNotMatch(beforeStage, /codesign[\s\S]*"\$BOOTSTRAP_COPY"/);
  assert.match(script, /hdiutil attach -readonly -nobrowse/);
  assert.match(script, /verify-macos-package\.js" \\\r?\n  "\$MOUNT_POINT\/Feature Kanban\.app"/);
  assert.match(script, /trap cleanup_mount EXIT INT TERM/);
  assert.match(script, /Refusing a symbolic-link macOS output base/);
  assert.match(script, /Refusing an unsafe repository dist directory/);
  assert.match(script, /Refusing a repository dist directory outside the worktree/);
  assert.match(script, /Refusing to reset a symbolic-link build path/);
  assert.match(script, /xattr -cr "\$APP_ROOT"/);
  assert.match(script, /xcrun notarytool submit .*--keychain-profile .*--wait/);
  assert.match(script, /xcrun stapler staple/);
  assert.match(script, /xcrun stapler validate/);
  assert.ok(script.indexOf("xcrun notarytool submit") < script.indexOf("spctl --assess --type execute"));
  assert.match(script, /DMG_PATH="\$BUILD_ROOT\/candidate\.dmg"/);
  assert.match(script, /Refusing to replace a symbolic link at the final DMG path/);
  assert.ok(script.indexOf("spctl --assess --type open") < script.indexOf('mv -f "$DMG_PATH" "$FINAL_DMG_PATH"'));
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.doesNotMatch(entitlements, /disable-library-validation|allow-unsigned-executable-memory/);
  assert.match(bootstrap, /FEATURE_KANBAN_INSTALL_ROOT/);
  assert.match(bootstrap, /CommandLine\.arguments\.dropFirst/);
  assert.match(bootstrap, /child\.waitUntilExit\(\)/);
  assert.doesNotMatch(bootstrap, /\.feature-kanban|openLog/);
  assert.doesNotMatch(script, /codesign[^\n]+"\$NODE_SOURCE"/);
});

test("synthetic Mach-O headers cover both supported CPU types", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mach-o-"));
  try {
    for (const architecture of ["arm64", "x64"] as const) {
      const path = resolve(root, architecture, "binary");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, thinMachO(architecture));
      assert.equal(await readThinMachOArchitecture(path), architecture);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
