param([string] $InstallRoot)

$ErrorActionPreference = 'Stop'

function Get-FeatureFullPath {
    param([Parameter(Mandatory)][string] $Path)
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Test-FeaturePathWithin {
    param([Parameter(Mandatory)][string] $Path, [Parameter(Mandatory)][string] $Root)
    try {
        $fullPath = Get-FeatureFullPath -Path $Path
        $fullRoot = Get-FeatureFullPath -Path $Root
        return $fullPath.StartsWith($fullRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Get-FeatureOwnedInstallationManifest {
    param([Parameter(Mandatory)][string] $Path)
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Refusing to remove a relative InstallRoot.' }
    $fullPath = Get-FeatureFullPath -Path $Path
    if ($fullPath.StartsWith('\\', [StringComparison]::Ordinal)) {
        throw 'Refusing to remove a UNC or device InstallRoot.'
    }
    $pathRoot = [IO.Path]::GetPathRoot($fullPath)
    if (-not $pathRoot -or $fullPath -eq $pathRoot.TrimEnd('\', '/')) {
        throw 'Refusing to remove a drive root.'
    }
    $drive = [IO.DriveInfo]::new($pathRoot)
    if (-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed) {
        throw 'Refusing to remove an InstallRoot that is not on a ready local fixed drive.'
    }
    if ([IO.Path]::GetFileName($fullPath) -cne 'Feature Kanban') {
        throw 'Refusing to remove an InstallRoot with an unexpected product directory name.'
    }
    $relative = $fullPath.Substring($pathRoot.Length)
    $invalidNameChars = [IO.Path]::GetInvalidFileNameChars()
    foreach ($segment in $relative.Split([char[]]@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries)) {
        if ($segment.IndexOfAny($invalidNameChars) -ge 0 -or $segment.EndsWith(' ') -or $segment.EndsWith('.')) {
            throw 'Refusing to remove an InstallRoot with an unsupported path segment.'
        }
    }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
        throw "Refusing to remove a missing InstallRoot: $fullPath"
    }
    $item = Get-Item -LiteralPath $fullPath -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Refusing to remove an InstallRoot that is a reparse point.'
    }
    $manifestPath = Join-Path $fullPath 'installation.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw 'Refusing to remove an InstallRoot without installation.json.'
    }
    try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'Refusing to remove an InstallRoot with an unreadable installation.json.' }
    if ([string]$manifest.product -ne 'feature-kanban' `
        -or (Get-FeatureFullPath -Path ([string]$manifest.installRoot)) -ne $fullPath) {
        throw 'Refusing to remove an InstallRoot whose manifest identity does not match.'
    }
    return $manifest
}

function Get-FeatureFileHash {
    param([Parameter(Mandatory)][string] $Path)
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Get-FeatureDirectoryHash {
    param([Parameter(Mandatory)][string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $null }
    $root = (Resolve-Path -LiteralPath $Path).Path
    $lines = Get-ChildItem -LiteralPath $root -File -Recurse | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/')
        "$relative`t$(Get-FeatureFileHash -Path $_.FullName)"
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", @($lines)))
    $stream = [IO.MemoryStream]::new($bytes)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Test-FeatureAllowedPath {
    param([string] $Path, [Parameter(Mandatory)][string[]] $AllowedPaths)
    if (-not $Path) { return $false }
    try { return $AllowedPaths -contains (Get-FeatureFullPath -Path $Path) }
    catch { return $false }
}

function Remove-FeatureLegacyStartShortcut {
    param([Parameter(Mandatory)][string] $Path)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Remove-Item -LiteralPath $Path -Force
    }
    $folder = Split-Path -Parent $Path
    if ((Test-Path -LiteralPath $folder -PathType Container) `
        -and @(Get-ChildItem -LiteralPath $folder -Force).Count -eq 0) {
        Remove-Item -LiteralPath $folder -Force
    }
}

function Test-FeatureUninstallSkillRecord {
    param(
        [Parameter(Mandatory)] $Record,
        [Parameter(Mandatory)][string[]] $AllowedTargets,
        [Parameter(Mandatory)][string] $BackupRoot
    )
    $validTarget = Test-FeatureAllowedPath -Path ([string]$Record.target) -AllowedPaths $AllowedTargets
    $validHash = [string]$Record.installedHash -match '^[0-9A-Fa-f]{64}$'
    $validBackup = -not $Record.backupPath -or (Test-FeaturePathWithin -Path ([string]$Record.backupPath) -Root $BackupRoot)
    return $validTarget -and $validHash -and $validBackup
}

function Restore-FeatureSkill {
    param([Parameter(Mandatory)] $Record)
    $target = [string]$Record.target
    $currentHash = Get-FeatureDirectoryHash -Path $target
    if (-not $currentHash) {
        return [PSCustomObject]@{
            target = $target
            status = 'target-missing'
            manualRecovery = $Record.backupPath
        }
    }
    if ($currentHash -and $currentHash -ne [string]$Record.installedHash) {
        return [PSCustomObject]@{
            target = $target
            status = 'preserved-modified'
            manualRecovery = $Record.backupPath
        }
    }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    if ($Record.backupPath -and (Test-Path -LiteralPath ([string]$Record.backupPath))) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath ([string]$Record.backupPath) -Destination $target -Recurse -Force
        return [PSCustomObject]@{ target = $target; status = 'restored-backup'; manualRecovery = $null }
    }
    [PSCustomObject]@{ target = $target; status = 'removed-installed'; manualRecovery = $null }
}

function Invoke-FeatureKanbanUninstall {
    if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
    if (-not $InstallRoot) { $InstallRoot = Split-Path -Parent $PSScriptRoot }
    $InstallRoot = Get-FeatureFullPath -Path $InstallRoot
    $manifest = Get-FeatureOwnedInstallationManifest -Path $InstallRoot
    $allowedSkillTargets = @(
        (Get-FeatureFullPath -Path (Join-Path $env:USERPROFILE '.agents\skills\feature-lifecycle'))
    )
    $backupRoot = Join-Path $env:USERPROFILE '.feature-kanban\skill-backups'
    $desktop = [Environment]::GetFolderPath('Desktop')
    $legacyStartShortcut = Get-FeatureFullPath -Path (Join-Path ([Environment]::GetFolderPath('Programs')) 'Feature Kanban\Codex.lnk')
    $allowedShortcuts = @(
        (Get-FeatureFullPath -Path (Join-Path $desktop 'Codex.lnk')),
        (Get-FeatureFullPath -Path (Join-Path $desktop 'Codex (Feature Kanban).lnk')),
        (Get-FeatureFullPath -Path (Join-Path $InstallRoot '启动 Codex 与任务看板.lnk')),
        (Get-FeatureFullPath -Path (Join-Path $InstallRoot '启动任务看板服务.lnk')),
        $legacyStartShortcut
    )
    foreach ($record in @($manifest.skills)) {
        if (-not (Test-FeatureUninstallSkillRecord -Record $record -AllowedTargets $allowedSkillTargets -BackupRoot $backupRoot)) {
            Write-Warning 'Skipped an invalid Skill path in installation.json.'
            continue
        }
        $result = Restore-FeatureSkill -Record $record
        if ($result.status -eq 'preserved-modified' -or $result.status -eq 'target-missing') {
            Write-Warning "Preserved Skill state at $($result.target) ($($result.status)). Manual backup: $($result.manualRecovery)"
        }
    }
    foreach ($shortcut in @($manifest.shortcuts)) {
        if (-not (Test-FeatureAllowedPath -Path ([string]$shortcut) -AllowedPaths $allowedShortcuts)) {
            Write-Warning 'Skipped an invalid shortcut path in installation.json.'
            continue
        }
        $shortcutPath = Get-FeatureFullPath -Path ([string]$shortcut)
        if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
    }
    Remove-FeatureLegacyStartShortcut -Path $legacyStartShortcut
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FeatureKanban'
    try {
        $registeredRoot = [string](Get-ItemProperty -Path $uninstallKey -Name InstallLocation -ErrorAction Stop).InstallLocation
        if ($registeredRoot -and (Get-FeatureFullPath -Path $registeredRoot) -eq $InstallRoot) {
            Remove-Item -Path $uninstallKey -Recurse -Force
        }
    } catch {}
    if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
    Write-Output 'Feature Kanban application removed. ~/.feature-kanban data was preserved.'
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-FeatureKanbanUninstall }
