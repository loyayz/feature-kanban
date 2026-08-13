import { spawn, type ChildProcess } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { SpecDocumentResponse } from "../shared/lifecycle-contract.js";
import {
  LocalResourceNotFoundError,
  LocalResourceOperationError,
  LocalResourceValidationError,
  UnsupportedPlatformError,
} from "./errors.js";

const maxSpecBytes = 1024 * 1024;

export type LocalResourceSpawner = (
  command: string,
  args: readonly string[],
  options: { detached: boolean; stdio: "ignore"; windowsHide: boolean },
) => ChildProcess;

export interface LocalCardResources {
  openProject(path: string): Promise<void>;
  readSpec(path: string): Promise<SpecDocumentResponse>;
}

async function requireStats(path: string) {
  try {
    return await stat(path);
  } catch {
    throw new LocalResourceNotFoundError("Local path does not exist");
  }
}

export class NativeLocalCardResources implements LocalCardResources {
  constructor(
    private readonly platform = process.platform,
    private readonly spawnProcess: LocalResourceSpawner = spawn,
  ) {}

  async openProject(path: string): Promise<void> {
    const stats = await requireStats(path);
    if (!stats.isDirectory()) throw new LocalResourceValidationError("Project path is not a directory");
    const command = this.platform === "win32" ? "explorer.exe" : this.platform === "darwin" ? "open" : undefined;
    if (!command) throw new UnsupportedPlatformError("Opening project folders is unsupported on this platform");
    await new Promise<void>((resolveOpen, rejectOpen) => {
      const child = this.spawnProcess(command, [path], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      const handleError = () => rejectOpen(new LocalResourceOperationError("Project file manager could not be started"));
      child.once("error", handleError);
      child.once("spawn", () => {
        child.removeListener("error", handleError);
        child.unref();
        resolveOpen();
      });
    });
  }

  async readSpec(path: string): Promise<SpecDocumentResponse> {
    const extension = extname(path).toLowerCase();
    if (extension !== ".md" && extension !== ".markdown") {
      throw new LocalResourceValidationError("Spec document must be Markdown");
    }
    const stats = await requireStats(path);
    if (!stats.isFile()) throw new LocalResourceValidationError("Spec document path is not a file");
    if (stats.size > maxSpecBytes) {
      throw new LocalResourceValidationError("Spec document exceeds 1 MiB");
    }
    return { path, content: await readFile(path, "utf8") };
  }
}
