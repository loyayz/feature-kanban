import type { HttpClient } from "@angular/common/http";
import { of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardApiService, type BoardNotification } from "./card-api.service";

class FakeEventSource {
  static latest: FakeEventSource;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.latest = this;
  }

  close(): void { this.closed = true; }
}

describe("CardApiService notifications", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("performs a full refresh when the first successful open follows connection errors", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const notifications: BoardNotification[] = [];
    const subscription = new CardApiService({} as HttpClient).notifications().subscribe((value) => notifications.push(value));
    const source = FakeEventSource.latest;

    source.onerror?.();
    source.onopen?.();

    expect(source.url).toBe("/api/events");
    expect(notifications).toEqual([{ kind: "reconnected" }]);
    subscription.unsubscribe();
    expect(source.closed).toBe(true);
  });

  it("does not duplicate the initial load on a clean first connection and refreshes later reconnects", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const notifications: BoardNotification[] = [];
    const subscription = new CardApiService({} as HttpClient).notifications().subscribe((value) => notifications.push(value));
    const source = FakeEventSource.latest;

    source.onopen?.();
    expect(notifications).toEqual([]);
    source.onerror?.();
    source.onopen?.();
    expect(notifications).toEqual([{ kind: "reconnected" }]);
    subscription.unsubscribe();
  });

  it("emits project notifications and calls card-scoped resource endpoints", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const notifications: BoardNotification[] = [];
    const http = {
      patch: vi.fn(() => of({ project: { name: "alpha", activeCount: 1, archivedCount: 0, hidden: true } })),
      post: vi.fn(() => of(undefined)),
      get: vi.fn(() => of({ path: "C:\\repo\\spec.md", content: "# Spec" })),
    } as unknown as HttpClient;
    const api = new CardApiService(http);
    api.notifications().subscribe((value) => notifications.push(value));
    FakeEventSource.latest.onmessage?.({ data: JSON.stringify({ type: "project.updated", projectName: "alpha" }) });
    expect(notifications).toEqual([{
      kind: "project",
      event: { type: "project.updated", projectName: "alpha" },
    }]);

    api.setProjectHidden("alpha/project", true).subscribe();
    api.openProject("card/a").subscribe();
    api.getSpecDocument("card/a").subscribe();
    api.createCodexTask("alpha", "Build it").subscribe();
    expect(http.patch).toHaveBeenCalledWith("/api/projects/alpha%2Fproject/visibility", { hidden: true });
    expect(http.post).toHaveBeenCalledWith("/api/cards/card%2Fa/open-project", null);
    expect(http.get).toHaveBeenCalledWith("/api/cards/card%2Fa/spec-document");
    expect(http.post).toHaveBeenCalledWith("/api/codex/tasks", { projectName: "alpha", prompt: "Build it" });
  });
});
