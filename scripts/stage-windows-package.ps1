$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distRoot = Join-Path $repoRoot 'dist'
$stageRoot = Join-Path $distRoot 'package'
$expectedPrefix = $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$stageFull = [IO.Path]::GetFullPath($stageRoot)
if (-not $stageFull.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe stage path: $stageFull" }

$nvmNpm = if ($env:NVM_SYMLINK) { Join-Path $env:NVM_SYMLINK 'npm.cmd' } else { $null }
$npm = if ($nvmNpm -and (Test-Path -LiteralPath $nvmNpm)) { $nvmNpm } else { (Get-Command npm.cmd -ErrorAction Stop).Source }
& $npm run build
if ($LASTEXITCODE -ne 0) { throw "Production build failed with exit code $LASTEXITCODE" }

if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

function Copy-PackageTree {
    param([string] $Source, [string] $Destination)
    if (-not (Test-Path -LiteralPath $Source)) { throw "Required package source missing: $Source" }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Get-PackageFileHash {
    param([Parameter(Mandatory)][string] $Path)
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

Copy-PackageTree (Join-Path $distRoot 'server') (Join-Path $stageRoot 'app\server')
Copy-PackageTree (Join-Path $distRoot 'web') (Join-Path $stageRoot 'app\web')
Copy-PackageTree (Join-Path $repoRoot 'inject') (Join-Path $stageRoot 'app\inject')
Copy-PackageTree (Join-Path $repoRoot 'skills') (Join-Path $stageRoot 'app\skills')
Copy-PackageTree (Join-Path $repoRoot 'installer') (Join-Path $stageRoot 'installer')

$nodeSource = if ($env:NVM_SYMLINK) { Join-Path $env:NVM_SYMLINK 'node.exe' } else { (Get-Command node.exe -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $nodeSource)) { throw "Node runtime missing: $nodeSource" }
New-Item -ItemType Directory -Path (Join-Path $stageRoot 'runtime') -Force | Out-Null
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $stageRoot 'runtime\node.exe') -Force

$files = @(Get-ChildItem -LiteralPath $stageRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    [PSCustomObject]@{
        path = $_.FullName.Substring($stageRoot.Length).TrimStart('\', '/').Replace('\', '/')
        size = $_.Length
        sha256 = Get-PackageFileHash -Path $_.FullName
    }
})
$manifestJson = [PSCustomObject]@{
    formatVersion = 1
    product = 'feature-kanban'
    productVersion = '0.1.0'
    nodeVersion = (& $nodeSource --version)
    files = $files
} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText(
    (Join-Path $stageRoot 'package-manifest.json'),
    $manifestJson,
    [Text.UTF8Encoding]::new($false)
)

Write-Output "Windows package staged at $stageRoot"
