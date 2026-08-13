import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface ManifestEntry { path: string; size: number; sha256: string }
interface PackageManifest {
  formatVersion: number;
  product: string;
  nodeVersion: string;
  files: ManifestEntry[];
}

const requiredFiles = [
  "runtime/node.exe",
  "app/server/server/index.js",
  "app/server/server/standalone.js",
  "app/server/launcher/index.js",
  "app/web/browser/index.html",
  "app/inject/feature-kanban.user.js",
  "app/skills/feature-lifecycle/SKILL.md",
  "app/skills/feature-lifecycle/references/feature-kanban-api.md",
  "installer/install.ps1",
  "installer/launch-codex-hidden.vbs",
  "installer/uninstall.ps1",
];

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyWindowsPackage(packageRoot: string): { fileCount: number; nodeVersion: string } {
  const manifestPath = resolve(packageRoot, "package-manifest.json");
  if (!existsSync(manifestPath)) throw new Error("package-manifest.json is missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  if (manifest.formatVersion !== 1 || manifest.product !== "feature-kanban") {
    throw new Error("Package manifest identity is invalid");
  }
  const byPath = new Map(manifest.files.map((entry) => [entry.path.replaceAll("\\", "/"), entry]));
  for (const required of requiredFiles) {
    if (!byPath.has(required)) throw new Error(`Required package file is absent from manifest: ${required}`);
  }
  for (const entry of manifest.files) {
    const file = resolve(packageRoot, entry.path);
    if (!existsSync(file)) throw new Error(`Manifest file is missing: ${entry.path}`);
    if (statSync(file).size !== entry.size) throw new Error(`Manifest size mismatch: ${entry.path}`);
    if (sha256(file) !== entry.sha256) throw new Error(`Manifest hash mismatch: ${entry.path}`);
  }
  const install = readFileSync(resolve(packageRoot, "installer/install.ps1"), "utf8");
  const uninstall = readFileSync(resolve(packageRoot, "installer/uninstall.ps1"), "utf8");
  if (!install.includes("Install-FeatureSkill") || !install.includes("installedHash")) {
    throw new Error("Installer does not record deployed Skill hashes");
  }
  if (!install.includes("Select-FeatureInstallRoot") || !install.includes("InstallLocation")) {
    throw new Error("Installer does not expose and record the selected program directory");
  }
  if (!install.includes("$activeSkillTarget") || !install.includes("$targets = @($activeSkillTarget)")) {
    throw new Error("Installer contract is missing the single active .agents Skill target");
  }
  if (install.includes(".codex\\skills\\feature-lifecycle") || install.includes(".claude\\skills\\feature-lifecycle")) {
    throw new Error("Installer contract contains a deprecated tool-specific Skill target");
  }
  if (!uninstall.includes(".agents\\skills\\feature-lifecycle")) {
    throw new Error("Uninstaller contract is missing the shared .agents Skill target");
  }
  if (uninstall.includes(".codex\\skills\\feature-lifecycle") || uninstall.includes(".claude\\skills\\feature-lifecycle")) {
    throw new Error("Uninstaller contract contains a deprecated tool-specific Skill target");
  }
  if (!uninstall.includes("preserved-modified") || !uninstall.includes("manualRecovery")) {
    throw new Error("Uninstaller does not preserve modified Skills");
  }
  if (!uninstall.includes("Get-FeatureOwnedInstallationManifest") || !uninstall.includes("[IO.DriveType]::Fixed")) {
    throw new Error("Uninstaller does not bind recursive cleanup to the installation manifest");
  }
  return { fileCount: manifest.files.length, nodeVersion: manifest.nodeVersion };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(process.argv[2] ?? "dist/package");
  const result = verifyWindowsPackage(root);
  console.log(`Verified ${result.fileCount} package files with Node ${result.nodeVersion}`);
}
