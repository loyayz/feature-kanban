import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export const MAC_PACKAGE_FORMAT_VERSION = 1;
export const MAC_PACKAGE_PRODUCT = "feature-kanban";
export const MAC_BUNDLE_IDENTIFIER = "com.featurekanban.app";
export const MAC_BUNDLE_NAME = "Feature Kanban.app";
export const MAC_BUNDLE_EXECUTABLE = "FeatureKanbanBootstrap";
export const MAC_PACKAGE_MANIFEST_PATH = "Contents/Resources/package-manifest.json";

export type MacArchitecture = "arm64" | "x64";

export interface MacPackageFile {
  path: string;
  integrity: "sha256" | "outer-code-signature";
  size: number | null;
  mode: number;
  sha256: string | null;
}

export interface MacPackageManifest {
  formatVersion: typeof MAC_PACKAGE_FORMAT_VERSION;
  product: typeof MAC_PACKAGE_PRODUCT;
  productVersion: string;
  platform: "darwin";
  architecture: MacArchitecture;
  nodeVersion: string;
  files: MacPackageFile[];
}

export interface MacPackageIdentity {
  productVersion: string;
  architecture: MacArchitecture;
  nodeVersion: string;
}

export interface VerifiedMacAppBundle {
  bundleRoot: string;
  manifest: MacPackageManifest;
  fileCount: number;
}

export const MAC_REQUIRED_PAYLOAD_FILES = [
  "Contents/Info.plist",
  `Contents/MacOS/${MAC_BUNDLE_EXECUTABLE}`,
  "Contents/MacOS/FeatureKanbanNode",
  "Contents/Resources/app/server/server/index.js",
  "Contents/Resources/app/server/launcher/index.js",
  "Contents/Resources/app/server/installer/macos-installation.js",
  "Contents/Resources/app/web/browser/index.html",
  "Contents/Resources/app/inject/feature-kanban.user.js",
  "Contents/Resources/app/skills/feature-lifecycle/SKILL.md",
  "Contents/Resources/app/skills/feature-lifecycle/references/feature-kanban-api.md",
] as const;

const executablePayloads = new Set([
  `Contents/MacOS/${MAC_BUNDLE_EXECUTABLE}`,
  "Contents/MacOS/FeatureKanbanNode",
]);

const outerSignedMainExecutable = `Contents/MacOS/${MAC_BUNDLE_EXECUTABLE}`;

function isWithin(path: string, root: string): boolean {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function isExcludedStablePath(path: string): boolean {
  return path === MAC_PACKAGE_MANIFEST_PATH
    || path === "Contents/_CodeSignature"
    || path.startsWith("Contents/_CodeSignature/");
}

function validateManifestPath(path: unknown): string {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes("\0")) {
    throw new Error("Package manifest contains an invalid file path");
  }
  if (isAbsolute(path) || /^[A-Za-z]:/u.test(path)) {
    throw new Error(`Package manifest path must be relative: ${path}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Package manifest path contains traversal: ${path}`);
  }
  if (isExcludedStablePath(path)) {
    throw new Error(`Package manifest cannot list generated metadata: ${path}`);
  }
  return path;
}

function portableMode(path: string, actualMode: number): number {
  if (process.platform === "win32") return executablePayloads.has(path) ? 0o755 : 0o644;
  return actualMode & 0o777;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, reject) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolveHash);
  });
  return hash.digest("hex");
}

export async function readThinMachOArchitecture(path: string): Promise<MacArchitecture> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length) throw new Error(`Mach-O header is truncated: ${path}`);
    let cpuType: number;
    if (header.readUInt32LE(0) === 0xfeedfacf) cpuType = header.readUInt32LE(4);
    else if (header.readUInt32BE(0) === 0xfeedfacf) cpuType = header.readUInt32BE(4);
    else throw new Error(`Expected a thin 64-bit Mach-O executable: ${path}`);
    if (cpuType === 0x0100000c) return "arm64";
    if (cpuType === 0x01000007) return "x64";
    throw new Error(`Unsupported Mach-O CPU type 0x${cpuType.toString(16)}: ${path}`);
  } finally {
    await handle.close();
  }
}

export function isSupportedMacNodeVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 24 && minor >= 15;
}

export function isSemanticVersion(version: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version);
}

