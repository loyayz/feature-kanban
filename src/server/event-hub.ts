import type { ServerResponse } from "node:http";
import type { BoardChangedEvent } from "../shared/lifecycle-contract.js";

export class EventHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly keepAlive: NodeJS.Timeout;

  constructor(keepAliveMs = 20_000) {
    this.keepAlive = setInterval(() => {
      for (const response of this.clients) response.write(": keep-alive\n\n");
    }, keepAliveMs);
    this.keepAlive.unref();
  }

  add(response: ServerResponse): void {
    this.clients.add(response);
    response.write("retry: 1500\n\n");
    response.once("close", () => this.clients.delete(response));
  }

  publish(event: BoardChangedEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of this.clients) response.write(payload);
  }

  close(): void {
    clearInterval(this.keepAlive);
    for (const response of this.clients) response.end();
    this.clients.clear();
  }
}
