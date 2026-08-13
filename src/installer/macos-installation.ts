import { createHash, randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { acquireSingleInstance, launcherEndpoint } from "../launcher/single-instance.js";
import {
  MAC_BUNDLE_NAME,
  MAC_PACKAGE_PRODUCT,
  isSemanticVersion,
  verifyMacAppBundle,
  type MacPackageManifest,
} from "./macos-package.js";

export const MAC_INSTALLATION_FORMAT_VERSION = 1;
export const MAC_INSTALLATION_RECORD_NAME = "macos-installation.json";

export interface MacInstallationFileSystem {
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  readBuffer(path: string): Promise<Buffer>;
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string, options?: { mode?: number }): Promise<void>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<Dirent[]>;
  copyFile(source: string, destination: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  remove(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

export interface MacInstallationEnvironment {
  homeDirectory: string;
  systemApplicationsDirectory: string;
  userApplicationsDirectory: string;
  fileSystem: MacInstallationFileSystem;
  now(): Date;
  operationId(): string;
  acquireUninstallLease(endpoint: string): Promise<{ primary: boolean; close(): Promise<void> }>;
}

export interface MacSkillRecord {
  target: string;
  installedHash: string;
  backupPath: string | null;
}

export interface MacInstallationRecord {
  formatVersion: typeof MAC_INSTALLATION_FORMAT_VERSION;
  product: typeof MAC_PACKAGE_PRODUCT;
  version: string;
  bundlePath: string;
  installedAt: string;
  skill: MacSkillRecord | null;
  skillFailure: string | null;
}

export interface MacSetupResult {
  bundlePath: string;
  manifest: MacPackageManifest;
  installationRecord: MacInstallationRecord;
  skillFailure?: string;
}

export interface MacInstallationPreflight {
  bundlePath: string;
  manifest: MacPackageManifest;
}

export type MacSkillUninstallStatus =
  | "not-managed"
  | "removed-installed"
  | "restored-backup"
  | "preserved-modified"
  | "target-missing"
  | "backup-missing"
  | "preserved-unsafe";

export interface MacUninstallResult {
  bundlePath: string;
  appRemoved: boolean;
  recordRemoved: boolean;
  skillStatus: MacSkillUninstallStatus;
  manualRecoveryPath?: string;
  message: string;
}

const nativeMacInstallationFileSystem: MacInstallationFileSystem = {
  lstat,
  realpath,
  readBuffer: async (path) => readFile(path),
  readText: (path) => readFile(path, "utf8"),
  writeText: async (path, contents, options) => writeFile(path, contents, {
    encoding: "utf8",
    mode: options?.mode,
  }),
  mkdir: async (path) => { await mkdir(path, { recursive: true }); },
  readdir: (path) => readdir(path, { withFileTypes: true }),
  copyFile,
  chmod,
  rename,
  remove: (path, options) => rm(path, options),
};

export function productionMacInstallationEnvironment(): MacInstallationEnvironment {
  const homeDirectory = homedir();
  return {
    homeDirectory,
    systemApplicationsDirectory: "/Applications",
    userApplicationsDirectory: resolve(homeDirectory, "Applications"),
    fileSystem: nativeMacInstallationFileSystem,
    now: () => new Date(),
    operationId: () => randomUUID().replaceAll("-", ""),
    acquireUninstallLease: (endpoint) => acquireSingleInstance(endpoint, "probe"),
  };
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function pathExists(fileSystem: MacInstallationFileSystem, path: string): Promise<boolean> {
  try { await fileSystem.lstat(path); return true; }
  catch (error) { if (isMissingPath(error)) return false; throw error; }
}

function isStrictlyWithin(path: string, root: string): boolean {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function assertExactPath(actual: string, expected: string, label: string): void {
  if (resolve(actual) !== resolve(expected)) throw new Error(`${label} is outside its allowed path: ${actual}`);
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertNonSymlinkDirectoryChain(
  root: string,
  target: string,
  fileSystem: MacInstallationFileSystem,
  label: string,
): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (!isStrictlyWithin(resolvedTarget, resolvedRoot)) throw new Error(`${label} escapes the user home directory`);
  const rootEntry = await fileSystem.lstat(resolvedRoot);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error(`${label} has an unsafe user home directory`);
  }
  const canonicalRoot = await fileSystem.realpath(resolvedRoot);
  let current = resolvedRoot;
  for (const segment of relative(resolvedRoot, resolvedTarget).split(sep)) {
    current = resolve(current, segment);
    let entry: Stats;
    try { entry = await fileSystem.lstat(current); }
    catch (error) { if (isMissingPath(error)) return; throw error; }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`${label} contains an unsafe path component: ${current}`);
    }
    const canonicalCurrent = await fileSystem.realpath(current);
    if (!isStrictlyWithin(canonicalCurrent, canonicalRoot)) {
      throw new Error(`${label} escapes the canonical user home directory: ${current}`);
    }
  }
}

async function assertSafeDataRoot(environment: MacInstallationEnvironment): Promise<void> {
  await assertNonSymlinkDirectoryChain(
    environment.homeDirectory,
    dataRoot(environment),
    environment.fileSystem,
    "Feature Kanban data directory",
  );
}

function dataRoot(environment: MacInstallationEnvironment): string {
  return resolve(environment.homeDirectory, ".feature-kanban");
}

function backupRoot(environment: MacInstallationEnvironment): string {
  return resolve(dataRoot(environment), "skill-backups");
}

function skillTarget(environment: MacInstallationEnvironment): string {
  return resolve(environment.homeDirectory, ".agents", "skills", "feature-lifecycle");
}

export function macInstallationRecordPath(environment = productionMacInstallationEnvironment()): string {
  return resolve(dataRoot(environment), MAC_INSTALLATION_RECORD_NAME);
}

export function deriveMacBundlePath(resourceRoot: string): string {
  const resources = resolve(resourceRoot);
  if (basename(resources) !== "Resources" || basename(dirname(resources)) !== "Contents") {
    throw new Error(`FEATURE_KANBAN_INSTALL_ROOT is not a macOS app Resources directory: ${resourceRoot}`);
  }
  const bundle = resolve(resources, "..", "..");
  if (basename(bundle) !== MAC_BUNDLE_NAME) throw new Error(`Unexpected macOS app bundle name: ${basename(bundle)}`);
  return bundle;
}

async function canonicalStandardBundlePaths(environment: MacInstallationEnvironment): Promise<string[]> {
  const paths: string[] = [];
  for (const applications of [environment.systemApplicationsDirectory, environment.userApplicationsDirectory]) {
    let canonicalApplications: string;
    try {
      const entry = await environment.fileSystem.lstat(applications);
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      canonicalApplications = await environment.fileSystem.realpath(applications);
    }
    catch (error) {
      if (!isMissingPath(error)) throw error;
      canonicalApplications = resolve(applications);
    }
    paths.push(resolve(canonicalApplications, MAC_BUNDLE_NAME));
  }
  return paths;
}

async function inspectBundle(
  resourceRoot: string,
  environment: MacInstallationEnvironment,
  requireStandardLocation: boolean,
): Promise<{ bundlePath: string; bundleIdentity: Stats; manifest: MacPackageManifest; standardLocation: boolean }> {
  const lexicalBundle = deriveMacBundlePath(resourceRoot);
  const bundleEntry = await environment.fileSystem.lstat(lexicalBundle);
  if (!bundleEntry.isDirectory() || bundleEntry.isSymbolicLink()) {
    throw new Error("Feature Kanban.app must be a non-symbolic-link directory");
  }
  const canonicalBundle = await environment.fileSystem.realpath(lexicalBundle);
  const canonicalResources = await environment.fileSystem.realpath(resolve(lexicalBundle, "Contents", "Resources"));
  assertExactPath(canonicalResources, resolve(canonicalBundle, "Contents", "Resources"), "App resource directory");
  const standardPaths = await canonicalStandardBundlePaths(environment);
  const standardLocation = standardPaths.includes(canonicalBundle);
  if (requireStandardLocation && !standardLocation) {
    throw new Error(
      `Feature Kanban must be copied to ${standardPaths.join(" or ")} before it is launched; no user state was changed.`,
    );
  }
  const verified = await verifyMacAppBundle(canonicalBundle);
  const verifiedEntry = await environment.fileSystem.lstat(canonicalBundle);
  if (
    !verifiedEntry.isDirectory()
    || verifiedEntry.isSymbolicLink()
    || !sameFileIdentity(bundleEntry, verifiedEntry)
  ) {
    throw new Error("Feature Kanban.app changed while its package identity was being verified");
  }
  return {
    bundlePath: canonicalBundle,
    bundleIdentity: verifiedEntry,
    manifest: verified.manifest,
    standardLocation,
  };
}

async function collectDirectoryFiles(
  root: string,
  fileSystem: MacInstallationFileSystem,
): Promise<Array<{ relativePath: string; contents: Buffer }>> {
  const rootEntry = await fileSystem.lstat(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error(`Expected a non-symbolic-link directory: ${root}`);
  }
  const files: Array<{ relativePath: string; contents: Buffer }> = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await fileSystem.readdir(directory);
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Directory cannot contain symbolic links: ${relativePath}`);
      if (entry.isDirectory()) await visit(path, relativePath);
      else if (entry.isFile()) files.push({ relativePath, contents: await fileSystem.readBuffer(path) });
      else throw new Error(`Directory contains an unsupported entry: ${relativePath}`);
    }
  };
  await visit(root, "");
  return files;
}

export async function hashMacDirectory(
  path: string,
  fileSystem: MacInstallationFileSystem = nativeMacInstallationFileSystem,
): Promise<string | undefined> {
  try {
    const files = await collectDirectoryFiles(path, fileSystem);
    const lines = files.map(({ relativePath, contents }) => (
      `${relativePath}\t${createHash("sha256").update(contents).digest("hex")}`
    ));
    return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
  } catch (error) {
    if (isMissingPath(error)) return undefined;
    throw error;
  }
}

async function copyDirectory(
  source: string,
  destination: string,
  fileSystem: MacInstallationFileSystem,
): Promise<void> {
  const sourceEntry = await fileSystem.lstat(source);
  if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink()) {
    throw new Error(`Copy source must be a non-symbolic-link directory: ${source}`);
  }
  if (await pathExists(fileSystem, destination)) throw new Error(`Copy destination already exists: ${destination}`);
  await fileSystem.mkdir(destination);
  const copyEntries = async (sourceDirectory: string, destinationDirectory: string): Promise<void> => {
    const entries = await fileSystem.readdir(sourceDirectory);
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const sourcePath = resolve(sourceDirectory, entry.name);
      const destinationPath = resolve(destinationDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing to copy symbolic link: ${sourcePath}`);
      if (entry.isDirectory()) {
        await fileSystem.mkdir(destinationPath);
        await copyEntries(sourcePath, destinationPath);
      } else if (entry.isFile()) {
        const metadata = await fileSystem.lstat(sourcePath);
        await fileSystem.copyFile(sourcePath, destinationPath);
        await fileSystem.chmod(destinationPath, metadata.mode & 0o777);
      } else {
        throw new Error(`Refusing to copy unsupported entry: ${sourcePath}`);
      }
    }
  };
  await copyEntries(source, destination);
}

