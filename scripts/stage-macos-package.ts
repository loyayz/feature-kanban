import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MAC_BUNDLE_EXECUTABLE,
  MAC_BUNDLE_NAME,
  isSemanticVersion,
  isSupportedMacNodeVersion,
  readThinMachOArchitecture,
  verifyMacAppBundle,
  writeMacPackageManifest,
  type MacArchitecture,
  type MacPackageManifest,
} from "../src/installer/macos-package.js";

export interface StageMacAppOptions {
  repoRoot: string;
  outputBase: string;
  architecture: MacArchitecture;
  productVersion: string;
  nodeVersion: string;
  runtimePath: string;
  bootstrapPath: string;
  enforceRepositoryOutput?: boolean;
}

export interface StagedMacApp {
  bundlePath: string;
  manifest: MacPackageManifest;
}

function isWithin(path: string, root: string): boolean {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function requireRegularFile(path: string, label: string): Promise<void> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} must be a regular non-symbolic-link file: ${path}`);
}

async function copyPayloadFile(source: string, destination: string, executable = false): Promise<void> {
  await requireRegularFile(source, "Package source");
  await mkdir(resolve(destination, ".."), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, executable ? 0o755 : 0o644);
}

async function copyPayloadTree(source: string, destination: string): Promise<void> {
  const sourceEntry = await lstat(source);
  if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink()) {
    throw new Error(`Package source must be a non-symbolic-link directory: ${source}`);
  }
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Package source cannot contain a symbolic link: ${sourcePath}`);
    if (entry.isDirectory()) await copyPayloadTree(sourcePath, destinationPath);
    else if (entry.isFile()) {
      const metadata = await lstat(sourcePath);
      await mkdir(resolve(destinationPath, ".."), { recursive: true });
      await copyFile(sourcePath, destinationPath);
      await chmod(destinationPath, process.platform === "win32" ? 0o644 : metadata.mode & 0o777);
    } else throw new Error(`Package source contains an unsupported entry: ${sourcePath}`);
  }
}

