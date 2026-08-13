import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  host: "127.0.0.1";
  port: number;
  dataDirectory: string;
  databasePath: string;
  logPath: string;
  staticDirectory: string;
  version: string;
}

export interface ConfigOverrides {
  host?: string;
  port?: number;
  dataDirectory?: string;
  databasePath?: string;
  logPath?: string;
  staticDirectory?: string;
  version?: string;
}

function parsePort(value: string | undefined): number {
  if (!value) return 46171;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("FEATURE_KANBAN_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function loopbackHost(value: string | undefined): "127.0.0.1" {
  const host = value?.trim().toLowerCase() || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Feature Kanban only listens on the loopback interface");
  }
  return "127.0.0.1";
}

export function resolveServerConfig(overrides: ConfigOverrides = {}): ServerConfig {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const defaultStatic = resolve(moduleDirectory, "../../web/browser");
  const dataDirectory = resolve(
    overrides.dataDirectory
      ?? process.env.FEATURE_KANBAN_DATA_DIR
      ?? resolve(homedir(), ".feature-kanban"),
  );
  mkdirSync(dataDirectory, { recursive: true });
  return {
    host: loopbackHost(overrides.host ?? process.env.FEATURE_KANBAN_HOST),
    port: overrides.port ?? parsePort(process.env.FEATURE_KANBAN_PORT),
    dataDirectory,
    databasePath: resolve(overrides.databasePath ?? resolve(dataDirectory, "feature-kanban.sqlite")),
    logPath: resolve(overrides.logPath ?? resolve(dataDirectory, "feature-kanban.log")),
    staticDirectory: resolve(
      overrides.staticDirectory ?? process.env.FEATURE_KANBAN_STATIC_DIR ?? defaultStatic,
    ),
    version: overrides.version ?? process.env.FEATURE_KANBAN_VERSION ?? "0.1.0",
  };
}