function validateSkillRecord(value: unknown, environment: MacInstallationEnvironment): MacSkillRecord {
  if (!value || typeof value !== "object") throw new Error("macOS installation Skill record is invalid");
  const record = value as Partial<MacSkillRecord>;
  const allowedTarget = skillTarget(environment);
  if (
    typeof record.target !== "string"
    || !isAbsolute(record.target)
    || resolve(record.target) !== record.target
  ) {
    throw new Error("macOS installation Skill target is invalid");
  }
  assertExactPath(record.target, allowedTarget, "Skill target");
  if (typeof record.installedHash !== "string" || !/^[0-9a-f]{64}$/u.test(record.installedHash)) {
    throw new Error("macOS installation Skill hash is invalid");
  }
  if (record.backupPath !== null && record.backupPath !== undefined) {
    if (
      typeof record.backupPath !== "string"
      || !isAbsolute(record.backupPath)
      || resolve(record.backupPath) !== record.backupPath
      || !isStrictlyWithin(record.backupPath, backupRoot(environment))
    ) {
      throw new Error("macOS installation Skill backup path is invalid");
    }
  }
  return {
    target: allowedTarget,
    installedHash: record.installedHash,
    backupPath: record.backupPath ?? null,
  };
}

function parseInstallationRecord(value: unknown, environment: MacInstallationEnvironment): MacInstallationRecord {
  if (!value || typeof value !== "object") throw new Error("macOS installation record is invalid");
  const record = value as Partial<MacInstallationRecord>;
  if (record.formatVersion !== MAC_INSTALLATION_FORMAT_VERSION || record.product !== MAC_PACKAGE_PRODUCT) {
    throw new Error("macOS installation record identity is invalid");
  }
  if (typeof record.version !== "string" || !isSemanticVersion(record.version)) {
    throw new Error("macOS installation record version is invalid");
  }
  if (
    typeof record.bundlePath !== "string"
    || !isAbsolute(record.bundlePath)
    || resolve(record.bundlePath) !== record.bundlePath
    || basename(record.bundlePath) !== MAC_BUNDLE_NAME
  ) {
    throw new Error("macOS installation record bundle path is invalid");
  }
  if (typeof record.installedAt !== "string" || !Number.isFinite(Date.parse(record.installedAt))) {
    throw new Error("macOS installation timestamp is invalid");
  }
  if (record.skillFailure !== null && record.skillFailure !== undefined && typeof record.skillFailure !== "string") {
    throw new Error("macOS installation Skill failure is invalid");
  }
  return {
    formatVersion: MAC_INSTALLATION_FORMAT_VERSION,
    product: MAC_PACKAGE_PRODUCT,
    version: record.version,
    bundlePath: record.bundlePath,
    installedAt: record.installedAt,
    skill: record.skill ? validateSkillRecord(record.skill, environment) : null,
    skillFailure: record.skillFailure?.slice(0, 1000) ?? null,
  };
}

