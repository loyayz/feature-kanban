import { spawn, type ChildProcess } from "node:child_process";

export type BrowserProcessSpawner = (
  command: string,
  args: readonly string[],
  options: {
    detached: boolean;
    stdio: "ignore";
    windowsHide: boolean;
  },
) => ChildProcess;

export function openWindowsDefaultBrowser(
  url: string,
  spawnProcess: BrowserProcessSpawner = spawn,
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error("Feature Kanban only opens its loopback HTTP URL");
  }
  return new Promise((resolveOpen, rejectOpen) => {
    const child = spawnProcess(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", parsed.href],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.once("error", rejectOpen);
    child.once("spawn", () => {
      child.removeListener("error", rejectOpen);
      child.unref();
      resolveOpen();
    });
  });
}
