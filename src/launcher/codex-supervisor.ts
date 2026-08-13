import type { CdpClient, CdpTarget } from "./cdp-client.js";
import { isLoopbackTcpPortAvailable } from "./local-port.js";
import type { DesktopProcessAdapter, ManagedChild } from "./processes.js";

export interface CodexLaunchOptions {
  debuggingPort?: number;
  rendererPollMs?: number;
  desktopPollMs?: number;
  portAvailable?: (port: number) => Promise<boolean>;
}

export class CodexSupervisor {
  private activeTarget: CdpTarget | undefined;
  private child: ManagedChild | undefined;
  private stopWatching: (() => void) | undefined;
  private readonly debuggingPort: number;
  private readonly rendererPollMs: number;
  private readonly desktopPollMs: number;
  private readonly portAvailable: (port: number) => Promise<boolean>;

  constructor(
    private readonly processes: DesktopProcessAdapter,
    private readonly cdp: CdpClient,
    options: CodexLaunchOptions = {},
  ) {
    this.debuggingPort = options.debuggingPort ?? 46172;
    this.rendererPollMs = options.rendererPollMs ?? 750;
    this.desktopPollMs = options.desktopPollMs ?? 800;
    this.portAvailable = options.portAvailable ?? isLoopbackTcpPortAvailable;
  }

  async run(executable: string, injectionScript: string): Promise<void> {
    if (!await this.portAvailable(this.debuggingPort)) {
      throw new Error(`Loopback TCP port ${this.debuggingPort} is already in use; Codex was not started.`);
    }
    this.child = this.processes.launch(executable, [
      `--remote-debugging-port=${this.debuggingPort}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-allow-origins=http://127.0.0.1:46171",
    ]);
    try {
      const first = await this.cdp.waitForPage();
      await this.cdp.configureTarget(first, injectionScript);
      this.activeTarget = first;
      this.stopWatching = this.watchRenderers(injectionScript, new Set([first.id]));
      await this.waitUntilDesktopExited();
      this.stopWatching();
      this.stopWatching = undefined;
      this.child = undefined;
    } catch (error) {
      this.stopWatching?.();
      this.stopWatching = undefined;
      this.child?.terminate();
      this.child = undefined;
      throw error;
    }
  }

  private async waitUntilDesktopExited(): Promise<void> {
    let consecutiveEmptyChecks = 0;
    while (consecutiveEmptyChecks < 2) {
      const instances = await this.processes.listCodexDesktopProcesses();
      consecutiveEmptyChecks = instances.length === 0 ? consecutiveEmptyChecks + 1 : 0;
      if (consecutiveEmptyChecks < 2) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, this.desktopPollMs));
      }
    }
  }

  async activate(): Promise<void> {
    try {
      await this.cdp.bringToFront(this.activeTarget);
    } catch {
      await this.cdp.bringToFront();
    }
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
  }

  private watchRenderers(injectionScript: string, configured: Set<string>): () => void {
    let stopped = false;
    let busy = false;
    const timer = setInterval(async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        for (const target of await this.cdp.listPages()) {
          if (!target.webSocketDebuggerUrl || configured.has(target.id)) continue;
          await this.cdp.configureTarget(target, injectionScript);
          configured.add(target.id);
          this.activeTarget = target;
        }
      } catch {
        // Renderer replacement is eventually consistent; the next poll retries.
      } finally {
        busy = false;
      }
    }, this.rendererPollMs);
    return () => { stopped = true; clearInterval(timer); };
  }
}
