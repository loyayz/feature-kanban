import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  preflightMacInstallation,
  setupMacInstallation,
  uninstallMacApplication,
} from "../installer/macos-installation.js";
import { CdpClient } from "./cdp-client.js";
import { CodexSupervisor } from "./codex-supervisor.js";
import { NativeMacProcessAdapter } from "./macos-processes.js";
import { showFatalMessage, showWarningMessage } from "./message-box.js";
import type { DesktopProcessAdapter } from "./processes.js";
import { installedServiceRuntime, ServiceSupervisor } from "./service-supervisor.js";
import { acquireSingleInstance } from "./single-instance.js";
import { NativeWindowsProcessAdapter } from "./windows-processes.js";

export interface LauncherLease {
  primary: boolean;
  onActivate(handler: () => void): void;
  close(): Promise<void>;
}

export interface LauncherCodexSupervisor {
  run(executable: string, injectionScript: string): Promise<void>;
  activate(): Promise<void>;
  dispose(): void;
}

export interface LauncherServiceSupervisor {
  ensureRunning(): Promise<unknown>;
  stopOwned(): void;
}

export interface LauncherDependencies {
  acquireLease(): Promise<LauncherLease>;
  preflight?(): Promise<void>;
  prepare?(): Promise<void>;
  processes: DesktopProcessAdapter;
  service: LauncherServiceSupervisor;
  codex: LauncherCodexSupervisor;
  injectionScript: string;
  showMessage(message: string, title?: string): void;
}

export async function runLauncher(dependencies: LauncherDependencies): Promise<void> {
  await dependencies.preflight?.();
  const lease = await dependencies.acquireLease();
  if (!lease.primary) return;
  try {
    await dependencies.prepare?.();
    const existing = await dependencies.processes.listCodexDesktopProcesses();
    if (existing.length) {
      dependencies.showMessage("检测到官方 ChatGPT/Codex 已经在运行。请先关闭它，再通过 Feature Kanban 启动。", "无法启动 Feature Kanban");
      return;
    }
    lease.onActivate(() => void dependencies.codex.activate().catch(() => {}));
    try {
      await dependencies.service.ensureRunning();
      await dependencies.codex.run(
        await dependencies.processes.resolveCodexExecutable(),
        dependencies.injectionScript,
      );
    } finally {
      dependencies.codex.dispose();
      dependencies.service.stopOwned();
    }
  } finally {
    await lease.close();
  }
}

export function nativeProcessAdapter(platform: NodeJS.Platform = process.platform): DesktopProcessAdapter {
  if (platform === "win32") return new NativeWindowsProcessAdapter();
  if (platform === "darwin") return new NativeMacProcessAdapter();
  throw new Error(`Feature Kanban managed desktop launch is not supported on ${platform}`);
}

async function main(): Promise<void> {
  const installRoot = process.env.FEATURE_KANBAN_INSTALL_ROOT ?? process.cwd();
  const packaged = Boolean(process.env.FEATURE_KANBAN_INSTALL_ROOT);
  const uninstallRequested = process.argv.slice(2).includes("--uninstall");
  if (uninstallRequested) {
    if (process.platform !== "darwin" || !packaged) {
      throw new Error("The --uninstall action is available only from the packaged macOS application.");
    }
    const result = await uninstallMacApplication(installRoot);
    console.log(result.message);
    if (result.manualRecoveryPath) console.log(`Manual recovery: ${result.manualRecoveryPath}`);
    return;
  }
  const packagedInjection = resolve(installRoot, "app", "inject", "feature-kanban.user.js");
  const sourceInjection = resolve(installRoot, "inject", "feature-kanban.user.js");
  const injectionScript = readFileSync(
    packaged ? packagedInjection : sourceInjection,
    "utf8",
  );
  const processes = nativeProcessAdapter();
  const preflight = process.platform === "darwin" && packaged
    ? async (): Promise<void> => { await preflightMacInstallation(installRoot); }
    : undefined;
  const prepare = process.platform === "darwin" && packaged
    ? async (): Promise<void> => {
      const setup = await setupMacInstallation(installRoot);
      if (setup.skillFailure) {
        showWarningMessage(
          `Feature Kanban will continue, but the shared feature-lifecycle Skill could not be updated. `
          + `Existing content was retained. Details: ${setup.skillFailure}`,
          "Feature Kanban installation warning",
        );
      }
    }
    : undefined;
  await runLauncher({
    acquireLease: acquireSingleInstance,
    ...(preflight ? { preflight } : {}),
    ...(prepare ? { prepare } : {}),
    processes,
    service: new ServiceSupervisor(installedServiceRuntime(installRoot)),
    codex: new CodexSupervisor(processes, new CdpClient()),
    injectionScript,
    showMessage: showFatalMessage,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Feature Kanban 启动失败";
    try { showFatalMessage(message); } catch { console.error(message); }
    process.exitCode = 1;
  });
}
