import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  macInstallationRecordPath,
  preflightMacInstallation,
  productionMacInstallationEnvironment,
  setupMacInstallation,
  uninstallMacApplication,
  type MacInstallationEnvironment,
  type MacInstallationFileSystem,
  type MacInstallationRecord,
} from "../../src/installer/macos-installation.js";
import { writeMacPackageManifest } from "../../src/installer/macos-package.js";
import { createMacTestFixture, type MacTestFixture } from "./macos-test-fixture.js";

function resources(bundlePath: string): string {
  return resolve(bundlePath, "Contents", "Resources");
}

function target(environment: MacInstallationEnvironment): string {
  return resolve(environment.homeDirectory, ".agents", "skills", "feature-lifecycle");
}

function createEnvironment(
  fixture: MacTestFixture,
  options: { active?: boolean; fileSystem?: MacInstallationFileSystem } = {},
): MacInstallationEnvironment {
  const native = productionMacInstallationEnvironment();
  const homeDirectory = resolve(fixture.root, "home");
  const systemApplicationsDirectory = resolve(fixture.outputBase, fixture.architecture);
  const userApplicationsDirectory = resolve(fixture.root, "user-Applications");
  mkdirSync(homeDirectory, { recursive: true });
  mkdirSync(systemApplicationsDirectory, { recursive: true });
  let operation = 0;
  return {
    homeDirectory,
    systemApplicationsDirectory,
    userApplicationsDirectory,
    fileSystem: options.fileSystem ?? native.fileSystem,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    operationId: () => `op${String(++operation).padStart(6, "0")}transaction`,
    acquireUninstallLease: async () => ({
      primary: !(options.active ?? false),
      close: async () => {},
    }),
  };
}

function writeSkill(path: string, contents: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(resolve(path, "SKILL.md"), contents, "utf8");
}

function readRecord(environment: MacInstallationEnvironment): MacInstallationRecord {
  return JSON.parse(readFileSync(macInstallationRecordPath(environment), "utf8")) as MacInstallationRecord;
}

