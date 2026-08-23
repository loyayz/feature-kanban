import { appendFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CardRepository } from "./card-repository.js";
import { CodexAppServerTaskRunner } from "./codex-app-server-runner.js";
import { CodexTaskCoordinator, type CodexTaskRunner } from "./codex-task-runner.js";
import { type ConfigOverrides, resolveServerConfig, type ServerConfig } from "./config.js";
import { openDatabase, type FeatureKanbanDatabase } from "./database.js";
import { EventHub } from "./event-hub.js";
import { NativeLocalCardResources, type LocalCardResources } from "./local-card-resources.js";
import { createRequestHandler } from "./routes.js";

export interface FeatureKanbanApp {
  config: ServerConfig;
  server: Server;
  repository: CardRepository;
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
}

export interface AppOverrides extends ConfigOverrides {
  database?: FeatureKanbanDatabase;
  eventHub?: EventHub;
  localResources?: LocalCardResources;
  codexTaskRunner?: CodexTaskRunner;
}

export function createFeatureKanbanApp(overrides: AppOverrides = {}): FeatureKanbanApp {
  const config = resolveServerConfig(overrides);
  const database = overrides.database ?? openDatabase(config.databasePath);
  const repository = new CardRepository(database.connection);
  const eventHub = overrides.eventHub ?? new EventHub();
  const codexTasks = new CodexTaskCoordinator(
    repository,
    overrides.codexTaskRunner ?? new CodexAppServerTaskRunner(),
  );
  const server = createServer(createRequestHandler({
    repository,
    eventHub,
    localResources: overrides.localResources ?? new NativeLocalCardResources(),
    codexTasks,
    staticDirectory: config.staticDirectory,
    version: config.version,
  }));

  return {
    config,
    server,
    repository,
    listen: () => new Promise<AddressInfo>((resolve, reject) => {
      const handleError = (error: Error) => reject(error);
      server.once("error", handleError);
      server.listen(config.port, config.host, () => {
        server.removeListener("error", handleError);
        resolve(server.address() as AddressInfo);
      });
    }),
    close: async () => {
      eventHub.close();
      const serverClosed = new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error);
        else resolve();
      }));
      await codexTasks.close();
      await serverClosed;
      database.close();
    },
  };
}

export function appendOperationalLog(config: ServerConfig, message: string): void {
  appendFileSync(config.logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}
