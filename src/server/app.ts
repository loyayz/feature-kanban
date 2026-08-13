import { appendFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CardRepository } from "./card-repository.js";
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
}

export function createFeatureKanbanApp(overrides: AppOverrides = {}): FeatureKanbanApp {
  const config = resolveServerConfig(overrides);
  const database = overrides.database ?? openDatabase(config.databasePath);
  const repository = new CardRepository(database.connection);
  const eventHub = overrides.eventHub ?? new EventHub();
  const server = createServer(createRequestHandler({
    repository,
    eventHub,
    localResources: overrides.localResources ?? new NativeLocalCardResources(),
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
    close: () => new Promise<void>((resolve, reject) => {
      eventHub.close();
      server.close((error) => {
        try {
          database.close();
        } catch (closeError) {
          reject(closeError as Error);
          return;
        }
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}

export function appendOperationalLog(config: ServerConfig, message: string): void {
  appendFileSync(config.logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}
