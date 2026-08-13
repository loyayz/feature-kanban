import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const windowsTest = process.platform === "win32" ? test : test.skip;

function quote(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

function powerShellJson(command: string): Record<string, unknown> {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

function powerShellUtf8Json(command: string): Record<string, unknown> {
  const wrapped = `$json = & { ${command} } | ConvertTo-Json -Compress; `
    + `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapped], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(Buffer.from(result.stdout.trim(), "base64").toString("utf8")) as Record<string, unknown>;
}

windowsTest("Windows PowerShell 5.1 preserves installer shortcut literals", () => {
  const installScript = resolve(process.cwd(), "installer", "install.ps1");
  const uninstallScript = resolve(process.cwd(), "installer", "uninstall.ps1");
  const result = powerShellUtf8Json(
    `. ${quote(installScript)}; `
      + `$installDefinition = (Get-Command Invoke-FeatureKanbanInstall).Definition; `
      + `. ${quote(uninstallScript)}; `
      + `$uninstallDefinition = (Get-Command Invoke-FeatureKanbanUninstall).Definition; `
      + `[PSCustomObject]@{ `
      + `installCodex = $installDefinition.Contains('启动 Codex 与任务看板.lnk'); `
      + `installService = $installDefinition.Contains('启动任务看板服务.lnk'); `
      + `uninstallCodex = $uninstallDefinition.Contains('启动 Codex 与任务看板.lnk'); `
      + `uninstallService = $uninstallDefinition.Contains('启动任务看板服务.lnk') `
      + `}`,
  );

  assert.deepEqual(result, {
    installCodex: true,
    installService: true,
    uninstallCodex: true,
    uninstallService: true,
  });
});

windowsTest("backs up Skills and restores only unchanged installed content", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-skill-"));
  try {
    const source = resolve(root, "source", "feature-lifecycle");
    const target = resolve(root, "user", ".agents", "skills", "feature-lifecycle");
    const backups = resolve(root, "data", "skill-backups");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(resolve(source, "SKILL.md"), "installed-v1", "utf8");
    writeFileSync(resolve(target, "SKILL.md"), "user-original", "utf8");
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const uninstallScript = resolve(process.cwd(), "installer", "uninstall.ps1");
    const record = powerShellJson(
      `. ${quote(installScript)}; Install-FeatureSkill -Source ${quote(source)} -Target ${quote(target)} -BackupRoot ${quote(backups)} | ConvertTo-Json -Compress`,
    );
    assert.equal(readFileSync(resolve(target, "SKILL.md"), "utf8"), "installed-v1");
    assert.ok(record["backupPath"] && existsSync(String(record["backupPath"])));

    const recordJson = JSON.stringify(record).replaceAll("'", "''");
    const restored = powerShellJson(
      `. ${quote(uninstallScript)}; $record = '${recordJson}' | ConvertFrom-Json; Restore-FeatureSkill -Record $record | ConvertTo-Json -Compress`,
    );
    assert.equal(restored["status"], "restored-backup");
    assert.equal(readFileSync(resolve(target, "SKILL.md"), "utf8"), "user-original");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("uninstall preserves user-edited deployed content and its backup", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-skill-edited-"));
  try {
    const source = resolve(root, "source", "feature-lifecycle");
    const target = resolve(root, "user", ".agents", "skills", "feature-lifecycle");
    const backups = resolve(root, "data", "skill-backups");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(resolve(source, "SKILL.md"), "installed-v2", "utf8");
    writeFileSync(resolve(target, "SKILL.md"), "previous-install", "utf8");
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const uninstallScript = resolve(process.cwd(), "installer", "uninstall.ps1");
    const record = powerShellJson(
      `. ${quote(installScript)}; Install-FeatureSkill -Source ${quote(source)} -Target ${quote(target)} -BackupRoot ${quote(backups)} | ConvertTo-Json -Compress`,
    );
    writeFileSync(resolve(target, "SKILL.md"), "user-edited-after-install", "utf8");
    const recordJson = JSON.stringify(record).replaceAll("'", "''");
    const result = powerShellJson(
      `. ${quote(uninstallScript)}; $record = '${recordJson}' | ConvertFrom-Json; Restore-FeatureSkill -Record $record | ConvertTo-Json -Compress`,
    );
    assert.equal(result["status"], "preserved-modified");
    assert.equal(readFileSync(resolve(target, "SKILL.md"), "utf8"), "user-edited-after-install");
    assert.equal(result["manualRecovery"], record["backupPath"]);
    assert.ok(existsSync(String(record["backupPath"])));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("managed Skill updates preserve the original pre-install backup", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-skill-update-"));
  try {
    const source = resolve(root, "source", "feature-lifecycle");
    const target = resolve(root, "user", ".agents", "skills", "feature-lifecycle");
    const backups = resolve(root, "data", "skill-backups");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(resolve(source, "SKILL.md"), "installed-v1", "utf8");
    writeFileSync(resolve(target, "SKILL.md"), "user-original", "utf8");
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const recordV1 = powerShellJson(
      `. ${quote(installScript)}; Install-FeatureSkill -Source ${quote(source)} -Target ${quote(target)} -BackupRoot ${quote(backups)} | ConvertTo-Json -Compress`,
    );

    writeFileSync(resolve(source, "SKILL.md"), "installed-v2", "utf8");
    const recordJson = JSON.stringify(recordV1).replaceAll("'", "''");
    const recordV2 = powerShellJson(
      `. ${quote(installScript)}; $existing = '${recordJson}' | ConvertFrom-Json; Install-FeatureSkill -Source ${quote(source)} -Target ${quote(target)} -BackupRoot ${quote(backups)} -ExistingRecord $existing | ConvertTo-Json -Compress`,
    );

    assert.equal(readFileSync(resolve(target, "SKILL.md"), "utf8"), "installed-v2");
    assert.equal(recordV2["backupPath"], recordV1["backupPath"]);
    assert.equal(readFileSync(resolve(String(recordV2["backupPath"]), "SKILL.md"), "utf8"), "user-original");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("uninstall leaves a missing Skill target absent and retains its backup", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-skill-missing-"));
  try {
    const source = resolve(root, "source", "feature-lifecycle");
    const target = resolve(root, "user", ".agents", "skills", "feature-lifecycle");
    const backups = resolve(root, "data", "skill-backups");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(resolve(source, "SKILL.md"), "installed-v1", "utf8");
    writeFileSync(resolve(target, "SKILL.md"), "user-original", "utf8");
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const uninstallScript = resolve(process.cwd(), "installer", "uninstall.ps1");
    const record = powerShellJson(
      `. ${quote(installScript)}; Install-FeatureSkill -Source ${quote(source)} -Target ${quote(target)} -BackupRoot ${quote(backups)} | ConvertTo-Json -Compress`,
    );

    rmSync(target, { recursive: true, force: true });
    const recordJson = JSON.stringify(record).replaceAll("'", "''");
    const result = powerShellJson(
      `. ${quote(uninstallScript)}; $record = '${recordJson}' | ConvertFrom-Json; Restore-FeatureSkill -Record $record | ConvertTo-Json -Compress`,
    );

    assert.equal(result["status"], "target-missing");
    assert.equal(existsSync(target), false);
    assert.equal(result["manualRecovery"], record["backupPath"]);
    assert.ok(existsSync(String(record["backupPath"])));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("custom program roots require a matching product manifest before uninstall", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-uninstall-guard-"));
  try {
    const uninstallScript = resolve(process.cwd(), "installer", "uninstall.ps1");
    const unexpectedRoot = resolve(root, "unexpected-install-root", "Feature Kanban");
    mkdirSync(unexpectedRoot, { recursive: true });
    writeFileSync(resolve(unexpectedRoot, "keep.txt"), "keep", "utf8");
    const rejected = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", uninstallScript,
      "-InstallRoot", unexpectedRoot,
    ], {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        LOCALAPPDATA: resolve(root, "local-app-data"),
        USERPROFILE: resolve(root, "user"),
      },
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Refusing to remove.*installation\.json/);
    assert.ok(existsSync(resolve(unexpectedRoot, "keep.txt")));

    const ownedRoot = resolve(root, "程序 O'Brien & (stable) [x]", "Feature Kanban");
    mkdirSync(ownedRoot, { recursive: true });
    writeFileSync(resolve(ownedRoot, "installation.json"), JSON.stringify({
      product: "feature-kanban",
      installRoot: ownedRoot,
      skills: [],
      shortcuts: [],
    }), "utf8");
    const ownership = powerShellUtf8Json(
      `. ${quote(uninstallScript)}; $manifest = Get-FeatureOwnedInstallationManifest -Path ${quote(ownedRoot)}; `
      + `[PSCustomObject]@{ product = $manifest.product; installRoot = $manifest.installRoot }`,
    );
    assert.deepEqual(ownership, { product: "feature-kanban", installRoot: ownedRoot });

    const allowedTarget = resolve(root, "user", ".agents", "skills", "feature-lifecycle");
    const backupRoot = resolve(root, "user", ".feature-kanban", "skill-backups");
    const outsideTarget = resolve(root, "outside", "important-files");
    const validation = powerShellJson(
      `. ${quote(uninstallScript)}; `
      + `$allowed = @(${quote(allowedTarget)}); `
      + `$good = [PSCustomObject]@{ target = ${quote(allowedTarget)}; installedHash = (('A' * 64) -join ''); backupPath = ${quote(resolve(backupRoot, "original"))} }; `
      + `$badTarget = [PSCustomObject]@{ target = ${quote(outsideTarget)}; installedHash = (('A' * 64) -join ''); backupPath = $null }; `
      + `$badBackup = [PSCustomObject]@{ target = ${quote(allowedTarget)}; installedHash = (('A' * 64) -join ''); backupPath = ${quote(resolve(root, "outside-backup"))} }; `
      + `[PSCustomObject]@{ good = Test-FeatureUninstallSkillRecord -Record $good -AllowedTargets $allowed -BackupRoot ${quote(backupRoot)}; badTarget = Test-FeatureUninstallSkillRecord -Record $badTarget -AllowedTargets $allowed -BackupRoot ${quote(backupRoot)}; badBackup = Test-FeatureUninstallSkillRecord -Record $badBackup -AllowedTargets $allowed -BackupRoot ${quote(backupRoot)} } | ConvertTo-Json -Compress`,
    );
    assert.deepEqual(validation, { good: true, badTarget: false, badBackup: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("normalizes writable local roots and preserves special characters in shortcut metadata", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-path-"));
  try {
    const packageRoot = resolve(root, "package");
    const installRoot = resolve(root, "安装 O'Brien & (stable) [x]", "Feature Kanban");
    const codexShortcutPath = resolve(root, "快捷方式", "启动 Codex 与任务看板.lnk");
    const serviceShortcutPath = resolve(root, "快捷方式", "启动任务看板服务.lnk");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(resolve(packageRoot, "payload.txt"), "payload", "utf8");
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const result = powerShellUtf8Json(
      `. ${quote(installScript)}; `
      + `$normalized = Assert-FeatureInstallRoot -Path ${quote(installRoot)} -PackagePath ${quote(packageRoot)}; `
      + `Test-FeatureInstallRootWritable -Path $normalized; `
      + `function Get-CodexIconPath { return $null }; `
      + `New-FeatureKanbanShortcut -Path ${quote(codexShortcutPath)} -Root $normalized -LaunchKind codex; `
      + `New-FeatureKanbanShortcut -Path ${quote(serviceShortcutPath)} -Root $normalized -LaunchKind service; `
      + `$shell = New-Object -ComObject WScript.Shell; `
      + `$codex = $shell.CreateShortcut(${quote(codexShortcutPath)}); `
      + `$service = $shell.CreateShortcut(${quote(serviceShortcutPath)}); `
      + `[PSCustomObject]@{ normalized = $normalized; workingDirectory = $codex.WorkingDirectory; codexTarget = $codex.TargetPath; codexArguments = $codex.Arguments; serviceTarget = $service.TargetPath; serviceArguments = $service.Arguments }`,
    );

    assert.equal(result["normalized"], installRoot);
    assert.equal(result["workingDirectory"], installRoot);
    assert.match(String(result["codexTarget"]), /\\wscript\.exe$/i);
    assert.match(String(result["codexArguments"]), /installer\\launch-codex-hidden\.vbs/);
    assert.match(String(result["codexArguments"]), /O'Brien & \(stable\) \[x\]/);
    assert.doesNotMatch(String(result["codexArguments"]), /powershell|WindowStyle|launcher\\index\.js/i);
    assert.match(String(result["serviceTarget"]), /\\powershell\.exe$/i);
    assert.match(String(result["serviceArguments"]), /FEATURE_KANBAN_INSTALL_ROOT=/);
    assert.doesNotMatch(String(result["serviceArguments"]), /WindowStyle Hidden/);
    assert.match(String(result["serviceArguments"]), /server\\standalone\.js/);
    assert.match(String(result["serviceArguments"]), /Read-Host/);
    assert.match(String(result["serviceArguments"]), /O''Brien & \(stable\) \[x\]/);
    assert.ok(existsSync(codexShortcutPath));
    assert.ok(existsSync(serviceShortcutPath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("legacy Start Menu cleanup removes only the owned shortcut and empty product folder", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-start-cleanup-"));
  try {
    for (const scriptName of ["install.ps1", "uninstall.ps1"]) {
      const script = resolve(process.cwd(), "installer", scriptName);
      const productFolder = resolve(root, scriptName, "Programs", "Feature Kanban");
      const shortcut = resolve(productFolder, "Codex.lnk");
      const sibling = resolve(productFolder, "Keep.lnk");
      mkdirSync(productFolder, { recursive: true });
      writeFileSync(shortcut, "owned", "utf8");
      writeFileSync(sibling, "keep", "utf8");

      const result = powerShellUtf8Json(
        `. ${quote(script)}; `
        + `Remove-FeatureLegacyStartShortcut -Path ${quote(shortcut)}; `
        + `$first = [PSCustomObject]@{ shortcut = (Test-Path -LiteralPath ${quote(shortcut)}); sibling = (Test-Path -LiteralPath ${quote(sibling)}); folder = (Test-Path -LiteralPath ${quote(productFolder)}) }; `
        + `Remove-Item -LiteralPath ${quote(sibling)} -Force; `
        + `Remove-FeatureLegacyStartShortcut -Path ${quote(shortcut)}; `
        + `[PSCustomObject]@{ first = $first; folderAfterEmpty = (Test-Path -LiteralPath ${quote(productFolder)}) }`,
      );

      assert.deepEqual(result, {
        first: { shortcut: false, sibling: true, folder: true },
        folderAfterEmpty: false,
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("does not warn when every Skill target was installed successfully", () => {
  const installScript = resolve(process.cwd(), "installer", "install.ps1");
  const result = powerShellJson(
    `. ${quote(installScript)}; Show-FeatureSkillFailures -Failures @(); `
    + `[PSCustomObject]@{ completed = $true } | ConvertTo-Json -Compress`,
  );

  assert.equal(result["completed"], true);
});

windowsTest("first-install finalization writes an uninstallable manifest before creating shortcuts", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-finalization-"));
  try {
    const packageRoot = resolve(root, "package");
    const installRoot = resolve(root, "programs", "Feature Kanban");
    const userRoot = resolve(root, "user");
    const desktopRoot = resolve(root, "desktop");
    const programsRoot = resolve(root, "start-menu", "programs");
    for (const folder of ["app", "runtime", "installer"]) {
      const source = resolve(packageRoot, folder);
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, "payload.txt"), folder, "utf8");
    }
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const uninstallScript = resolve(process.cwd(), "installer", "uninstall.ps1");
    const result = powerShellUtf8Json(
      `. ${quote(installScript)} -PackageRoot ${quote(packageRoot)} -InstallRoot ${quote(installRoot)}; `
      + `$env:USERPROFILE = ${quote(userRoot)}; `
      + `function Get-FeatureRegisteredInstallRoot { return $null }; `
      + `function Get-FeatureDesktopPath { return ${quote(desktopRoot)} }; `
      + `function Get-FeatureProgramsPath { return ${quote(programsRoot)} }; `
      + `function Install-FeatureSkills { param($Source, $Targets, $BackupRoot, $PreviousInstallation) return [PSCustomObject]@{ records = @(); failures = @() } }; `
      + `$script:shortcutAttempt = $null; `
      + `function New-FeatureKanbanShortcut { param([string] $Path, [string] $Root, [string] $LaunchKind) $script:shortcutAttempt = $Path; throw 'simulated shortcut failure' }; `
      + `$failure = $null; try { Invoke-FeatureKanbanInstall } catch { $failure = $_.Exception.Message + ' | ' + $_.ScriptStackTrace }; `
      + `$manifestPath = Join-Path ${quote(installRoot)} 'installation.json'; `
      + `$manifestExists = Test-Path -LiteralPath $manifestPath; `
      + `$owned = if ($manifestExists) { . ${quote(uninstallScript)}; Get-FeatureOwnedInstallationManifest -Path ${quote(installRoot)} } else { $null }; `
      + `[PSCustomObject]@{ failure = $failure; manifestExists = $manifestExists; product = $owned.product; installRoot = $owned.installRoot; shortcuts = @($owned.shortcuts); shortcutAttempt = $script:shortcutAttempt }`,
    );

    assert.match(String(result["failure"]), /^simulated shortcut failure/);
    assert.equal(result["manifestExists"], true);
    assert.equal(result["product"], "feature-kanban");
    assert.equal(result["installRoot"], installRoot);
    assert.equal((result["shortcuts"] as unknown[]).length, 3);
    assert.equal(result["shortcutAttempt"], (result["shortcuts"] as unknown[])[0]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("rejects unavailable shortcut folders before copying the package or installing the Skill", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-finalization-folders-"));
  try {
    const packageRoot = resolve(root, "package");
    const installRoot = resolve(root, "programs", "Feature Kanban");
    const userRoot = resolve(root, "user");
    const skillMarker = resolve(root, "skill-install-called.txt");
    for (const folder of ["app", "runtime", "installer"]) {
      const source = resolve(packageRoot, folder);
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, "payload.txt"), folder, "utf8");
    }
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const result = powerShellUtf8Json(
      `. ${quote(installScript)} -PackageRoot ${quote(packageRoot)} -InstallRoot ${quote(installRoot)}; `
      + `$env:USERPROFILE = ${quote(userRoot)}; `
      + `function Get-FeatureRegisteredInstallRoot { return $null }; `
      + `function Get-FeatureDesktopPath { return ${quote(resolve(root, "desktop"))} }; `
      + `function Get-FeatureProgramsPath { throw 'simulated Programs folder unavailable' }; `
      + `function Install-FeatureSkills { Set-Content -LiteralPath ${quote(skillMarker)} -Value 'called'; return [PSCustomObject]@{ records = @(); failures = @() } }; `
      + `$failure = $null; try { Invoke-FeatureKanbanInstall } catch { $failure = $_.Exception.Message }; `
      + `[PSCustomObject]@{ failure = $failure; appCopied = (Test-Path -LiteralPath ${quote(resolve(installRoot, "app"))}); skillCalled = (Test-Path -LiteralPath ${quote(skillMarker)}); manifestExists = (Test-Path -LiteralPath ${quote(resolve(installRoot, "installation.json"))}) }`,
    );

    assert.equal(result["failure"], "simulated Programs folder unavailable");
    assert.equal(result["appCopied"], false);
    assert.equal(result["skillCalled"], false);
    assert.equal(result["manifestExists"], false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("an existing installation reuses its recorded allowed desktop shortcut", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-finalization-update-"));
  try {
    const packageRoot = resolve(root, "package");
    const installRoot = resolve(root, "programs", "Feature Kanban");
    const userRoot = resolve(root, "user");
    const desktopRoot = resolve(root, "desktop");
    const programsRoot = resolve(root, "start-menu", "programs");
    const recordedShortcut = resolve(desktopRoot, "Codex (Feature Kanban).lnk");
    for (const folder of ["app", "runtime", "installer"]) {
      const source = resolve(packageRoot, folder);
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, "payload.txt"), folder, "utf8");
    }
    mkdirSync(installRoot, { recursive: true });
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const result = powerShellUtf8Json(
      `$recorded = ${quote(recordedShortcut)}; `
      + `[PSCustomObject]@{ product = 'feature-kanban'; installRoot = ${quote(installRoot)}; skills = @(); shortcuts = @($recorded) } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ${quote(resolve(installRoot, "installation.json"))} -Encoding utf8; `
      + `. ${quote(installScript)} -PackageRoot ${quote(packageRoot)} -InstallRoot ${quote(installRoot)}; `
      + `$env:USERPROFILE = ${quote(userRoot)}; `
      + `function Get-FeatureRegisteredInstallRoot { return ${quote(installRoot)} }; `
      + `function Get-FeatureDesktopPath { return ${quote(desktopRoot)} }; `
      + `function Get-FeatureProgramsPath { return ${quote(programsRoot)} }; `
      + `function Install-FeatureSkills { param($Source, $Targets, $BackupRoot, $PreviousInstallation) return [PSCustomObject]@{ records = @(); failures = @() } }; `
      + `$script:shortcutAttempt = $null; `
      + `function New-FeatureKanbanShortcut { param([string] $Path, [string] $Root, [string] $LaunchKind) $script:shortcutAttempt = $Path; throw 'simulated shortcut failure' }; `
      + `$failure = $null; try { Invoke-FeatureKanbanInstall } catch { $failure = $_.Exception.Message + ' | ' + $_.ScriptStackTrace }; `
      + `[PSCustomObject]@{ recorded = $recorded; shortcutAttempt = $script:shortcutAttempt; failure = $failure }`,
    );

    assert.match(String(result["failure"]), /^simulated shortcut failure/);
    assert.equal(result["shortcutAttempt"], result["recorded"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("rejects nonempty unknown program roots before copying package content", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-unknown-root-"));
  try {
    const packageRoot = resolve(root, "package");
    const installRoot = resolve(root, "apps", "Feature Kanban");
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(installRoot, { recursive: true });
    writeFileSync(resolve(packageRoot, "payload.txt"), "payload", "utf8");
    writeFileSync(resolve(installRoot, "keep.txt"), "user-content", "utf8");
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const rejected = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
      `. ${quote(installScript)}; Assert-FeatureInstallRoot -Path ${quote(installRoot)} -PackagePath ${quote(packageRoot)}`,
    ], { encoding: "utf8", windowsHide: true });

    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /not empty.*not an existing Feature Kanban installation/);
    assert.equal(readFileSync(resolve(installRoot, "keep.txt"), "utf8"), "user-content");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("a failed shared Skill target is retained and recorded", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-skill-partial-"));
  try {
    const source = resolve(root, "source", "feature-lifecycle");
    const lockedTarget = resolve(root, "user", ".agents", "skills", "feature-lifecycle");
    const backups = resolve(root, "data", "skill-backups");
    mkdirSync(source, { recursive: true });
    mkdirSync(lockedTarget, { recursive: true });
    writeFileSync(resolve(source, "SKILL.md"), "installed-v1", "utf8");
    writeFileSync(resolve(lockedTarget, "SKILL.md"), "locked-original", "utf8");
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const result = powerShellJson(
      `. ${quote(installScript)}; $WarningPreference = 'SilentlyContinue'; `
      + `$stream = [IO.File]::Open(${quote(resolve(lockedTarget, "SKILL.md"))}, 'Open', 'Read', 'None'); `
      + `try { Install-FeatureSkills -Source ${quote(source)} -Targets @(${quote(lockedTarget)}) -BackupRoot ${quote(backups)} | ConvertTo-Json -Depth 8 -Compress } finally { $stream.Dispose() }`,
    );

    assert.equal((result["records"] as unknown[]).length, 0);
    assert.equal((result["failures"] as Array<Record<string, unknown>>)[0]?.["target"], lockedTarget);
    assert.equal(readFileSync(resolve(lockedTarget, "SKILL.md"), "utf8"), "locked-original");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

windowsTest("a replacement failure restores the exact pre-install Skill directory", () => {
  const root = mkdtempSync(resolve(tmpdir(), "feature-kanban-skill-rollback-"));
  try {
    const source = resolve(root, "source", "feature-lifecycle");
    const target = resolve(root, "user", ".agents", "skills", "feature-lifecycle");
    const backups = resolve(root, "data", "skill-backups");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(resolve(source, "SKILL.md"), "installed-v2", "utf8");
    writeFileSync(resolve(target, "SKILL.md"), "pre-install-content", "utf8");
    const installScript = resolve(process.cwd(), "installer", "install.ps1");
    const result = powerShellJson(
      `. ${quote(installScript)}; function Move-Item { param([string]$LiteralPath, [string]$Destination, [switch]$Force) throw 'simulated move failure' }; `
      + `try { Install-FeatureSkill -Source ${quote(source)} -Target ${quote(target)} -BackupRoot ${quote(backups)} | Out-Null } catch { [PSCustomObject]@{ error = $_.Exception.Message; content = [IO.File]::ReadAllText(${quote(resolve(target, "SKILL.md"))}) } | ConvertTo-Json -Compress }`,
    );

    assert.match(String(result["error"]), /simulated move failure/);
    assert.equal(result["content"], "pre-install-content");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
