import { DOCUMENT } from "@angular/common";
import { inject, Injectable } from "@angular/core";
import type { LifecycleStage } from "../../../../src/shared/lifecycle-contract";

export interface MotionGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

@Injectable({ providedIn: "root" })
export class CardMotionService {
  private readonly document = inject(DOCUMENT);
  private readonly sources = new Map<string, MotionGeometry>();

  capture(cardId: string): void {
    this.sources.delete(cardId);
    if (this.reduceMotion()) return;
    const element = this.cardElement(cardId);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    this.sources.set(cardId, rect);
  }

  play(cardId: string, destinationStage: LifecycleStage): Animation | null {
    const source = this.sources.get(cardId);
    this.sources.delete(cardId);
    if (!source || this.reduceMotion()) return null;
    const target = this.cardElement(cardId);
    const destination = this.document.querySelector<HTMLElement>(`[data-stage="${destinationStage}"]`);
    if (!target || !destination) return null;
    const finalRect = target.getBoundingClientRect();
    const dx = source.left - finalRect.left;
    const dy = source.top - finalRect.top;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    destination.dataset["arrival"] = "true";
    const animation = target.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(1)`, boxShadow: "0 2px 6px rgb(20 34 56 / 8%)", offset: 0 },
        { transform: `translate(${dx * 0.96}px, ${dy * 0.96 - 10}px) scale(1.03)`, boxShadow: "0 20px 36px rgb(20 34 56 / 25%)", offset: 0.2 },
        { transform: `translate(${dx * 0.12}px, ${dy * 0.12 - 6}px) scale(1.018)`, boxShadow: "0 14px 28px rgb(20 34 56 / 19%)", offset: 0.76 },
        { transform: "translate(0, 0) scale(1)", boxShadow: "0 2px 6px rgb(20 34 56 / 8%)", offset: 1 },
      ],
      { duration: 900, easing: "cubic-bezier(.22,.72,.18,1)" },
    );
    animation.addEventListener("finish", () => delete destination.dataset["arrival"], { once: true });
    return animation;
  }

  private cardElement(cardId: string): HTMLElement | null {
    return this.document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`);
  }

  private reduceMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
}
