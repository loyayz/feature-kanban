import { execFileSync } from "node:child_process";

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function showWindowsMessage(message: string, title: string, icon: "Error" | "Warning"): void {
  const command = [
    "Add-Type -AssemblyName PresentationFramework;",
    `[System.Windows.MessageBox]::Show(${quotePowerShell(message)}, ${quotePowerShell(title)}, 'OK', '${icon}') | Out-Null`,
  ].join(" ");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: false,
    stdio: "ignore",
  });
}

export function macOSAlertArguments(
  message: string,
  title: string,
  kind: "critical" | "warning",
): string[] {
  return [
    "-e", "on run argv",
    "-e", `display alert (item 2 of argv) message (item 1 of argv) as ${kind} buttons {\"OK\"} default button \"OK\"`,
    "-e", "end run",
    "--", message, title,
  ];
}

function showMacMessage(message: string, title: string, kind: "critical" | "warning"): void {
  execFileSync("/usr/bin/osascript", macOSAlertArguments(message, title, kind), {
    stdio: "ignore",
  });
}

export function showFatalMessage(
  message: string,
  title = "Feature Kanban",
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") showWindowsMessage(message, title, "Error");
  else if (platform === "darwin") showMacMessage(message, title, "critical");
  else {
    console.error(`${title}: ${message}`);
    process.exitCode = 1;
  }
}

export function showWarningMessage(
  message: string,
  title = "Feature Kanban",
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") showWindowsMessage(message, title, "Warning");
  else if (platform === "darwin") showMacMessage(message, title, "warning");
  else console.warn(`${title}: ${message}`);
}
