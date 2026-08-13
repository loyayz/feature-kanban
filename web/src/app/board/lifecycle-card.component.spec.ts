import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { makeCard } from "../testing/card-fixtures";
import { LifecycleCardComponent } from "./lifecycle-card.component";

describe("LifecycleCardComponent", () => {
  it("places the project at top-left, keeps AI tool out of the card, and shows semantic batch context", async () => {
    await TestBed.configureTestingModule({ imports: [LifecycleCardComponent] }).compileComponents();
    const fixture = TestBed.createComponent(LifecycleCardComponent);
    fixture.componentRef.setInput("card", makeCard("card-alpha", "implementing_and_reviewing", {
      projectName: "feature-kanban",
      aiTool: "codex",
      progress: {
        stage: "implementing_and_reviewing",
        step: "coding",
        implementationBatch: 2,
        implementationSummary: "界面交互",
      },
    }));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector(".card__topline .project")?.textContent).toContain("feature-kanban");
    expect(root.textContent).not.toContain("codex");
    expect(root.querySelector(".progress")?.textContent).toContain("正在编码 · 界面交互 / 批次 2");
    expect(root.querySelectorAll(".project")).toHaveLength(1);
  });
});
