import { resolve } from "node:path";
import type { HealthResponse } from "../shared/lifecycle-contract.js";
import { isLoopbackTcpPortAvailable } from "./local-port.js";
import { spawnManaged, type ManagedChild } from "./processes.js";

export interface ServiceRuntime {
  healthUrl: string;
  nodeExecutable: string;
  serverEntry: string;
  environment: NodeJS.ProcessEnv;
}

export interface ServiceState {
  owned: boolean;
  child?: ManagedChild;
}

export interface ServiceAdapter {
  probe(url: string): Promise<boolean>;
  isPortAvailable(port: number): Promise<boolean>;
  spawn(runtime: ServiceRuntime): ManagedChild;
  delay(milliseconds: number): Promise<void>;
}

export const nativeServiceAdapter: ServiceAdapter = {
  probe: async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (!response.ok) return false;
      const body = await response.json() as Partial<HealthResponse>;
      return body.product === "feature-kanban";
    } catch {
      return false;
    }
  },
  isPortAvailable: isLoopbackTcpPortAvailable,
  spawn: (runtime) => spawnManaged(runtime.nodeExecutable, [runtime.serverEntry], runtime.environment, true),
  delay: (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
};

export class ServiceSupervisor {
  private state: ServiceState = { owned: false };

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly adapter: ServiceAdapter = nativeServiceAdapter,
  ) {}

  async ensureRunning(): Promise<ServiceState> {
    if (await this.adapter.probe(this.runtime.healthUrl)) {
      this.state = { owned: false };
      return this.state;
    }
    const port = Number(new URL(this.runtime.healthUrl).port || "80");
    if (!await this.adapter.isPortAvailable(port)) {
      throw new Error(`Loopback TCP port ${port} is already in use by another application; Feature Kanban was not started.`);
    }
    const child = this.adapter.spawn(this.runtime);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await this.adapter.probe(this.runtime.healthUrl)) {
        this.state = { owned: true, child };
        return this.state;
      }
      await this.adapter.delay(100);
    }
    child.terminate();
    throw new Error("Feature Kanban service did not become healthy");
  }

  stopOwned(): void {
    if (this.state.owned) this.state.child?.terminate();
    this.state = { owned: false };
  }
}

export function installedServiceRuntime(
  installRoot: string,
  parentEnvironment: NodeJS.ProcessEnv = process.env,
  _platform: NodeJS.Platform = process.platform,
  nodeExecutable = process.execPath,
): ServiceRuntime {
  const environment = { ...parentEnvironment };
  delete environment.FEATURE_KANBAN_HOST;
  delete environment.FEATURE_KANBAN_PORT;
  delete environment.FEATURE_KANBAN_DATA_DIR;
  return {
    healthUrl: "http://127.0.0.1:46171/api/health",
    nodeExecutable,
    serverEntry: resolve(installRoot, "app", "server", "server", "index.js"),
    environment: {
      ...environment,
      FEATURE_KANBAN_STATIC_DIR: resolve(installRoot, "app", "web", "browser"),
      FEATURE_KANBAN_VERSION: "0.1.0",
    },
  };
}

export function assertSupportedNodeRuntime(version = process.versions.node): void {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match || Number(match[1]) < 24) {
    throw new Error(`Feature Kanban requires local Node.js 24 or newer; found ${version}`);
  }
}
