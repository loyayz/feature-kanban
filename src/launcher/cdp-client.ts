export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CdpResponse {
  id?: number;
  error?: { message?: string };
  result?: unknown;
}

export interface WebSocketLike {
  readyState: number;
  addEventListener(type: string, handler: (event: { data?: unknown }) => void, options?: { once?: boolean }): void;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => WebSocketLike;

export class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly socket: WebSocketLike,
    private readonly commandTimeoutMs = 3_000,
  ) {
    socket.addEventListener("message", (event) => this.onMessage(event.data));
    socket.addEventListener("close", () => this.rejectAll(new Error("CDP socket closed")));
    socket.addEventListener("error", () => this.rejectAll(new Error("CDP socket error")));
  }

  connect(timeoutMs = this.commandTimeoutMs): Promise<void> {
    if (this.socket.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to CDP")), timeoutMs);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP connection failed")); }, { once: true });
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, this.commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.rejectAll(new Error("CDP session closed"));
    this.socket.close();
  }

  private onMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let message: CdpResponse;
    try { message = JSON.parse(data) as CdpResponse; } catch { return; }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) pending.reject(new Error(message.error.message ?? "CDP command failed"));
    else pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }
}

export interface CdpClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  socketFactory?: SocketFactory;
  commandTimeoutMs?: number;
}

export class CdpClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly socketFactory: SocketFactory;
  private readonly commandTimeoutMs: number;

  constructor(options: CdpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:46172";
    this.fetcher = options.fetcher ?? fetch;
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.commandTimeoutMs = options.commandTimeoutMs ?? 3_000;
  }

  async listPages(): Promise<CdpTarget[]> {
    const response = await this.fetcher(`${this.baseUrl}/json/list`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) throw new Error(`CDP discovery failed with ${response.status}`);
    const targets = await response.json() as unknown;
    if (!Array.isArray(targets)) throw new Error("CDP discovery returned invalid data");
    return targets.filter((target): target is CdpTarget => {
      if (!target || typeof target !== "object") return false;
      const value = target as Record<string, unknown>;
      return value["type"] === "page" && typeof value["id"] === "string" && typeof value["url"] === "string";
    });
  }

  async waitForPage(timeoutMs = 15_000): Promise<CdpTarget> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const target = (await this.listPages()).find((page) => page.webSocketDebuggerUrl);
        if (target) return target;
      } catch {
        // Codex has not exposed the discovery endpoint yet.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
    }
    throw new Error("Codex renderer did not expose a CDP page target");
  }

  async configureTarget(target: CdpTarget, injectionScript: string): Promise<void> {
    const session = this.session(target);
    await session.connect();
    try {
      await session.send("Page.setBypassCSP", { enabled: true });
      await session.send("Page.addScriptToEvaluateOnNewDocument", { source: injectionScript });
      await session.send("Runtime.evaluate", { expression: injectionScript, awaitPromise: true });
    } finally {
      session.close();
    }
  }

  async bringToFront(target?: CdpTarget): Promise<void> {
    const page = target ?? (await this.listPages()).find((item) => item.webSocketDebuggerUrl);
    if (!page) throw new Error("No Codex page target is available");
    const session = this.session(page);
    await session.connect();
    try { await session.send("Page.bringToFront"); } finally { session.close(); }
  }

  private session(target: CdpTarget): CdpSession {
    if (!target.webSocketDebuggerUrl) throw new Error("CDP target has no WebSocket endpoint");
    return new CdpSession(this.socketFactory(target.webSocketDebuggerUrl), this.commandTimeoutMs);
  }
}
