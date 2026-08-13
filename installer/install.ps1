param(
    [string] $PackageRoot = (Split-Path -Parent $PSScriptRoot),
    [string] $InstallRoot
)

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
        $prefix = $fullRoot + [IO.Path]::DirectorySeparatorChar
        return $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Assert-FeatureInstallRoot {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $PackagePath
    )
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'InstallRoot must be an absolute path.' }
    $fullPath = Get-FeatureFullPath -Path $Path
    if ($fullPath.StartsWith('\\', [StringComparison]::Ordinal)) {
        throw 'InstallRoot must be on a local fixed drive; UNC and device paths are not supported.'
    }
    $pathRoot = [IO.Path]::GetPathRoot($fullPath)
    if (-not $pathRoot -or $fullPath -eq $pathRoot.TrimEnd('\', '/')) {
        throw 'InstallRoot cannot be a drive root.'
    }
    $drive = [IO.DriveInfo]::new($pathRoot)
    if (-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed) {
        throw 'InstallRoot must be on a ready local fixed drive.'
    }
    if ([IO.Path]::GetFileName($fullPath) -cne 'Feature Kanban') {
        throw 'InstallRoot must end with the product directory name Feature Kanban.'
    }
    $relative = $fullPath.Substring($pathRoot.Length)
    $invalidNameChars = [IO.Path]::GetInvalidFileNameChars()
    foreach ($segment in $relative.Split([char[]]@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries)) {
        if ($segment.IndexOfAny($invalidNameChars) -ge 0 -or $segment.EndsWith(' ') -or $segment.EndsWith('.')) {
            throw "InstallRoot contains an unsupported path segment: $segment"
        }
    }
    $fullPackage = Get-FeatureFullPath -Path $PackagePath
    if ($fullPath -eq $fullPackage `
        -or (Test-FeaturePathWithin -Path $fullPath -Root $fullPackage) `
        -or (Test-FeaturePathWithin -Path $fullPackage -Root $fullPath)) {
        throw 'InstallRoot cannot contain or be contained by the extracted package directory.'
    }
    if (Test-Path -LiteralPath $fullPath) {
        $item = Get-Item -LiteralPath $fullPath -Force
        if (-not $item.PSIsContainer) { throw 'InstallRoot exists and is not a directory.' }
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'InstallRoot cannot be a reparse point.'
        }
        $entries = @(Get-ChildItem -LiteralPath $fullPath -Force)
        if ($entries.Count -gt 0) {
            $manifestPath = Join-Path $fullPath 'installation.json'
            if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
                throw 'InstallRoot is not empty and is not an existing Feature Kanban installation.'
            }
            try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json }
            catch { throw 'InstallRoot contains an unreadable Feature Kanban installation manifest.' }
            if ([string]$manifest.product -ne 'feature-kanban' `
                -or (Get-FeatureFullPath -Path ([string]$manifest.installRoot)) -ne $fullPath) {
                throw 'InstallRoot manifest identity does not match this directory.'
            }
        }
    }
    foreach ($file in Get-ChildItem -LiteralPath $fullPackage -File -Recurse) {
        $relativeFile = $file.FullName.Substring($fullPackage.Length).TrimStart('\', '/')
        if ((Join-Path $fullPath $relativeFile).Length -gt 240) {
            throw "InstallRoot is too long for the packaged file: $relativeFile"
        }
    }
    return $fullPath
}

function Test-FeatureInstallRootWritable {
    param([Parameter(Mandatory)][string] $Path)
    $created = -not (Test-Path -LiteralPath $Path)
    try {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        $probe = Join-Path $Path ('.feature-kanban-write-' + [guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($probe, 'probe', [Text.Encoding]::ASCII)
        Remove-Item -LiteralPath $probe -Force
    } catch {
        if ($created -and (Test-Path -LiteralPath $Path)) {
            Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        }
        throw "InstallRoot is not writable: $Path. $($_.Exception.Message)"
    }
}

function Get-FeatureRegisteredInstallRoot {
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FeatureKanban'
    try {
        $value = [string](Get-ItemProperty -Path $uninstallKey -Name InstallLocation -ErrorAction Stop).InstallLocation
        if (-not $value) { return $null }
        $fullPath = Get-FeatureFullPath -Path $value
        $manifestPath = Join-Path $fullPath 'installation.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $null }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([string]$manifest.product -ne 'feature-kanban') { return $null }
        if ((Get-FeatureFullPath -Path ([string]$manifest.installRoot)) -ne $fullPath) { return $null }
        return $fullPath
    } catch { return $null }
}

function Select-FeatureInstallRoot {
    param([Parameter(Mandatory)][string] $SuggestedRoot)
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    try {
        $dialog.Description = 'Select a local folder. Feature Kanban will be installed in its Feature Kanban subfolder.'
        $dialog.SelectedPath = Split-Path -Parent $SuggestedRoot
        $dialog.ShowNewFolderButton = $true
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
        return Join-Path $dialog.SelectedPath 'Feature Kanban'
    } finally { $dialog.Dispose() }
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
    $lines = Get-ChildItem -LiteralPath $root -File -Recurse |
        Sort-Object FullName |
        ForEach-Object {
            $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/')
            "$relative`t$(Get-FeatureFileHash -Path $_.FullName)"
        }
    $text = [string]::Join("`n", @($lines))
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $stream = [IO.MemoryStream]::new($bytes)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Install-FeatureSkill {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Target,
        [Parameter(Mandatory)][string] $BackupRoot,
        $ExistingRecord = $null
    )
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Skill source not found: $Source" }
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    $targetParent = Split-Path -Parent $Target
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    if ((Test-Path -LiteralPath $Target) -and -not (Test-Path -LiteralPath $Target -PathType Container)) {
        throw "Skill target is not a directory: $Target"
    }
    $operationId = [guid]::NewGuid().ToString('N')
    $stagedPath = Join-Path $targetParent ".feature-lifecycle.install-$operationId"
    $rollbackPath = Join-Path $BackupRoot ".rollback-$operationId"
    $backupPath = $null
    $hadTarget = Test-Path -LiteralPath $Target -PathType Container
    $replacementStarted = $false
    $keepRollback = $false
    try {
        Copy-Item -LiteralPath $Source -Destination $stagedPath -Recurse -Force
        if ($hadTarget) {
            $currentHash = Get-FeatureDirectoryHash -Path $Target
            $sameManagedInstall = $ExistingRecord `
                -and ([string]$ExistingRecord.target -eq [IO.Path]::GetFullPath($Target)) `
                -and ([string]$ExistingRecord.installedHash -eq $currentHash)
            if ($sameManagedInstall) {
                $backupPath = $ExistingRecord.backupPath
            } else {
                $targetName = Split-Path -Leaf (Split-Path -Parent (Split-Path -Parent $Target))
                $backupPath = Join-Path $BackupRoot ("$targetName-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0,8))")
                Copy-Item -LiteralPath $Target -Destination $backupPath -Recurse -Force
            }
            Copy-Item -LiteralPath $Target -Destination $rollbackPath -Recurse -Force
        }
        $replacementStarted = $true
        if ($hadTarget) { Remove-Item -LiteralPath $Target -Recurse -Force }
        Move-Item -LiteralPath $stagedPath -Destination $Target -Force
        return [PSCustomObject]@{
            target = [IO.Path]::GetFullPath($Target)
            installedHash = Get-FeatureDirectoryHash -Path $Target
            backupPath = $backupPath
        }
    } catch {
        $installationError = $_
        if ($replacementStarted) {
            try {
                if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
                if ($hadTarget -and (Test-Path -LiteralPath $rollbackPath -PathType Container)) {
                    Copy-Item -LiteralPath $rollbackPath -Destination $Target -Recurse -Force
                }
            } catch {
                $keepRollback = $true
                throw "Skill installation failed for $Target and automatic recovery failed. Rollback copy: $rollbackPath. Install error: $($installationError.Exception.Message). Recovery error: $($_.Exception.Message)"
            }
        }
        throw $installationError
    } finally {
        if (Test-Path -LiteralPath $stagedPath) { Remove-Item -LiteralPath $stagedPath -Recurse -Force -ErrorAction SilentlyContinue }
        if (-not $keepRollback -and (Test-Path -LiteralPath $rollbackPath)) {
            Remove-Item -LiteralPath $rollbackPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Install-FeatureSkills {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string[]] $Targets,
        [Parameter(Mandatory)][string] $BackupRoot,
        $PreviousInstallation = $null
    )
    $records = @()
    $failures = @()
    foreach ($target in $Targets) {
        $fullTarget = [IO.Path]::GetFullPath($target)
        $existingRecord = @($PreviousInstallation.skills) | Where-Object { [string]$_.target -eq $fullTarget } | Select-Object -First 1
        if ($existingRecord) {
            $validHash = [string]$existingRecord.installedHash -match '^[0-9A-Fa-f]{64}$'
            $validBackup = -not $existingRecord.backupPath -or (Test-FeaturePathWithin -Path ([string]$existingRecord.backupPath) -Root $BackupRoot)
            if (-not $validHash -or -not $validBackup) {
                Write-Warning "Ignoring an invalid previous Skill record for $fullTarget"
                $existingRecord = $null
            }
        }
        try {
            $records += Install-FeatureSkill -Source $Source -Target $target -BackupRoot $BackupRoot -ExistingRecord $existingRecord
        } catch {
            if ($existingRecord) { $records += $existingRecord }
            $failures += [PSCustomObject]@{ target = $fullTarget; error = $_.Exception.Message }
            Write-Warning "Skill installation failed for $fullTarget. Existing content was retained: $($_.Exception.Message)"
        }
    }
    return [PSCustomObject]@{ records = @($records); failures = @($failures) }
}

