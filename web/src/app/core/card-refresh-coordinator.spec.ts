import { of, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { makeCard } from "../testing/card-fixtures";
import { CardRefreshCoordinator } from "./card-refresh-coordinator";
import type { CardDetail } from "../../../../src/shared/lifecycle-contract";
import type { BoardNotification, CardApiService } from "./card-api.service";

describe("CardRefreshCoordinator", () => {
  it("debounces the same card, keeps different cards independent, and fetches final snapshots", async () => {
    vi.useFakeTimers();
    const notifications = new Subject<BoardNotification>();
    const getCard = vi.fn((id: string) => of(makeCard(id)));
    const api = { notifications: () => notifications, getCard } as unknown as CardApiService;
    const results: string[] = [];
    new CardRefreshCoordinator(api).refreshes$.subscribe((result) => {
      if (result.kind === "targeted") results.push(result.card.id);
    });

    notifications.next({ kind: "card", event: { type: "card.updated", cardId: "card-a" } });
    notifications.next({ kind: "card", event: { type: "card.updated", cardId: "card-a" } });
    notifications.next({ kind: "card", event: { type: "card.created", cardId: "card-b" } });
    await vi.advanceTimersByTimeAsync(149);
    expect(getCard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(getCard.mock.calls.map(([id]) => id).sort()).toEqual(["card-a", "card-b"]);
    expect(results.sort()).toEqual(["card-a", "card-b"]);
    vi.useRealTimers();
  });

  it("marks reconnect refreshes as full and non-animated", () => {
    const notifications = new Subject<BoardNotification>();
    const api = { notifications: () => notifications } as unknown as CardApiService;
    const results: unknown[] = [];
    new CardRefreshCoordinator(api).refreshes$.subscribe((result) => results.push(result));
    notifications.next({ kind: "reconnected" });
    notifications.next({ kind: "project", event: { type: "project.updated", projectName: "alpha" } });
    expect(results).toEqual([
      { kind: "full", animate: false },
      { kind: "full", animate: false },
    ]);
  });

  it("ignores an older in-flight snapshot after a newer notification for the same card", async () => {
    vi.useFakeTimers();
    const notifications = new Subject<BoardNotification>();
    const responses = [new Subject<CardDetail>(), new Subject<CardDetail>()];
    let responseIndex = 0;
    const api = {
      notifications: () => notifications,
      getCard: vi.fn(() => responses[responseIndex++]!),
    } as unknown as CardApiService;
    const results: CardDetail[] = [];
    new CardRefreshCoordinator(api).refreshes$.subscribe((result) => {
      if (result.kind === "targeted") results.push(result.card);
    });

    notifications.next({ kind: "card", event: { type: "card.updated", cardId: "card-a" } });
    await vi.advanceTimersByTimeAsync(150);
    notifications.next({ kind: "card", event: { type: "card.updated", cardId: "card-a" } });
    await vi.advanceTimersByTimeAsync(150);
    responses[1]!.next(makeCard("card-a", "implementing_and_reviewing"));
    responses[1]!.complete();
    responses[0]!.next(makeCard("card-a", "designing"));
    responses[0]!.complete();

    expect(results.map((card) => card.stage)).toEqual(["implementing_and_reviewing"]);
    vi.useRealTimers();
  });
});
