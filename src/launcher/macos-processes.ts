import { execFile, spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  wrapManagedChild,
  type DesktopProcess,
  type DesktopProcessAdapter,
  type ManagedChild,
} from "./processes.js";

export interface MacProcessDependencies {
  homeDirectory(): string;
  canonicalPath(path: string): Promise<string>;
  isRegularFile(path: string): Promise<boolean>;
  assertExecutable(path: string): Promise<void>;
  readPlistValue(infoPath: string, key: string): Promise<string>;
  listProcesses(): Promise<string>;
  spawn(executable: string, args: string[], environment: NodeJS.ProcessEnv): ChildProcess;
}

function execText(executable: string, args: string[]): Promise<string> {
  return new Promise((resolveResult, reject) => {
    execFile(executable, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolveResult(stdout.trim());
    });
  });
}

export const nativeMacProcessDependencies: MacProcessDependencies = {
  homeDirectory: homedir,
  canonicalPath: realpath,
  isRegularFile: async (path) => (await stat(path)).isFile(),
  assertExecutable: (path) => access(path, constants.X_OK),
  readPlistValue: (infoPath, key) => execText(
    "/usr/bin/plutil",
    ["-extract", key, "raw", "-o", "-", infoPath],
  ),
  listProcesses: () => execText("/bin/ps", ["-axww", "-o", "pid=,command="]),
  spawn: (executable, args, environment) => spawn(executable, args, {
    env: environment,
    stdio: "ignore",
  }),
};

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isWithin(path: string, root: string): boolean {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export async function resolveMacBundleExecutable(
  bundlePath: string,
  dependencies: MacProcessDependencies = nativeMacProcessDependencies,
): Promise<string> {
  const canonicalBundle = await dependencies.canonicalPath(bundlePath);
  const executableName = (await dependencies.readPlistValue(
    resolve(canonicalBundle, "Contents", "Info.plist"),
    "CFBundleExecutable",
  )).trim();
  if (!executableName || basename(executableName) !== executableName || executableName === "." || executableName === "..") {
    throw new Error(`Invalid CFBundleExecutable in ${canonicalBundle}`);
  }
  const executableRoot = resolve(canonicalBundle, "Contents", "MacOS");
  const executable = await dependencies.canonicalPath(resolve(executableRoot, executableName));
  if (!isWithin(executable, executableRoot)) {
    throw new Error(`Bundle executable escapes Contents/MacOS: ${canonicalBundle}`);
  }
  if (!await dependencies.isRegularFile(executable)) {
    throw new Error(`Bundle executable is not a regular file: ${executable}`);
  }
  await dependencies.assertExecutable(executable);
  return executable;
}

export function parseMacProcessList(output: string, executablePaths: string[]): DesktopProcess[] {
  const matches: DesktopProcess[] = [];
  const seen = new Set<number>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2] ?? "";
    const executable = executablePaths.find((candidate) => (
      command === candidate || command.startsWith(`${candidate} `)
    ));
    if (!Number.isInteger(pid) || !executable || seen.has(pid)) continue;
    seen.add(pid);
    matches.push({ pid, executablePath: executable });
  }
  return matches;
}

export class NativeMacProcessAdapter implements DesktopProcessAdapter {
  constructor(
    private readonly dependencies: MacProcessDependencies = nativeMacProcessDependencies,
    private readonly overrideBundle = process.env.FEATURE_KANBAN_CODEX_APP,
  ) {}

  private bundleCandidates(): Array<{ path: string; required: boolean }> {
    const userApplications = resolve(this.dependencies.homeDirectory(), "Applications");
    const candidates: Array<{ path: string; required: boolean }> = [];
    if (this.overrideBundle) candidates.push({ path: this.overrideBundle, required: true });
    candidates.push(
      { path: "/Applications/ChatGPT.app", required: false },
      { path: resolve(userApplications, "ChatGPT.app"), required: false },
      { path: "/Applications/Codex.app", required: false },
      { path: resolve(userApplications, "Codex.app"), required: false },
    );
    return candidates;
  }

  private async availableExecutables(): Promise<string[]> {
    const executables: string[] = [];
    for (const candidate of this.bundleCandidates()) {
      try {
        const executable = await resolveMacBundleExecutable(candidate.path, this.dependencies);
        if (!executables.includes(executable)) executables.push(executable);
      } catch (error) {
        if (!candidate.required && isMissingPath(error)) continue;
        throw error;
      }
    }
    return executables;
  }

  async listCodexDesktopProcesses(): Promise<DesktopProcess[]> {
    const executables = await this.availableExecutables();
    if (executables.length === 0) return [];
    return parseMacProcessList(await this.dependencies.listProcesses(), executables);
  }

  async resolveCodexExecutable(): Promise<string> {
    const executables = await this.availableExecutables();
    const executable = executables[0];
    if (!executable) {
      throw new Error(
        "The official ChatGPT or Codex app was not found in /Applications or ~/Applications. "
        + "Set FEATURE_KANBAN_CODEX_APP to an explicit .app bundle path if needed.",
      );
    }
    return executable;
  }

  launch(executable: string, args: string[], environment: NodeJS.ProcessEnv = process.env): ManagedChild {
    return wrapManagedChild(this.dependencies.spawn(executable, args, environment));
  }
}