function Get-CodexIconPath {
    try {
        $package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
        if (-not $package) { return $null }
        [xml]$manifest = Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml')
        $relative = $manifest.Package.Applications.Application.Executable
        if ($relative) { return [IO.Path]::GetFullPath((Join-Path $package.InstallLocation $relative)) }
    } catch { return $null }
    return $null
}

function Get-FeatureDesktopPath {
    $path = [Environment]::GetFolderPath('Desktop')
    if (-not $path) { throw 'The Windows Desktop folder is unavailable.' }
    return $path
}

function Get-FeatureProgramsPath {
    $path = [Environment]::GetFolderPath('Programs')
    if (-not $path) { throw 'The Windows Start Menu Programs folder is unavailable.' }
    return $path
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

function New-FeatureKanbanShortcut {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][ValidateSet('codex', 'service')][string] $LaunchKind
    )
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    if ($LaunchKind -eq 'codex') {
        $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
        $wrapper = Join-Path $Root 'installer\launch-codex-hidden.vbs'
        $shortcut.Arguments = "`"$wrapper`" `"$Root`""
        $icon = Get-CodexIconPath
        if ($icon) { $shortcut.IconLocation = "$icon,0" }
        $shortcut.Description = 'Codex with Feature Kanban'
    } else {
        $shortcut.TargetPath = 'powershell.exe'
        $node = Join-Path $Root 'runtime\node.exe'
        $standalone = Join-Path $Root 'app\server\server\standalone.js'
        $escapedRoot = $Root.Replace("'", "''")
        $escapedNode = $node.Replace("'", "''")
        $escapedStandalone = $standalone.Replace("'", "''")
        $shortcut.Arguments = "-NoProfile -Command `"`$env:FEATURE_KANBAN_INSTALL_ROOT='$escapedRoot'; & '$escapedNode' '$escapedStandalone'; `$serviceExitCode = `$LASTEXITCODE; if (`$serviceExitCode -ne 0) { Read-Host 'Feature Kanban 服务启动失败。按 Enter 关闭窗口' | Out-Null }; exit `$serviceExitCode`""
        $shortcut.Description = 'Feature Kanban task board service'
    }
    $shortcut.WorkingDirectory = $Root
    $shortcut.Save()
}

