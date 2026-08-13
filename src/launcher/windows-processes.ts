import { execFile } from "node:child_process";
import {
  spawnManaged,
  type DesktopProcess,
  type DesktopProcessAdapter,
  type ManagedChild,
} from "./processes.js";

export type WindowsProcessAdapter = DesktopProcessAdapter;
export type { DesktopProcess, ManagedChild } from "./processes.js";

function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve(stdout.trim());
      },
    );
  });
}

export class NativeWindowsProcessAdapter implements WindowsProcessAdapter {
  async listCodexDesktopProcesses(): Promise<DesktopProcess[]> {
    const command = [
      "$items = Get-CimInstance Win32_Process -Filter \"Name='ChatGPT.exe'\" |",
      "Where-Object { $_.ExecutablePath -like '*\\WindowsApps\\OpenAI.Codex_*\\app\\ChatGPT.exe' } |",
      "ForEach-Object { [PSCustomObject]@{ pid = [int]$_.ProcessId; executablePath = $_.ExecutablePath } };",
      "@($items) | ConvertTo-Json -Compress",
    ].join(" ");
    const output = await runPowerShell(command);
    if (!output) return [];
    const parsed: unknown = JSON.parse(output);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.filter((value): value is DesktopProcess => {
      if (!value || typeof value !== "object") return false;
      const item = value as Record<string, unknown>;
      return Number.isInteger(item["pid"]) && typeof item["executablePath"] === "string";
    });
  }

  async resolveCodexExecutable(): Promise<string> {
    const command = [
      "$pkg = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1;",
      "if (-not $pkg) { throw 'The official OpenAI Codex app is not installed.' };",
      "$manifestPath = Join-Path $pkg.InstallLocation 'AppxManifest.xml';",
      "[xml]$manifest = Get-Content -LiteralPath $manifestPath;",
      "$relative = $manifest.Package.Applications.Application.Executable;",
      "if (-not $relative) { throw 'Codex manifest does not declare an executable.' };",
      "[IO.Path]::GetFullPath((Join-Path $pkg.InstallLocation $relative))",
    ].join(" ");
    return runPowerShell(command);
  }

  launch(executable: string, args: string[], environment: NodeJS.ProcessEnv = process.env): ManagedChild {
    return spawnManaged(executable, args, environment, false);
  }
}

export function spawnHidden(executable: string, args: string[], environment: NodeJS.ProcessEnv): ManagedChild {
  return spawnManaged(executable, args, environment, true);
}
