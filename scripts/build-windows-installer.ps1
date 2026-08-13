$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageRoot = Join-Path $repoRoot 'dist\package'
& (Join-Path $PSScriptRoot 'stage-windows-package.ps1')
$installerRoot = Join-Path $repoRoot 'dist\installer'
$bootstrapRoot = Join-Path $repoRoot 'dist\installer-bootstrap'
foreach ($target in @($installerRoot, $bootstrapRoot)) {
    $full = [IO.Path]::GetFullPath($target)
    $prefix = $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe installer path: $full" }
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
    New-Item -ItemType Directory -Path $full -Force | Out-Null
}

$payload = Join-Path $bootstrapRoot 'payload.zip'
Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $payload -CompressionLevel Optimal
$setup = @'
$ErrorActionPreference = 'Stop'
$payloadRoot = Join-Path $env:TEMP ("FeatureKanban-" + [guid]::NewGuid().ToString('N'))
try {
    Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'payload.zip') -DestinationPath $payloadRoot -Force
    & (Join-Path $payloadRoot 'installer\install.ps1') -PackageRoot $payloadRoot
} catch {
    $message = $_.Exception.Message
    try {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($message, 'Feature Kanban installation failed', 'OK', 'Error') | Out-Null
    } catch {
        Write-Error -Message $message -ErrorAction Continue
    }
    exit 1
} finally {
    if (Test-Path -LiteralPath $payloadRoot) { Remove-Item -LiteralPath $payloadRoot -Recurse -Force }
}
'@
$setup | Set-Content -LiteralPath (Join-Path $bootstrapRoot 'setup.ps1') -Encoding utf8

$targetExe = Join-Path $installerRoot 'FeatureKanbanSetup.exe'
$template = Get-Content -LiteralPath (Join-Path $repoRoot 'installer\feature-kanban.sed.template') -Raw
$sed = $template.Replace('<TARGET>', $targetExe).Replace('<SOURCE>', $bootstrapRoot)
$sedPath = Join-Path $bootstrapRoot 'feature-kanban.sed'
$sed | Set-Content -LiteralPath $sedPath -Encoding ascii
$iexpress = Join-Path $env:WINDIR 'System32\iexpress.exe'
if (-not (Test-Path -LiteralPath $iexpress)) { throw "IExpress not found: $iexpress" }
$iexpressArguments = '/N /Q feature-kanban.sed'
$process = Start-Process -FilePath $iexpress -ArgumentList $iexpressArguments -WorkingDirectory $bootstrapRoot -WindowStyle Hidden -Wait -PassThru
for ($attempt = 0; $attempt -lt 100 -and -not (Test-Path -LiteralPath $targetExe); $attempt++) {
    Start-Sleep -Milliseconds 100
}
if (-not (Test-Path -LiteralPath $targetExe) -or (Get-Item -LiteralPath $targetExe).Length -eq 0) {
    throw "IExpress exited with code $($process.ExitCode) without creating FeatureKanbanSetup.exe"
}
Write-Output "Installer created at $targetExe (IExpress exit code $($process.ExitCode))"
