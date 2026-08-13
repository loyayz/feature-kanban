import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { verifyWindowsPackage } from "../../scripts/verify-windows-package.js";

const required = [
  "runtime/node.exe", "app/server/server/index.js", "app/server/server/standalone.js", "app/server/launcher/index.js",
  "app/web/browser/index.html", "app/inject/feature-kanban.user.js",
  "app/skills/feature-lifecycle/SKILL.md",
  "app/skills/feature-lifecycle/references/feature-kanban-api.md",
  "installer/install.ps1", "installer/launch-codex-hidden.vbs", "installer/uninstall.ps1",
];

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertUtf8Bom(path: string): void {
  assert.deepEqual(
    [...readFileSync(path).subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    `${path} must be UTF-8 with BOM for Windows PowerShell 5.1`,
  );
}

test("verifies every staged file hash and the installer recovery contract", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-package-"));
  try {
    for (const relative of required) {
      const file = resolve(root, relative);
      mkdirSync(dirname(file), { recursive: true });
      const content = relative === "installer/install.ps1"
        ? "Install-FeatureSkill installedHash Select-FeatureInstallRoot InstallLocation $activeSkillTarget $targets = @($activeSkillTarget) .agents\\skills\\feature-lifecycle"
        : relative === "installer/uninstall.ps1"
          ? "preserved-modified manualRecovery Get-FeatureOwnedInstallationManifest [IO.DriveType]::Fixed .agents\\skills\\feature-lifecycle"
          : relative;
      writeFileSync(file, content, "utf8");
    }
    const files = required.map((relative) => ({
      path: relative,
      size: statSync(resolve(root, relative)).size,
      sha256: hash(resolve(root, relative)),
    }));
    writeFileSync(resolve(root, "package-manifest.json"), JSON.stringify({
      formatVersion: 1, product: "feature-kanban", nodeVersion: "v24.15.0", files,
    }), "utf8");
    assert.deepEqual(verifyWindowsPackage(root), { fileCount: required.length, nodeVersion: "v24.15.0" });
    writeFileSync(resolve(root, required[0]!), "tampered", "utf8");
    assert.throws(() => verifyWindowsPackage(root), /mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("IExpress template launches the extracted PowerShell bootstrap", () => {
  const template = readFileSync(resolve(process.cwd(), "installer/feature-kanban.sed.template"), "utf8");
  assert.match(template, /AppLaunched=powershell\.exe .* -File setup\.ps1/);
  assert.match(template, /payload\.zip/);
  const buildScript = readFileSync(resolve(process.cwd(), "scripts/build-windows-installer.ps1"), "utf8");
  assert.match(buildScript, /& \(Join-Path \$PSScriptRoot 'stage-windows-package\.ps1'\)/);
  assert.doesNotMatch(buildScript, /if \(-not \(Test-Path[^\n]+package-manifest\.json/);
  assert.match(buildScript, /catch \{[\s\S]*Feature Kanban installation failed/);
  assert.match(buildScript, /Write-Error -Message \$message -ErrorAction Continue/);
  assert.match(buildScript, /exit 1[\s\S]*finally \{[\s\S]*Remove-Item -LiteralPath \$payloadRoot/);
  const installScriptPath = resolve(process.cwd(), "installer/install.ps1");
  const uninstallScriptPath = resolve(process.cwd(), "installer/uninstall.ps1");
  assertUtf8Bom(installScriptPath);
  assertUtf8Bom(uninstallScriptPath);
  const installScript = readFileSync(installScriptPath, "utf8");
  assert.match(installScript, /Show-FeatureSkillFailures -Failures/);
  assert.match(installScript, /Windows\.MessageBox.*Feature Kanban installation warning/s);
  assert.match(installScript, /Select-FeatureInstallRoot/);
  assert.match(installScript, /InstallLocation/);
  assert.match(installScript, /\$targets = @\(\$activeSkillTarget\)/);
  assert.ok(
    installScript.indexOf("Set-Content -LiteralPath (Join-Path $InstallRoot 'installation.json')")
      < installScript.indexOf("New-FeatureKanbanShortcut -Path $desktopShortcut"),
    "installation identity must be written before shortcut finalization",
  );
  assert.match(installScript, /启动 Codex 与任务看板\.lnk/);
  assert.match(installScript, /启动任务看板服务\.lnk/);
  assert.match(installScript, /Remove-FeatureLegacyStartShortcut -Path \$legacyStartShortcut/);
  assert.doesNotMatch(installScript, /New-FeatureKanbanShortcut -Path \$startShortcut/);
  assert.doesNotMatch(installScript, /\.codex\\skills\\feature-lifecycle|\.claude\\skills\\feature-lifecycle/);
  const hiddenLauncher = readFileSync(resolve(process.cwd(), "installer/launch-codex-hidden.vbs"), "utf8");
  assert.match(hiddenLauncher, /Environment\("Process"\)\("FEATURE_KANBAN_INSTALL_ROOT"\)/);
  assert.match(hiddenLauncher, /shell\.Run\(command, 0, True\)/);
  assert.match(hiddenLauncher, /WScript\.Quit exitCode/);
  const uninstallScript = readFileSync(uninstallScriptPath, "utf8");
  assert.match(uninstallScript, /启动 Codex 与任务看板\.lnk/);
  assert.match(uninstallScript, /启动任务看板服务\.lnk/);
  assert.match(uninstallScript, /Feature Kanban\\Codex\.lnk/);
  assert.doesNotMatch(uninstallScript, /\.codex\\skills\\feature-lifecycle|\.claude\\skills\\feature-lifecycle/);
});

test("default quality gate excludes release packaging", () => {
  const packageManifest = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  assert.equal(packageManifest.scripts["check"], "npm run typecheck && npm run test");
  assert.equal(
    packageManifest.scripts["build:installer"],
    "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows-installer.ps1",
  );
  assert.equal(
    packageManifest.scripts["verify:package"],
    "tsc -p tsconfig.test.json && node dist/test/scripts/verify-windows-package.js",
  );
});