async function enumerateStableFiles(bundleRoot: string): Promise<MacPackageFile[]> {
  const root = resolve(bundleRoot);
  const rootEntry = await lstat(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error(`macOS app bundle must be a non-symbolic-link directory: ${root}`);
  }
  const files: MacPackageFile[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Package payload cannot contain a symbolic link: ${relativePath}`);
      if (isExcludedStablePath(relativePath)) {
        if (relativePath === "Contents/_CodeSignature" && !entry.isDirectory()) {
          throw new Error("Package code-signature metadata must be a directory");
        }
        continue;
      }
      if (entry.isDirectory()) {
        await visit(path, relativePath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Package payload contains an unsupported entry: ${relativePath}`);
      const metadata = await stat(path);
      files.push({
        path: relativePath,
        integrity: "sha256",
        size: metadata.size,
        mode: portableMode(relativePath, metadata.mode),
        sha256: await sha256(path),
      });
    }
  };
  await visit(root, "");
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return files;
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function plistString(plist: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*<string>([^<]*)</string>`, "u").exec(plist);
  return match ? decodeXmlText(match[1] ?? "") : undefined;
}

function validateInfoPlist(plist: string, manifest: MacPackageManifest): void {
  if (plistString(plist, "CFBundleIdentifier") !== MAC_BUNDLE_IDENTIFIER) {
    throw new Error("Info.plist bundle identifier is invalid");
  }
  if (plistString(plist, "CFBundleExecutable") !== MAC_BUNDLE_EXECUTABLE) {
    throw new Error("Info.plist executable identity is invalid");
  }
  if (plistString(plist, "CFBundleName") !== "Feature Kanban") {
    throw new Error("Info.plist product name is invalid");
  }
  if (plistString(plist, "CFBundleShortVersionString") !== manifest.productVersion) {
    throw new Error("Info.plist product version does not match the package manifest");
  }
}

function validateManifest(value: unknown): MacPackageManifest {
  if (!value || typeof value !== "object") throw new Error("Package manifest must be an object");
  const manifest = value as Partial<MacPackageManifest>;
  if (
    manifest.formatVersion !== MAC_PACKAGE_FORMAT_VERSION
    || manifest.product !== MAC_PACKAGE_PRODUCT
    || manifest.platform !== "darwin"
  ) {
    throw new Error("Package manifest identity is invalid");
  }
  if (manifest.architecture !== "arm64" && manifest.architecture !== "x64") {
    throw new Error("Package manifest architecture is invalid");
  }
  if (!manifest.productVersion || !isSemanticVersion(manifest.productVersion)) {
    throw new Error("Package manifest product version is invalid");
  }
  if (!manifest.nodeVersion || !isSupportedMacNodeVersion(manifest.nodeVersion)) {
    throw new Error("Package manifest requires Node.js 24.15 or newer in the Node 24 line");
  }
  if (!Array.isArray(manifest.files)) throw new Error("Package manifest files are invalid");
  return manifest as MacPackageManifest;
}

export async function buildMacPackageManifest(
  bundleRoot: string,
  identity: MacPackageIdentity,
): Promise<MacPackageManifest> {
  if (!isSemanticVersion(identity.productVersion)) throw new Error(`Invalid product version: ${identity.productVersion}`);
  if (!isSupportedMacNodeVersion(identity.nodeVersion)) {
    throw new Error(`Node.js 24.15 or newer in the Node 24 line is required: ${identity.nodeVersion}`);
  }
  const root = resolve(bundleRoot);
  const runtimeArchitecture = await readThinMachOArchitecture(resolve(root, "Contents", "MacOS", "FeatureKanbanNode"));
  const bootstrapArchitecture = await readThinMachOArchitecture(resolve(root, "Contents", "MacOS", MAC_BUNDLE_EXECUTABLE));
  if (runtimeArchitecture !== identity.architecture || bootstrapArchitecture !== identity.architecture) {
    throw new Error(
      `macOS package architecture mismatch: requested ${identity.architecture}, runtime ${runtimeArchitecture}, bootstrap ${bootstrapArchitecture}`,
    );
  }
  return {
    formatVersion: MAC_PACKAGE_FORMAT_VERSION,
    product: MAC_PACKAGE_PRODUCT,
    productVersion: identity.productVersion,
    platform: "darwin",
    architecture: identity.architecture,
    nodeVersion: identity.nodeVersion,
    files: (await enumerateStableFiles(root)).map((entry) => (
      entry.path === outerSignedMainExecutable
        ? { ...entry, integrity: "outer-code-signature", size: null, sha256: null }
        : entry
    )),
  };
}

export async function writeMacPackageManifest(
  bundleRoot: string,
  identity: MacPackageIdentity,
): Promise<MacPackageManifest> {
  const manifest = await buildMacPackageManifest(bundleRoot, identity);
  await writeFile(
    resolve(bundleRoot, ...MAC_PACKAGE_MANIFEST_PATH.split("/")),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  return manifest;
}

export async function verifyMacAppBundle(bundleRoot: string): Promise<VerifiedMacAppBundle> {
  const root = resolve(bundleRoot);
  if (basename(root) !== MAC_BUNDLE_NAME) throw new Error(`Unexpected macOS app bundle name: ${basename(root)}`);
  const bundleEntry = await lstat(root);
  if (!bundleEntry.isDirectory() || bundleEntry.isSymbolicLink()) {
    throw new Error(`macOS app bundle must be a non-symbolic-link directory: ${root}`);
  }
  const manifestPath = resolve(root, ...MAC_PACKAGE_MANIFEST_PATH.split("/"));
  const manifestEntry = await lstat(manifestPath);
  if (!manifestEntry.isFile() || manifestEntry.isSymbolicLink()) {
    throw new Error("macOS package manifest must be a regular file");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) { throw new Error(`macOS package manifest is unreadable: ${(error as Error).message}`); }
  const manifest = validateManifest(parsed);
  const seen = new Set<string>();
  let previousPath = "";
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object") throw new Error("Package manifest file entry is invalid");
    const path = validateManifestPath(entry.path);
    if (seen.has(path)) throw new Error(`Package manifest contains a duplicate file: ${path}`);
    if (previousPath && previousPath.localeCompare(path, "en") >= 0) {
      throw new Error("Package manifest files must use deterministic sorted order");
    }
    const outerSigned = path === outerSignedMainExecutable;
    if (outerSigned) {
      if (entry.integrity !== "outer-code-signature" || entry.size !== null || entry.sha256 !== null) {
        throw new Error(`Main executable must delegate byte integrity to the outer code signature: ${path}`);
      }
    } else {
      if (entry.integrity !== "sha256") throw new Error(`Invalid integrity mode in manifest: ${path}`);
      if (!Number.isSafeInteger(entry.size) || (entry.size ?? -1) < 0) throw new Error(`Invalid file size in manifest: ${path}`);
      if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
        throw new Error(`Invalid SHA-256 in manifest: ${path}`);
      }
    }
    if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
      throw new Error(`Invalid file mode in manifest: ${path}`);
    }
    const resolvedPath = resolve(root, ...path.split("/"));
    if (!isWithin(resolvedPath, root)) throw new Error(`Package manifest path escapes the bundle: ${path}`);
    seen.add(path);
    previousPath = path;
  }
  for (const required of MAC_REQUIRED_PAYLOAD_FILES) {
    if (!seen.has(required)) throw new Error(`Required macOS package file is absent from manifest: ${required}`);
  }
  for (const executable of executablePayloads) {
    const entry = manifest.files.find((candidate) => candidate.path === executable);
    if (!entry || (entry.mode & 0o111) === 0) throw new Error(`Required executable mode is absent: ${executable}`);
  }
  const actualFiles = await enumerateStableFiles(root);
  if (actualFiles.length !== manifest.files.length) throw new Error("macOS package contains an unlisted or missing stable payload file");
  for (let index = 0; index < actualFiles.length; index += 1) {
    const actual = actualFiles[index];
    const expected = manifest.files[index];
    if (!actual || !expected || actual.path !== expected.path) {
      throw new Error(`macOS package payload set mismatch near ${actual?.path ?? expected?.path ?? "unknown"}`);
    }
    if (actual.mode !== expected.mode) throw new Error(`Package manifest mode mismatch: ${actual.path}`);
    if (expected.integrity === "outer-code-signature") continue;
    if (actual.size !== expected.size) throw new Error(`Package manifest size mismatch: ${actual.path}`);
    if (actual.sha256 !== expected.sha256) throw new Error(`Package manifest hash mismatch: ${actual.path}`);
  }
  const runtimeArchitecture = await readThinMachOArchitecture(resolve(root, "Contents", "MacOS", "FeatureKanbanNode"));
  const bootstrapArchitecture = await readThinMachOArchitecture(resolve(root, "Contents", "MacOS", MAC_BUNDLE_EXECUTABLE));
  if (runtimeArchitecture !== manifest.architecture || bootstrapArchitecture !== manifest.architecture) {
    throw new Error("Package manifest architecture does not match its executable payload");
  }
  validateInfoPlist(await readFile(resolve(root, "Contents", "Info.plist"), "utf8"), manifest);
  return { bundleRoot: root, manifest, fileCount: manifest.files.length };
}

export function macDmgFileName(
  version: string,
  architecture: MacArchitecture,
  signed: boolean,
): string {
  if (!isSemanticVersion(version)) throw new Error(`Invalid product version: ${version}`);
  return `FeatureKanban-${version}-macos-${architecture}${signed ? "" : "-unsigned"}.dmg`;
}