function Show-FeatureSkillFailures {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]] $Failures)
    if ($Failures.Count -eq 0) { return }
    $paths = @($Failures | ForEach-Object { "- $($_.target)" }) -join "`n"
    $message = "Feature Kanban was installed, but these Skill targets could not be updated and their original content was retained:`n`n$paths`n`nDetails were saved to installation.json."
    try {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($message, 'Feature Kanban installation warning', 'OK', 'Warning') | Out-Null
    } catch {
        Write-Warning $message
    }
}

function Invoke-FeatureKanbanInstall {
    if (-not $env:LOCALAPPDATA -or -not $env:USERPROFILE) { throw 'LOCALAPPDATA and USERPROFILE are required.' }
    $registeredInstallRoot = Get-FeatureRegisteredInstallRoot
    $suggestedInstallRoot = if ($registeredInstallRoot) {
        $registeredInstallRoot
    } else {
        Join-Path $env:LOCALAPPDATA 'Feature Kanban'
    }
    if (-not $InstallRoot) {
        $InstallRoot = Select-FeatureInstallRoot -SuggestedRoot $suggestedInstallRoot
        if (-not $InstallRoot) {
            Write-Output 'Feature Kanban installation canceled.'
            return
        }
    }
    $InstallRoot = Assert-FeatureInstallRoot -Path $InstallRoot -PackagePath $PackageRoot
    if ($registeredInstallRoot -and $InstallRoot -ne $registeredInstallRoot) {
        throw "Feature Kanban is already installed at $registeredInstallRoot. Uninstall it before choosing a different program directory."
    }
    Test-FeatureInstallRootWritable -Path $InstallRoot
    $previousManifestPath = Join-Path $InstallRoot 'installation.json'
    $previousInstallation = if (Test-Path -LiteralPath $previousManifestPath) {
        Get-Content -LiteralPath $previousManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } else { $null }
    $desktop = Get-FeatureDesktopPath
    $programs = Get-FeatureProgramsPath
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    foreach ($folder in @('app', 'runtime', 'installer')) {
        $source = Join-Path $PackageRoot $folder
        if (-not (Test-Path -LiteralPath $source)) { throw "Package folder missing: $source" }
        $target = Join-Path $InstallRoot $folder
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
    }

    $dataRoot = Join-Path $env:USERPROFILE '.feature-kanban'
    $backupRoot = Join-Path $dataRoot 'skill-backups'
    New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
    $skillSource = Join-Path $InstallRoot 'app\skills\feature-lifecycle'
    $activeSkillTarget = Join-Path $env:USERPROFILE '.agents\skills\feature-lifecycle'
    $targets = @($activeSkillTarget)
    $skillResult = Install-FeatureSkills -Source $skillSource -Targets $targets -BackupRoot $backupRoot -PreviousInstallation $previousInstallation

    $previousShortcuts = @(
        if ($previousInstallation) {
            $previousInstallation.shortcuts | Where-Object { $null -ne $_ -and [string]$_ }
        }
    )
    $desktopCandidates = @(
        (Join-Path $desktop 'Codex.lnk'),
        (Join-Path $desktop 'Codex (Feature Kanban).lnk')
    )
    $recordedDesktop = if ($previousShortcuts.Count -ge 1) { Get-FeatureFullPath -Path ([string]$previousShortcuts[0]) } else { $null }
    $desktopShortcut = if ($recordedDesktop -and $desktopCandidates -contains $recordedDesktop) { $recordedDesktop } else {
        $desktopName = if (Test-Path -LiteralPath (Join-Path $desktop 'Codex.lnk')) { 'Codex (Feature Kanban).lnk' } else { 'Codex.lnk' }
        Join-Path $desktop $desktopName
    }
    $legacyStartShortcut = Join-Path $programs 'Feature Kanban\Codex.lnk'
    $installedCodexShortcut = Join-Path $InstallRoot '启动 Codex 与任务看板.lnk'
    $installedServiceShortcut = Join-Path $InstallRoot '启动任务看板服务.lnk'
    $manifest = [PSCustomObject]@{
        product = 'feature-kanban'
        version = '0.1.0'
        installRoot = $InstallRoot
        installedAt = (Get-Date).ToUniversalTime().ToString('o')
        skills = @($skillResult.records)
        skillFailures = @($skillResult.failures)
        shortcuts = @($desktopShortcut, $installedCodexShortcut, $installedServiceShortcut)
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $InstallRoot 'installation.json') -Encoding utf8

    Remove-FeatureLegacyStartShortcut -Path $legacyStartShortcut
    New-FeatureKanbanShortcut -Path $desktopShortcut -Root $InstallRoot -LaunchKind codex
    New-FeatureKanbanShortcut -Path $installedCodexShortcut -Root $InstallRoot -LaunchKind codex
    New-FeatureKanbanShortcut -Path $installedServiceShortcut -Root $InstallRoot -LaunchKind service

    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FeatureKanban'
    New-Item -Path $uninstallKey -Force | Out-Null
    Set-ItemProperty -Path $uninstallKey -Name DisplayName -Value 'Feature Kanban'
    Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '0.1.0'
    Set-ItemProperty -Path $uninstallKey -Name Publisher -Value 'Feature Kanban'
    Set-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $InstallRoot
    $uninstallScript = Join-Path $InstallRoot 'installer\uninstall.ps1'
    Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstallScript`" -InstallRoot `"$InstallRoot`""
    Show-FeatureSkillFailures -Failures @($skillResult.failures)
    Write-Output "Feature Kanban installed at $InstallRoot"
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-FeatureKanbanInstall }
