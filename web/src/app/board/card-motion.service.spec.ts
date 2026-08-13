import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardMotionService } from "./card-motion.service";

describe("CardMotionService", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("plays one lift, travel, and settle sequence without a text notification", () => {
    const card = document.createElement("article");
    card.dataset["cardId"] = "card-a";
    let moved = false;
    card.getBoundingClientRect = () => ({
      left: moved ? 320 : 20,
      top: moved ? 80 : 40,
      width: 220,
      height: 100,
      right: moved ? 540 : 240,
      bottom: moved ? 180 : 140,
      x: moved ? 320 : 20,
      y: moved ? 80 : 40,
      toJSON: () => ({}),
    });
    const destination = document.createElement("section");
    destination.dataset["stage"] = "designing";
    const addEventListener = vi.fn();
    const animate = vi.fn(
      (_keyframes: Keyframe[] | PropertyIndexedKeyframes, _options?: number | KeyframeAnimationOptions) =>
        ({ addEventListener }) as unknown as Animation,
    );
    card.animate = animate;
    document.body.append(card, destination);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    const service = TestBed.inject(CardMotionService);

    service.capture("card-a");
    moved = true;
    expect(service.play("card-a", "designing")).not.toBeNull();
    expect(animate).toHaveBeenCalledOnce();
    const keyframes = animate.mock.calls[0]![0] as Keyframe[];
    expect(keyframes).toHaveLength(4);
    expect(String(keyframes[1]?.transform)).toContain("scale(1.03)");
    expect(String(keyframes[3]?.transform)).toContain("scale(1)");
    expect(animate.mock.calls[0]![1]).toMatchObject({ duration: 900 });
    expect(document.body.textContent).toBe("");
  });

  it("skips animation for reduced motion or missing geometry", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    const service = TestBed.inject(CardMotionService);
    service.capture("missing");
    expect(service.play("missing", "designing")).toBeNull();
  });

  it("keeps simultaneous card movements independent", () => {
    let moved = false;
    const makeCard = (id: string, initialLeft: number, finalLeft: number) => {
      const card = document.createElement("article");
      card.dataset["cardId"] = id;
      card.getBoundingClientRect = () => ({
        left: moved ? finalLeft : initialLeft,
        top: 40,
        width: 220,
        height: 100,
        right: (moved ? finalLeft : initialLeft) + 220,
        bottom: 140,
        x: moved ? finalLeft : initialLeft,
        y: 40,
        toJSON: () => ({}),
      });
      card.animate = vi.fn(() => ({ addEventListener: vi.fn() }) as unknown as Animation);
      return card;
    };
    const first = makeCard("card-a", 20, 320);
    const second = makeCard("card-b", 320, 620);
    const firstDestination = document.createElement("section");
    firstDestination.dataset["stage"] = "designing";
    const secondDestination = document.createElement("section");
    secondDestination.dataset["stage"] = "requirements_review";
    document.body.append(first, second, firstDestination, secondDestination);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    const service = TestBed.inject(CardMotionService);

    service.capture("card-a");
    service.capture("card-b");
    moved = true;

    expect(service.play("card-a", "designing")).not.toBeNull();
    expect(service.play("card-b", "requirements_review")).not.toBeNull();
    expect(first.animate).toHaveBeenCalledOnce();
    expect(second.animate).toHaveBeenCalledOnce();
  });
});
