import { spawn, type ChildProcess } from "node:child_process";

export interface DesktopProcess {
  pid: number;
  executablePath: string;
}

export interface ManagedChild {
  pid: number;
  waitForExit(): Promise<number | null>;
  terminate(): void;
}

export interface DesktopProcessAdapter {
  listCodexDesktopProcesses(): Promise<DesktopProcess[]>;
  resolveCodexExecutable(): Promise<string>;
  launch(executable: string, args: string[], environment?: NodeJS.ProcessEnv): ManagedChild;
}

export function wrapManagedChild(child: ChildProcess): ManagedChild {
  if (!child.pid) throw new Error("Failed to start child process");
  const exit = typeof child.exitCode === "number" || typeof child.signalCode === "string"
    ? Promise.resolve(child.exitCode ?? null)
    : new Promise<number | null>((resolveExit) => child.once("exit", (code) => resolveExit(code)));
  return {
    pid: child.pid,
    waitForExit: () => exit,
    terminate: () => {
      if (!child.killed) child.kill("SIGTERM");
    },
  };
}

export function spawnManaged(
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  windowsHide: boolean,
): ManagedChild {
  return wrapManagedChild(spawn(executable, args, {
    env: environment,
    stdio: "ignore",
    windowsHide,
  }));
}