test("first launch backs up the shared Skill, avoids unchanged replacement, and retains that backup on update", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-install-"));
  try {
    const fixture = createMacTestFixture(root);
    let staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    writeSkill(target(environment), "user-original");

    const first = await setupMacInstallation(resources(staged.bundlePath), environment);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "packaged-v1");
    assert.ok(first.installationRecord.skill?.backupPath);
    const originalBackup = first.installationRecord.skill!.backupPath!;
    assert.equal(readFileSync(resolve(originalBackup, "SKILL.md"), "utf8"), "user-original");
    const backupCount = readdirSync(resolve(environment.homeDirectory, ".feature-kanban", "skill-backups")).length;

    const unchanged = await setupMacInstallation(resources(staged.bundlePath), environment);
    assert.equal(unchanged.installationRecord.skill?.backupPath, originalBackup);
    assert.equal(readdirSync(resolve(environment.homeDirectory, ".feature-kanban", "skill-backups")).length, backupCount);

    fixture.setPackagedSkill("packaged-v2");
    staged = await fixture.stage();
    const updated = await setupMacInstallation(resources(staged.bundlePath), environment);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "packaged-v2");
    assert.equal(updated.installationRecord.skill?.backupPath, originalBackup);
    assert.equal(readFileSync(resolve(originalBackup, "SKILL.md"), "utf8"), "user-original");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordinary relaunch preserves a user-modified Skill until packaged Skill content changes", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-relaunch-modified-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    writeSkill(target(environment), "user-original");
    const installed = await setupMacInstallation(resources(staged.bundlePath), environment);
    const originalBackup = installed.installationRecord.skill!.backupPath!;
    const backups = resolve(environment.homeDirectory, ".feature-kanban", "skill-backups");
    const backupCount = readdirSync(backups).length;
    writeFileSync(resolve(target(environment), "SKILL.md"), "user-modified", "utf8");

    const relaunched = await setupMacInstallation(resources(staged.bundlePath), environment);

    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "user-modified");
    assert.equal(relaunched.installationRecord.skill?.backupPath, originalBackup);
    assert.equal(readdirSync(backups).length, backupCount);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a user-modified managed Skill receives a new backup before an app update", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-modified-"));
  try {
    const fixture = createMacTestFixture(root);
    let staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    writeSkill(target(environment), "user-original");
    const first = await setupMacInstallation(resources(staged.bundlePath), environment);
    writeFileSync(resolve(target(environment), "SKILL.md"), "user-modified", "utf8");
    fixture.setPackagedSkill("packaged-v2");
    staged = await fixture.stage();
    const second = await setupMacInstallation(resources(staged.bundlePath), environment);
    assert.notEqual(second.installationRecord.skill?.backupPath, first.installationRecord.skill?.backupPath);
    assert.equal(readFileSync(resolve(second.installationRecord.skill!.backupPath!, "SKILL.md"), "utf8"), "user-modified");
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "packaged-v2");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reinstalling an unexpectedly missing managed Skill retains the original backup", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-reinstall-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    writeSkill(target(environment), "user-original");
    const first = await setupMacInstallation(resources(staged.bundlePath), environment);
    const originalBackup = first.installationRecord.skill!.backupPath!;
    rmSync(target(environment), { recursive: true, force: true });
    const reinstalled = await setupMacInstallation(resources(staged.bundlePath), environment);
    assert.equal(reinstalled.installationRecord.skill?.backupPath, originalBackup);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "packaged-v1");
    const removed = await uninstallMacApplication(resources(staged.bundlePath), environment);
    assert.equal(removed.skillStatus, "restored-backup");
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "user-original");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Skill replacement failure is nonfatal and restores exact prior content", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-rollback-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const nativeEnvironment = createEnvironment(fixture);
    writeSkill(target(nativeEnvironment), "prior-content");
    let injected = false;
    const fileSystem: MacInstallationFileSystem = {
      ...nativeEnvironment.fileSystem,
      rename: async (source, destination) => {
        if (!injected && source.includes(".feature-lifecycle.install-") && destination === target(nativeEnvironment)) {
          injected = true;
          throw new Error("simulated replacement failure");
        }
        await nativeEnvironment.fileSystem.rename(source, destination);
      },
    };
    const environment = { ...nativeEnvironment, fileSystem };
    const result = await setupMacInstallation(resources(staged.bundlePath), environment);
    assert.match(result.skillFailure ?? "", /simulated replacement failure/);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "prior-content");
    assert.equal(result.installationRecord.skill, null);
    assert.match(readRecord(environment).skillFailure ?? "", /simulated replacement failure/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a backup mismatch aborts replacement and restores the exact user Skill", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-backup-mismatch-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const nativeEnvironment = createEnvironment(fixture);
    writeSkill(target(nativeEnvironment), "prior-content");
    const fileSystem: MacInstallationFileSystem = {
      ...nativeEnvironment.fileSystem,
      copyFile: async (source, destination) => {
        await nativeEnvironment.fileSystem.copyFile(source, destination);
        if (destination.includes(`${resolve(nativeEnvironment.homeDirectory, ".feature-kanban", "skill-backups")}`)) {
          writeFileSync(destination, "corrupted-backup", "utf8");
        }
      },
    };
    const environment = { ...nativeEnvironment, fileSystem };
    const result = await setupMacInstallation(resources(staged.bundlePath), environment);
    assert.match(result.skillFailure ?? "", /backup does not match/);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "prior-content");
    assert.equal(result.installationRecord.skill, null);
    assert.equal(
      readdirSync(resolve(environment.homeDirectory, ".feature-kanban", "skill-backups")).length,
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed automatic Skill recovery is fatal and preserves its rollback path", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-recovery-fatal-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const nativeEnvironment = createEnvironment(fixture);
    writeSkill(target(nativeEnvironment), "prior-content");
    let replacementFailed = false;
    const fileSystem: MacInstallationFileSystem = {
      ...nativeEnvironment.fileSystem,
      rename: async (source, destination) => {
        if (source.includes(".feature-lifecycle.install-") && destination === target(nativeEnvironment)) {
          replacementFailed = true;
          throw new Error("simulated replacement failure");
        }
        if (replacementFailed && source.includes(".feature-lifecycle.rollback-") && destination === target(nativeEnvironment)) {
          throw new Error("simulated recovery failure");
        }
        await nativeEnvironment.fileSystem.rename(source, destination);
      },
    };
    const environment = { ...nativeEnvironment, fileSystem };
    await assert.rejects(
      setupMacInstallation(resources(staged.bundlePath), environment),
      /automatic recovery failed.*Recovery copy/u,
    );
    assert.equal(existsSync(macInstallationRecordPath(environment)), false);
    const rollback = resolve(
      environment.homeDirectory,
      ".agents",
      "skills",
      ".feature-lifecycle.rollback-op000001transaction",
    );
    assert.equal(readFileSync(resolve(rollback, "SKILL.md"), "utf8"), "prior-content");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installation record failure rolls the Skill back and leaves no false identity", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-record-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const nativeEnvironment = createEnvironment(fixture);
    writeSkill(target(nativeEnvironment), "prior-content");
    const recordPath = macInstallationRecordPath(nativeEnvironment);
    const fileSystem: MacInstallationFileSystem = {
      ...nativeEnvironment.fileSystem,
      rename: async (source, destination) => {
        if (source.endsWith(".tmp") && destination === recordPath) throw new Error("simulated record commit failure");
        await nativeEnvironment.fileSystem.rename(source, destination);
      },
    };
    const environment = { ...nativeEnvironment, fileSystem };
    await assert.rejects(setupMacInstallation(resources(staged.bundlePath), environment), /record commit failed/);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "prior-content");
    assert.equal(existsSync(recordPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a symlinked data root is rejected before installation state is written", async (context) => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-data-link-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    const outside = resolve(root, "outside-data");
    const linkedData = resolve(environment.homeDirectory, ".feature-kanban");
    mkdirSync(outside, { recursive: true });
    writeFileSync(resolve(outside, "sentinel.txt"), "keep");
    try { symlinkSync(outside, linkedData, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") { context.skip("Host does not permit directory symlink fixtures"); return; }
      throw error;
    }
    await assert.rejects(preflightMacInstallation(resources(staged.bundlePath), environment), /unsafe path component/);
    await assert.rejects(setupMacInstallation(resources(staged.bundlePath), environment), /unsafe path component/);
    assert.equal(readFileSync(resolve(outside, "sentinel.txt"), "utf8"), "keep");
    assert.equal(existsSync(resolve(outside, "macos-installation.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("read-only installation preflight validates location and package without creating user state", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-preflight-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    const result = await preflightMacInstallation(resources(staged.bundlePath), environment);
    assert.equal(result.bundlePath, staged.bundlePath);
    assert.equal(existsSync(resolve(environment.homeDirectory, ".feature-kanban")), false);
    assert.equal(existsSync(resolve(environment.homeDirectory, ".agents")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a symbolic-link Applications directory is never treated as a standard install location", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-applications-link-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const nativeEnvironment = createEnvironment(fixture);
    const linkedApplications = dirname(staged.bundlePath);
    const otherApplications = resolve(root, "other-Applications");
    mkdirSync(otherApplications);
    const fileSystem: MacInstallationFileSystem = {
      ...nativeEnvironment.fileSystem,
      lstat: async (path) => {
        const entry = await nativeEnvironment.fileSystem.lstat(path);
        if (resolve(path) === resolve(linkedApplications)) {
          Object.assign(entry, { isSymbolicLink: () => true });
        }
        return entry;
      },
    };
    const environment: MacInstallationEnvironment = {
      ...nativeEnvironment,
      systemApplicationsDirectory: otherApplications,
      userApplicationsDirectory: linkedApplications,
      fileSystem,
    };

    await assert.rejects(preflightMacInstallation(resources(staged.bundlePath), environment), /must be copied/);
    assert.equal(existsSync(resolve(environment.homeDirectory, ".feature-kanban")), false);
    assert.equal(existsSync(resolve(environment.homeDirectory, ".agents")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall restores an unchanged Skill backup and removes only the verified app", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-uninstall-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    writeSkill(target(environment), "user-original");
    await setupMacInstallation(resources(staged.bundlePath), environment);
    const sentinel = resolve(root, "keep.txt");
    writeFileSync(sentinel, "keep");
    const result = await uninstallMacApplication(resources(staged.bundlePath), environment);
    assert.equal(result.skillStatus, "restored-backup");
    assert.equal(result.appRemoved, true);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "user-original");
    assert.equal(existsSync(staged.bundlePath), false);
    assert.equal(existsSync(macInstallationRecordPath(environment)), false);
    assert.equal(readFileSync(sentinel, "utf8"), "keep");
    assert.equal(existsSync(resolve(environment.homeDirectory, ".feature-kanban", "skill-backups")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed backup staging during uninstall leaves no partial restore directory", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-uninstall-stage-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const nativeEnvironment = createEnvironment(fixture);
    writeSkill(target(nativeEnvironment), "user-original");
    await setupMacInstallation(resources(staged.bundlePath), nativeEnvironment);
    let injected = false;
    const fileSystem: MacInstallationFileSystem = {
      ...nativeEnvironment.fileSystem,
      copyFile: async (source, destination) => {
        if (destination.includes(".feature-lifecycle.restore-")) {
          injected = true;
          await nativeEnvironment.fileSystem.copyFile(source, destination);
          throw new Error("simulated restore staging failure");
        }
        await nativeEnvironment.fileSystem.copyFile(source, destination);
      },
    };
    const environment = { ...nativeEnvironment, fileSystem };

    await assert.rejects(
      uninstallMacApplication(resources(staged.bundlePath), environment),
      /simulated restore staging failure/,
    );

    assert.equal(injected, true);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "packaged-v1");
    assert.equal(existsSync(staged.bundlePath), true);
    assert.equal(existsSync(macInstallationRecordPath(environment)), true);
    assert.equal(
      readdirSync(dirname(target(environment))).some((name) => name.startsWith(".feature-lifecycle.restore-")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall holds its primary lease through app and record deletion", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-uninstall-lock-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const nativeEnvironment = createEnvironment(fixture);
    await setupMacInstallation(resources(staged.bundlePath), nativeEnvironment);
    let leaseHeld = false;
    let appRemovedWhileHeld = false;
    const fileSystem: MacInstallationFileSystem = {
      ...nativeEnvironment.fileSystem,
      remove: async (path, options) => {
        if (path === staged.bundlePath) {
          appRemovedWhileHeld = leaseHeld;
        }
        await nativeEnvironment.fileSystem.remove(path, options);
      },
    };
    const environment: MacInstallationEnvironment = {
      ...nativeEnvironment,
      fileSystem,
      acquireUninstallLease: async () => {
        leaseHeld = true;
        return { primary: true, close: async () => { leaseHeld = false; } };
      },
    };
    await uninstallMacApplication(resources(staged.bundlePath), environment);
    assert.equal(appRemovedWhileHeld, true);
    assert.equal(leaseHeld, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall preserves modified or missing Skill state and its manual backup", async () => {
  for (const scenario of ["modified", "missing"] as const) {
    const root = mkdtempSync(resolve(tmpdir(), `feature-kanban-mac-${scenario}-`));
    try {
      const fixture = createMacTestFixture(root);
      const staged = await fixture.stage();
      const environment = createEnvironment(fixture);
      writeSkill(target(environment), "user-original");
      const installed = await setupMacInstallation(resources(staged.bundlePath), environment);
      const backup = installed.installationRecord.skill!.backupPath!;
      if (scenario === "modified") writeFileSync(resolve(target(environment), "SKILL.md"), "user-modified");
      else rmSync(target(environment), { recursive: true, force: true });
      const result = await uninstallMacApplication(resources(staged.bundlePath), environment);
      assert.equal(result.skillStatus, scenario === "modified" ? "preserved-modified" : "target-missing");
      assert.equal(result.manualRecoveryPath, backup);
      assert.equal(existsSync(backup), true);
      if (scenario === "modified") assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "user-modified");
      else assert.equal(existsSync(target(environment)), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("active launcher and mismatched record identity block uninstall before mutation", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-guard-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    writeSkill(target(environment), "user-original");
    await setupMacInstallation(resources(staged.bundlePath), environment);
    const activeEnvironment = {
      ...environment,
      acquireUninstallLease: async () => ({ primary: false, close: async () => {} }),
    };
    await assert.rejects(uninstallMacApplication(resources(staged.bundlePath), activeEnvironment), /currently running/);
    assert.equal(existsSync(staged.bundlePath), true);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "packaged-v1");

    const record = readRecord(environment);
    const invalidBackupRecord: MacInstallationRecord = {
      ...record,
      skill: record.skill ? { ...record.skill, backupPath: "relative-backup" } : null,
    };
    writeFileSync(macInstallationRecordPath(environment), JSON.stringify(invalidBackupRecord));
    await assert.rejects(uninstallMacApplication(resources(staged.bundlePath), environment), /Skill backup path is invalid/);
    assert.equal(existsSync(staged.bundlePath), true);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "packaged-v1");

    record.bundlePath = resolve(root, "other", "Feature Kanban.app");
    writeFileSync(macInstallationRecordPath(environment), JSON.stringify(record));
    await assert.rejects(uninstallMacApplication(resources(staged.bundlePath), environment), /outside its allowed path/);
    assert.equal(existsSync(staged.bundlePath), true);
    assert.equal(readFileSync(resolve(target(environment), "SKILL.md"), "utf8"), "packaged-v1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tampered identity, wrong app name, and a symlinked bundle never trigger recursive cleanup", async (context) => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-unsafe-"));
  try {
    const fixture = createMacTestFixture(root);
    let staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    writeSkill(target(environment), "user-original");
    await setupMacInstallation(resources(staged.bundlePath), environment);
    const sentinel = resolve(root, "sentinel.txt");
    writeFileSync(sentinel, "keep");

    const plist = resolve(staged.bundlePath, "Contents", "Info.plist");
    writeFileSync(plist, readFileSync(plist, "utf8").replace("com.featurekanban.app", "com.invalid.app"));
    await writeMacPackageManifest(staged.bundlePath, {
      productVersion: "0.1.0", architecture: "arm64", nodeVersion: "v24.15.0",
    });
    await assert.rejects(uninstallMacApplication(resources(staged.bundlePath), environment), /bundle identifier/);
    assert.equal(readFileSync(sentinel, "utf8"), "keep");

    staged = await fixture.stage();
    const record = readRecord(environment);
    record.bundlePath = staged.bundlePath;
    writeFileSync(macInstallationRecordPath(environment), JSON.stringify(record));
    const wrongName = resolve(dirname(staged.bundlePath), "Wrong.app");
    renameSync(staged.bundlePath, wrongName);
    await assert.rejects(uninstallMacApplication(resources(wrongName), environment), /Unexpected macOS app bundle name/);
    renameSync(wrongName, staged.bundlePath);

    const realBundle = resolve(root, "held", "Feature Kanban.app");
    mkdirSync(dirname(realBundle), { recursive: true });
    renameSync(staged.bundlePath, realBundle);
    try { symlinkSync(realBundle, staged.bundlePath, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      renameSync(realBundle, staged.bundlePath);
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") { context.skip("Host does not permit directory symlink fixtures"); return; }
      throw error;
    }
    await assert.rejects(uninstallMacApplication(resources(staged.bundlePath), environment), /non-symbolic-link/);
    assert.equal(readFileSync(sentinel, "utf8"), "keep");
    assert.equal(existsSync(realBundle), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall refuses a same-path app replacement after package verification", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-replaced-app-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const nativeEnvironment = createEnvironment(fixture);
    writeSkill(target(nativeEnvironment), "user-original");
    await setupMacInstallation(resources(staged.bundlePath), nativeEnvironment);
    const heldBundle = resolve(root, "held", "Feature Kanban.app");
    const replacementSentinel = resolve(staged.bundlePath, "replacement.txt");
    let bundleStats = 0;
    const fileSystem: MacInstallationFileSystem = {
      ...nativeEnvironment.fileSystem,
      lstat: async (path) => {
        if (path === staged.bundlePath && ++bundleStats === 3) {
          mkdirSync(dirname(heldBundle), { recursive: true });
          renameSync(staged.bundlePath, heldBundle);
          mkdirSync(staged.bundlePath);
          writeFileSync(replacementSentinel, "keep", "utf8");
        }
        return nativeEnvironment.fileSystem.lstat(path);
      },
    };
    const environment = { ...nativeEnvironment, fileSystem };
    await assert.rejects(uninstallMacApplication(resources(staged.bundlePath), environment), /unsafe app bundle/);
    assert.equal(readFileSync(replacementSentinel, "utf8"), "keep");
    assert.equal(existsSync(heldBundle), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a valid app moved outside Applications handles the Skill but requires manual Trash removal", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-mac-nonstandard-"));
  try {
    const fixture = createMacTestFixture(root);
    const staged = await fixture.stage();
    const environment = createEnvironment(fixture);
    writeSkill(target(environment), "user-original");
    await setupMacInstallation(resources(staged.bundlePath), environment);
    const movedBundle = resolve(root, "diagnostics", "Feature Kanban.app");
    mkdirSync(dirname(movedBundle), { recursive: true });
    renameSync(staged.bundlePath, movedBundle);
    const result = await uninstallMacApplication(resources(movedBundle), environment);
    assert.equal(result.skillStatus, "restored-backup");
    assert.equal(result.appRemoved, false);
    assert.equal(result.recordRemoved, false);
    assert.equal(existsSync(movedBundle), true);
    assert.equal(existsSync(macInstallationRecordPath(environment)), true);
    assert.match(result.message, /Trash manually/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
