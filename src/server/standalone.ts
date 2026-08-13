import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendOperationalLog,
  createFeatureKanbanApp,
  type AppOverrides,
  type FeatureKanbanApp,
} from "./app.js";
import { openWindowsDefaultBrowser } from "./windows-browser.js";

const standaloneUrl = "http://127.0.0.1:46171";

export interface StandaloneApp {
  config: FeatureKanbanApp["config"];
  listen: FeatureKanbanApp["listen"];
  close: FeatureKanbanApp["close"];
}

export interface StandaloneDependencies {
  createApp(overrides: AppOverrides): StandaloneApp;
  openBrowser(url: string): Promise<void>;
  log(app: StandaloneApp, message: string): void;
  warn(message: string): void;
}

export interface StandaloneService {
  url: string;
  stop(signal: string): Promise<void>;
}

const nativeDependencies: StandaloneDependencies = {
  createApp: createFeatureKanbanApp,
  openBrowser: openWindowsDefaultBrowser,
  log: (app, message) => appendOperationalLog(app.config, message),
  warn: (message) => console.warn(message),
};

export function installedStandaloneOverrides(installRoot: string): AppOverrides {
  if (!isAbsolute(installRoot) || basename(installRoot) !== "Feature Kanban") {
    throw new Error("FEATURE_KANBAN_INSTALL_ROOT must be an absolute Feature Kanban installation directory");
  }
  return {
    host: "127.0.0.1",
    port: 46171,
    dataDirectory: resolve(homedir(), ".feature-kanban"),
    staticDirectory: resolve(installRoot, "app", "web", "browser"),
    version: "0.1.0",
  };
}

export async function startStandaloneService(
  installRoot: string,
  dependencies: StandaloneDependencies = nativeDependencies,
): Promise<StandaloneService> {
  const app = dependencies.createApp(installedStandaloneOverrides(installRoot));
  let stopping = false;
  const log = (message: string): void => {
    try {
      dependencies.log(app, message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      dependencies.warn(`Feature Kanban could not write its operational log: ${detail}`);
    }
  };
  try {
    await app.listen();
  } catch (error) {
    await app.close().catch(() => {});
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === "EADDRINUSE") {
      throw new Error("Feature Kanban cannot start because loopback TCP port 46171 is already in use.");
    }
    throw error;
  }

  const listeningMessage = `Feature Kanban listening on ${standaloneUrl}`;
  console.log(listeningMessage);
  log(listeningMessage);
  try {
    await dependencies.openBrowser(standaloneUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const warning = `Feature Kanban is running, but the default browser could not be opened: ${detail}`;
    dependencies.warn(warning);
    log(warning);
  }

  return {
    url: standaloneUrl,
    stop: async (signal) => {
      if (stopping) return;
      stopping = true;
      log(`received ${signal}; shutting down`);
      await app.close();
    },
  };
}

async function main(): Promise<void> {
  const installRoot = process.env.FEATURE_KANBAN_INSTALL_ROOT;
  if (!installRoot) {
    throw new Error("FEATURE_KANBAN_INSTALL_ROOT is required");
  }
  const service = await startStandaloneService(installRoot);
  const stop = (signal: string): void => {
    void service.stop(signal).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGHUP", () => stop("SIGHUP"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Feature Kanban service failed to start");
    process.exitCode = 1;
  });
}