async function safeBundleTarget(outputBase: string, architecture: MacArchitecture): Promise<string> {
  const requestedBase = resolve(outputBase);
  if (await exists(requestedBase)) {
    const entry = await lstat(requestedBase);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Unsafe macOS output base: ${requestedBase}`);
    }
  } else await mkdir(requestedBase, { recursive: true });
  const baseEntry = await lstat(requestedBase);
  if (!baseEntry.isDirectory() || baseEntry.isSymbolicLink()) {
    throw new Error(`Unsafe macOS output base: ${requestedBase}`);
  }
  const canonicalBase = await realpath(requestedBase);
  const architectureRoot = resolve(canonicalBase, architecture);
  if (await exists(architectureRoot)) {
    const entry = await lstat(architectureRoot);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Unsafe macOS architecture output directory: ${architectureRoot}`);
    }
  } else await mkdir(architectureRoot);
  const canonicalArchitectureRoot = await realpath(architectureRoot);
  if (!isWithin(canonicalArchitectureRoot, canonicalBase)) {
    throw new Error(`macOS architecture output escapes its allowed base: ${canonicalArchitectureRoot}`);
  }
  const bundlePath = resolve(canonicalArchitectureRoot, MAC_BUNDLE_NAME);
  if (!isWithin(bundlePath, canonicalBase) || basename(bundlePath) !== MAC_BUNDLE_NAME) {
    throw new Error(`Unsafe macOS staging target: ${bundlePath}`);
  }
  if (await exists(bundlePath)) {
    const entry = await lstat(bundlePath);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Unsafe existing macOS staging target: ${bundlePath}`);
    const canonicalBundle = await realpath(bundlePath);
    if (!isWithin(canonicalBundle, canonicalBase)) throw new Error(`Existing macOS staging target escapes its base: ${bundlePath}`);
    await rm(bundlePath, { recursive: true, force: false });
  }
  return bundlePath;
}

async function validateProductionOutputBase(repoRoot: string, outputBase: string): Promise<void> {
  const distRoot = resolve(repoRoot, "dist");
  const distEntry = await lstat(distRoot);
  if (!distEntry.isDirectory() || distEntry.isSymbolicLink()) {
    throw new Error(`Production dist directory is unsafe: ${distRoot}`);
  }
  if (await realpath(distRoot) !== distRoot) {
    throw new Error(`Production dist directory escapes the repository: ${distRoot}`);
  }
  const expected = resolve(distRoot, "macos");
  if (resolve(outputBase) !== expected) {
    throw new Error(`Production macOS staging output must be ${expected}`);
  }
  if (await exists(expected)) {
    const outputEntry = await lstat(expected);
    if (!outputEntry.isDirectory() || outputEntry.isSymbolicLink() || await realpath(expected) !== expected) {
      throw new Error(`Production macOS output directory is unsafe: ${expected}`);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function renderInfoPlist(template: string, productVersion: string): string {
  if (!isSemanticVersion(productVersion)) throw new Error(`Invalid product version: ${productVersion}`);
  const buildVersion = productVersion.split(/[+-]/u, 1)[0];
  const rendered = template
    .replaceAll("@@PRODUCT_VERSION@@", productVersion)
    .replaceAll("@@BUILD_VERSION@@", buildVersion ?? productVersion);
  if (rendered.includes("@@")) throw new Error("Info.plist template contains an unresolved substitution token");
  return rendered;
}

export async function stageMacApp(options: StageMacAppOptions): Promise<StagedMacApp> {
  if (options.architecture !== "arm64" && options.architecture !== "x64") {
    throw new Error(`Unsupported macOS architecture: ${String(options.architecture)}`);
  }
  if (!isSemanticVersion(options.productVersion)) throw new Error(`Invalid product version: ${options.productVersion}`);
  if (!isSupportedMacNodeVersion(options.nodeVersion)) {
    throw new Error(`Node.js 24.15 or newer in the Node 24 line is required: ${options.nodeVersion}`);
  }
  const repoRoot = await realpath(resolve(options.repoRoot));
  if (options.enforceRepositoryOutput) {
    await validateProductionOutputBase(repoRoot, options.outputBase);
  }
  const runtimePath = resolve(options.runtimePath);
  const bootstrapPath = resolve(options.bootstrapPath);
  await requireRegularFile(runtimePath, "Node runtime");
  await requireRegularFile(bootstrapPath, "Swift bootstrap");
  const runtimeArchitecture = await readThinMachOArchitecture(runtimePath);
  const bootstrapArchitecture = await readThinMachOArchitecture(bootstrapPath);
  if (runtimeArchitecture !== options.architecture || bootstrapArchitecture !== options.architecture) {
    throw new Error(
      `macOS staging architecture mismatch: requested ${options.architecture}, runtime ${runtimeArchitecture}, bootstrap ${bootstrapArchitecture}`,
    );
  }
  const bundlePath = await safeBundleTarget(options.outputBase, options.architecture);
  const contents = resolve(bundlePath, "Contents");
  const resources = resolve(contents, "Resources");
  await mkdir(resolve(contents, "MacOS"), { recursive: true });
  await mkdir(resources, { recursive: true });
  await copyPayloadFile(bootstrapPath, resolve(contents, "MacOS", MAC_BUNDLE_EXECUTABLE), true);
  await copyPayloadFile(runtimePath, resolve(contents, "MacOS", "FeatureKanbanNode"), true);
  await copyPayloadTree(resolve(repoRoot, "dist", "server"), resolve(resources, "app", "server"));
  await copyPayloadTree(resolve(repoRoot, "dist", "web"), resolve(resources, "app", "web"));
  await copyPayloadFile(
    resolve(repoRoot, "inject", "feature-kanban.user.js"),
    resolve(resources, "app", "inject", "feature-kanban.user.js"),
  );
  await copyPayloadTree(
    resolve(repoRoot, "skills", "feature-lifecycle"),
    resolve(resources, "app", "skills", "feature-lifecycle"),
  );
  const plistTemplate = await readFile(resolve(repoRoot, "installer", "macos", "Info.plist.template"), "utf8");
  await writeFile(
    resolve(contents, "Info.plist"),
    renderInfoPlist(plistTemplate, options.productVersion),
    { encoding: "utf8", mode: 0o644 },
  );
  await writeFile(resolve(contents, "PkgInfo"), "APPL????", { encoding: "ascii", mode: 0o644 });
  const manifest = await writeMacPackageManifest(bundlePath, {
    productVersion: options.productVersion,
    architecture: options.architecture,
    nodeVersion: options.nodeVersion,
  });
  await verifyMacAppBundle(bundlePath);
  return { bundlePath, manifest };
}

function readOption(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing required option ${name}`);
  return value;
}

export function parseStageMacArguments(args: string[]): StageMacAppOptions {
  const architecture = readOption(args, "--arch");
  if (architecture !== "arm64" && architecture !== "x64") throw new Error(`Unsupported macOS architecture: ${architecture}`);
  const repoRoot = resolve(readOption(args, "--repo-root"));
  const outputBase = resolve(readOption(args, "--output-base"));
  const productionOutputBase = resolve(repoRoot, "dist", "macos");
  if (outputBase !== productionOutputBase) {
    throw new Error(`Production macOS staging output must be ${productionOutputBase}`);
  }
  return {
    repoRoot,
    outputBase,
    architecture,
    productVersion: readOption(args, "--product-version"),
    nodeVersion: readOption(args, "--node-version"),
    runtimePath: readOption(args, "--runtime"),
    bootstrapPath: readOption(args, "--bootstrap"),
    enforceRepositoryOutput: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  stageMacApp(parseStageMacArguments(process.argv.slice(2)))
    .then(({ bundlePath, manifest }) => {
      console.log(`Staged ${bundlePath} (${manifest.architecture}, ${manifest.files.length} files)`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