async function readInstallationRecord(
  environment: MacInstallationEnvironment,
  required: boolean,
): Promise<MacInstallationRecord | undefined> {
  const path = macInstallationRecordPath(environment);
  try {
    const entry = await environment.fileSystem.lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error("macOS installation record must be a regular non-symbolic-link file");
    }
    return parseInstallationRecord(JSON.parse(await environment.fileSystem.readText(path)), environment);
  } catch (error) {
    if (!required && isMissingPath(error)) return undefined;
    if (error instanceof SyntaxError) throw new Error(`macOS installation record is unreadable: ${error.message}`);
    throw error;
  }
}

function boundedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}

class MacSkillRecoveryFailure extends Error {}

interface SkillReplacementTransaction {
  record: MacSkillRecord;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

async function prepareSkillReplacement(
  source: string,
  previous: MacSkillRecord | null,
  environment: MacInstallationEnvironment,
): Promise<SkillReplacementTransaction> {
  const fileSystem = environment.fileSystem;
  const target = skillTarget(environment);
  const targetParent = dirname(target);
  const backups = backupRoot(environment);
  await assertNonSymlinkDirectoryChain(environment.homeDirectory, targetParent, fileSystem, "Skill target");
  await assertNonSymlinkDirectoryChain(environment.homeDirectory, backups, fileSystem, "Skill backup root");
  const sourceHash = await hashMacDirectory(source, fileSystem);
  if (!sourceHash) throw new Error(`Packaged feature-lifecycle Skill is missing: ${source}`);
  let currentHash = await hashMacDirectory(target, fileSystem);
  if (previous && currentHash !== undefined && sourceHash === previous.installedHash) {
    return { record: previous, commit: async () => {}, rollback: async () => {} };
  }
  await fileSystem.mkdir(targetParent);
  await fileSystem.mkdir(backups);
  await assertNonSymlinkDirectoryChain(environment.homeDirectory, targetParent, fileSystem, "Skill target");
  await assertNonSymlinkDirectoryChain(environment.homeDirectory, backups, fileSystem, "Skill backup root");
  const operationId = environment.operationId();
  const stagedPath = resolve(targetParent, `.feature-lifecycle.install-${operationId}`);
  const rollbackPath = resolve(targetParent, `.feature-lifecycle.rollback-${operationId}`);
  let backupPath: string | null = null;
  let createdBackupPath: string | null = null;
  let hadTarget = false;
  let targetDisplaced = false;
  let replacementInstalled = false;
  let preserveRollback = false;
  try {
    await copyDirectory(source, stagedPath, fileSystem);
    if (await hashMacDirectory(stagedPath, fileSystem) !== sourceHash) {
      throw new Error("Staged feature-lifecycle Skill hash does not match its packaged source");
    }
    if (await pathExists(fileSystem, target)) {
      const targetEntry = await fileSystem.lstat(target);
      if (!targetEntry.isDirectory() || targetEntry.isSymbolicLink()) {
        throw new Error(`Skill target must be a non-symbolic-link directory: ${target}`);
      }
      hadTarget = true;
      currentHash = await hashMacDirectory(target, fileSystem);
      if (previous && currentHash === previous.installedHash) {
        backupPath = previous.backupPath;
      } else {
        const stamp = environment.now().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
        backupPath = resolve(backups, `feature-lifecycle-${stamp}-${operationId}`);
        createdBackupPath = backupPath;
        await copyDirectory(target, backupPath, fileSystem);
      }
      await fileSystem.rename(target, rollbackPath);
      targetDisplaced = true;
      if (
        createdBackupPath
        && await hashMacDirectory(createdBackupPath, fileSystem) !== await hashMacDirectory(rollbackPath, fileSystem)
      ) {
        throw new Error("Skill backup does not match the directory selected for replacement");
      }
    }
    if (!hadTarget && previous) backupPath = previous.backupPath;
    await fileSystem.rename(stagedPath, target);
    replacementInstalled = true;
    const installedHash = await hashMacDirectory(target, fileSystem);
    if (installedHash !== sourceHash) throw new Error("Installed feature-lifecycle Skill hash is invalid");
    const restore = async (): Promise<void> => {
      try {
        if (replacementInstalled && await pathExists(fileSystem, target)) {
          await fileSystem.remove(target, { recursive: true, force: false });
        }
        if (targetDisplaced) await fileSystem.rename(rollbackPath, target);
      } catch (recoveryError) {
        preserveRollback = true;
        throw new MacSkillRecoveryFailure(
          `Skill rollback failed; preserved recovery copy at ${rollbackPath}: ${boundedFailure(recoveryError)}`,
        );
      }
      if (createdBackupPath && await pathExists(fileSystem, createdBackupPath)) {
        await fileSystem.remove(createdBackupPath, { recursive: true, force: true });
      }
    };
    return {
      record: { target, installedHash, backupPath },
      commit: async () => {
        if (targetDisplaced && await pathExists(fileSystem, rollbackPath)) {
          await fileSystem.remove(rollbackPath, { recursive: true, force: true });
        }
      },
      rollback: restore,
    };
  } catch (installationError) {
    try {
      if (replacementInstalled && await pathExists(fileSystem, target)) {
        await fileSystem.remove(target, { recursive: true, force: false });
      }
      if (targetDisplaced) await fileSystem.rename(rollbackPath, target);
    } catch (recoveryError) {
      preserveRollback = true;
      throw new MacSkillRecoveryFailure(
        `Skill installation failed and automatic recovery failed. Recovery copy: ${rollbackPath}. `
        + `Install error: ${boundedFailure(installationError)}. Recovery error: ${boundedFailure(recoveryError)}`,
      );
    } finally {
      if (await pathExists(fileSystem, stagedPath)) {
        await fileSystem.remove(stagedPath, { recursive: true, force: true });
      }
      if (!preserveRollback && !hadTarget && await pathExists(fileSystem, rollbackPath)) {
        await fileSystem.remove(rollbackPath, { recursive: true, force: true });
      }
      if (!preserveRollback && createdBackupPath && await pathExists(fileSystem, createdBackupPath)) {
        await fileSystem.remove(createdBackupPath, { recursive: true, force: true });
      }
    }
    throw installationError;
  }
}

async function writeInstallationRecordAtomically(
  record: MacInstallationRecord,
  environment: MacInstallationEnvironment,
): Promise<void> {
  const fileSystem = environment.fileSystem;
  const path = macInstallationRecordPath(environment);
  await fileSystem.mkdir(dirname(path));
  await assertSafeDataRoot(environment);
  const temporaryPath = resolve(dirname(path), `.${MAC_INSTALLATION_RECORD_NAME}.${environment.operationId()}.tmp`);
  try {
    await fileSystem.writeText(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await fileSystem.rename(temporaryPath, path);
  } catch (error) {
    if (await pathExists(fileSystem, temporaryPath)) {
      await fileSystem.remove(temporaryPath, { recursive: false, force: true });
    }
    throw error;
  }
}

export async function setupMacInstallation(
  resourceRoot: string,
  environment = productionMacInstallationEnvironment(),
): Promise<MacSetupResult> {
  const inspected = await inspectBundle(resourceRoot, environment, true);
  await assertSafeDataRoot(environment);
  const previous = await readInstallationRecord(environment, false);
  const packagedSkill = resolve(
    inspected.bundlePath,
    "Contents",
    "Resources",
    "app",
    "skills",
    "feature-lifecycle",
  );
  let transaction: SkillReplacementTransaction | undefined;
  let skill = previous?.skill ?? null;
  let skillFailure: string | undefined;
  try {
    transaction = await prepareSkillReplacement(packagedSkill, previous?.skill ?? null, environment);
    skill = transaction.record;
  } catch (error) {
    if (error instanceof MacSkillRecoveryFailure) throw error;
    skillFailure = boundedFailure(error);
  }
  const record: MacInstallationRecord = {
    formatVersion: MAC_INSTALLATION_FORMAT_VERSION,
    product: MAC_PACKAGE_PRODUCT,
    version: inspected.manifest.productVersion,
    bundlePath: inspected.bundlePath,
    installedAt: environment.now().toISOString(),
    skill,
    skillFailure: skillFailure ?? null,
  };
  try {
    await writeInstallationRecordAtomically(record, environment);
  } catch (recordError) {
    if (transaction) {
      try { await transaction.rollback(); }
      catch (rollbackError) {
        throw new Error(
          `Installation record commit failed and Skill rollback also failed. `
          + `Record error: ${boundedFailure(recordError)}. Rollback error: ${boundedFailure(rollbackError)}`,
        );
      }
    }
    throw new Error(`Installation record commit failed; Skill state was restored: ${boundedFailure(recordError)}`);
  }
  await transaction?.commit();
  return {
    bundlePath: inspected.bundlePath,
    manifest: inspected.manifest,
    installationRecord: record,
    ...(skillFailure ? { skillFailure } : {}),
  };
}

export async function preflightMacInstallation(
  resourceRoot: string,
  environment = productionMacInstallationEnvironment(),
): Promise<MacInstallationPreflight> {
  const inspected = await inspectBundle(resourceRoot, environment, true);
  await assertSafeDataRoot(environment);
  return { bundlePath: inspected.bundlePath, manifest: inspected.manifest };
}

async function validateBackupForRestore(
  backupPath: string,
  environment: MacInstallationEnvironment,
): Promise<boolean> {
  await assertNonSymlinkDirectoryChain(
    environment.homeDirectory,
    backupRoot(environment),
    environment.fileSystem,
    "Skill backup root",
  );
  if (!isStrictlyWithin(resolve(backupPath), backupRoot(environment))) {
    throw new Error(`Recorded Skill backup is outside the allowed backup root: ${backupPath}`);
  }
  try {
    const entry = await environment.fileSystem.lstat(backupPath);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Recorded Skill backup is unsafe: ${backupPath}`);
    const canonicalBackup = await environment.fileSystem.realpath(backupPath);
    const canonicalRoot = await environment.fileSystem.realpath(backupRoot(environment));
    if (!isStrictlyWithin(canonicalBackup, canonicalRoot)) throw new Error(`Recorded Skill backup escapes its root: ${backupPath}`);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

async function restoreSkillDuringUninstall(
  record: MacSkillRecord | null,
  environment: MacInstallationEnvironment,
): Promise<{ status: MacSkillUninstallStatus; manualRecoveryPath?: string }> {
  if (!record) return { status: "not-managed" };
  const fileSystem = environment.fileSystem;
  const target = skillTarget(environment);
  assertExactPath(record.target, target, "Skill target");
  try {
    await assertNonSymlinkDirectoryChain(environment.homeDirectory, dirname(target), fileSystem, "Skill target");
  } catch {
    return {
      status: "preserved-unsafe",
      ...(record.backupPath ? { manualRecoveryPath: record.backupPath } : {}),
    };
  }
  let entry: Stats;
  try { entry = await fileSystem.lstat(target); }
  catch (error) {
    if (isMissingPath(error)) return {
      status: "target-missing",
      ...(record.backupPath ? { manualRecoveryPath: record.backupPath } : {}),
    };
    throw error;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) return {
    status: "preserved-unsafe",
    ...(record.backupPath ? { manualRecoveryPath: record.backupPath } : {}),
  };
  let currentHash: string | undefined;
  try { currentHash = await hashMacDirectory(target, fileSystem); }
  catch { return {
    status: "preserved-unsafe",
    ...(record.backupPath ? { manualRecoveryPath: record.backupPath } : {}),
  }; }
  if (currentHash !== record.installedHash) return {
    status: "preserved-modified",
    ...(record.backupPath ? { manualRecoveryPath: record.backupPath } : {}),
  };
  if (!record.backupPath) {
    await fileSystem.remove(target, { recursive: true, force: false });
    return { status: "removed-installed" };
  }
  if (!await validateBackupForRestore(record.backupPath, environment)) {
    return { status: "backup-missing", manualRecoveryPath: record.backupPath };
  }
  const operationId = environment.operationId();
  const stagedPath = resolve(dirname(target), `.feature-lifecycle.restore-${operationId}`);
  const rollbackPath = resolve(dirname(target), `.feature-lifecycle.uninstall-${operationId}`);
  try {
    await copyDirectory(record.backupPath, stagedPath, fileSystem);
    const backupHash = await hashMacDirectory(record.backupPath, fileSystem);
    await fileSystem.rename(target, rollbackPath);
    try {
      await fileSystem.rename(stagedPath, target);
      if (await hashMacDirectory(target, fileSystem) !== backupHash) {
        throw new Error("Restored Skill backup hash is invalid");
      }
      await fileSystem.remove(rollbackPath, { recursive: true, force: true });
    } catch (restoreError) {
      try {
        if (await pathExists(fileSystem, target)) await fileSystem.remove(target, { recursive: true, force: true });
        await fileSystem.rename(rollbackPath, target);
      } catch (recoveryError) {
        throw new Error(
          `Skill uninstall recovery failed; preserved rollback copy at ${rollbackPath}. `
          + `Restore error: ${boundedFailure(restoreError)}. Recovery error: ${boundedFailure(recoveryError)}`,
        );
      }
      throw restoreError;
    }
  } finally {
    if (await pathExists(fileSystem, stagedPath)) {
      await fileSystem.remove(stagedPath, { recursive: true, force: true });
    }
  }
  return { status: "restored-backup" };
}

export async function uninstallMacApplication(
  resourceRoot: string,
  environment = productionMacInstallationEnvironment(),
): Promise<MacUninstallResult> {
  await assertSafeDataRoot(environment);
  const endpoint = launcherEndpoint(environment.homeDirectory, "darwin");
  const lease = await environment.acquireUninstallLease(endpoint);
  if (!lease.primary) {
    await lease.close();
    throw new Error("Feature Kanban is currently running. Close the managed ChatGPT/Codex instance before uninstalling.");
  }
  try {
    const record = await readInstallationRecord(environment, true);
    if (!record) throw new Error("macOS installation record is missing");
    const inspected = await inspectBundle(resourceRoot, environment, false);
    const standardPaths = await canonicalStandardBundlePaths(environment);
    if (resolve(inspected.bundlePath) !== resolve(record.bundlePath)) {
      const recordedStandardPath = standardPaths.includes(resolve(record.bundlePath));
      if (inspected.standardLocation || !recordedStandardPath || await pathExists(environment.fileSystem, record.bundlePath)) {
        throw new Error(`Installation record bundle is outside its allowed path: ${record.bundlePath}`);
      }
    }
    if (record.version !== inspected.manifest.productVersion) {
      throw new Error("Installation record version does not match the app bundle");
    }
    const skillResult = await restoreSkillDuringUninstall(record.skill, environment);
    if (!inspected.standardLocation) {
      return {
        bundlePath: inspected.bundlePath,
        appRemoved: false,
        recordRemoved: false,
        skillStatus: skillResult.status,
        manualRecoveryPath: skillResult.manualRecoveryPath ?? inspected.bundlePath,
        message: "Skill handling completed, but this nonstandard app location must be moved to Trash manually.",
      };
    }
    const bundleEntry = await environment.fileSystem.lstat(inspected.bundlePath);
    if (
      !bundleEntry.isDirectory()
      || bundleEntry.isSymbolicLink()
      || !sameFileIdentity(bundleEntry, inspected.bundleIdentity)
    ) {
      throw new Error("Refusing to remove an unsafe app bundle");
    }
    if (!standardPaths.includes(await environment.fileSystem.realpath(inspected.bundlePath))) {
      throw new Error("Refusing to remove an app outside the allowed Applications directories");
    }
    await environment.fileSystem.remove(inspected.bundlePath, { recursive: true, force: false });
    await environment.fileSystem.remove(macInstallationRecordPath(environment), { recursive: false, force: false });
    return {
      bundlePath: inspected.bundlePath,
      appRemoved: true,
      recordRemoved: true,
      skillStatus: skillResult.status,
      ...(skillResult.manualRecoveryPath ? { manualRecoveryPath: skillResult.manualRecoveryPath } : {}),
      message: "Feature Kanban.app was removed. ~/.feature-kanban data and Skill backups were preserved.",
    };
  } finally {
    await lease.close();
  }
}
