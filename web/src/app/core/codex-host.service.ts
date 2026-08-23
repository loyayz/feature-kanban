import { Injectable, signal } from "@angular/core";

interface HostMessage {
  type: string;
  challenge?: string;
  theme?: "light" | "dark";
  ok?: boolean;
  error?: string;
}

@Injectable({ providedIn: "root" })
export class CodexHostService {
  private readonly challenge = crypto.randomUUID();
  private connected = false;
  private hostOrigin = "*";
  private readonly navigationErrorState = signal<string | null>(null);
  readonly navigationError = this.navigationErrorState.asReadonly();

  connect(): void {
    if (window.parent === window) return;
    window.addEventListener("message", this.onMessage);
    window.parent.postMessage({ type: "feature-kanban:hello", challenge: this.challenge }, "*");
  }

  openCodexSession(externalSessionId: string): void {
    this.navigationErrorState.set(null);
    if (!this.connected || window.parent === window) return;
    window.parent.postMessage(
      {
        type: "feature-kanban:open-session",
        challenge: this.challenge,
        externalSessionId: externalSessionId.slice(0, 160),
      },
      this.hostOrigin,
    );
  }

  openExternal(uri: string): void {
    const url = new URL(uri);
    if (url.protocol !== "https:") return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  disconnect(): void {
    window.removeEventListener("message", this.onMessage);
  }

  private readonly onMessage = (event: MessageEvent<HostMessage>): void => {
    if (event.source !== window.parent || !event.data || event.data.challenge !== this.challenge) return;
    if (event.data.type === "feature-kanban:ready") {
      this.connected = true;
      this.hostOrigin = event.origin && event.origin !== "null" ? event.origin : "*";
      document.documentElement.dataset["hostTheme"] = event.data.theme === "dark" ? "dark" : "light";
      return;
    }
    if (event.data.type === "feature-kanban:navigation-result" && event.data.ok === false) {
      this.navigationErrorState.set(event.data.error ?? "无法在 Codex 中打开这个会话。");
    }
  };
}
