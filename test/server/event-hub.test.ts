import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import test from "node:test";
import { EventHub } from "../../src/server/event-hub.js";

test("publishes card notifications as default EventSource messages", () => {
  const writes: string[] = [];
  let closeHandler: (() => void) | undefined;
  const response = {
    write: (value: string) => { writes.push(value); return true; },
    once: (event: string, handler: () => void) => {
      if (event === "close") closeHandler = handler;
      return response;
    },
    end: () => {},
  } as unknown as ServerResponse;
  const hub = new EventHub(60_000);

  hub.add(response);
  hub.publish({ type: "card.updated", cardId: "6b6e7f6e-aafb-48af-9809-a78135db03a8" });
  hub.publish({ type: "project.updated", projectName: "feature-kanban" });

  assert.equal(writes[0], "retry: 1500\n\n");
  assert.match(writes[1] ?? "", /^data: \{"type":"card\.updated","cardId":"[^"]+"\}\n\n$/);
  assert.doesNotMatch(writes[1] ?? "", /^event:/m);
  assert.equal(writes[2], "data: {\"type\":\"project.updated\",\"projectName\":\"feature-kanban\"}\n\n");
  closeHandler?.();
  hub.close();
});
