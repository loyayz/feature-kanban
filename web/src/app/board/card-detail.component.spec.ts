import { TestBed } from "@angular/core/testing";
import { of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { CardApiService } from "../core/card-api.service";
import { CodexHostService } from "../core/codex-host.service";
import { makeCard } from "../testing/card-fixtures";
import { CardDetailComponent } from "./card-detail.component";

describe("CardDetailComponent", () => {
  async function render(api: {
    openProject: ReturnType<typeof vi.fn>;
    getSpecDocument: ReturnType<typeof vi.fn>;
  }, overrides = {}) {
    await TestBed.configureTestingModule({
      imports: [CardDetailComponent],
      providers: [
        { provide: CardApiService, useValue: api },
        {
          provide: CodexHostService,
          useValue: {
            navigationError: () => null,
            openCodexSession: vi.fn(),
            openExternal: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CardDetailComponent);
    fixture.componentRef.setInput("card", makeCard("card-detail", "designing", overrides));
    fixture.detectChanges();
    return fixture;
  }

  it("shows AI tool in details, opens the stored project, and previews the generated spec", async () => {
    const api = {
      openProject: vi.fn(() => of(undefined)),
      getSpecDocument: vi.fn(() => of({
        path: "C:\\repo\\docs\\superpowers\\specs\\feature.md",
        content: "# Requirement\n\n<script>alert(1)</script>",
      })),
    };
    const fixture = await render(api);
    let root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector(".eyebrow")?.textContent).toContain("codex");
    expect(root.textContent).toContain("AI 工具");
    expect(root.textContent).toContain("codex");
    expect(root.textContent).toContain("生命周期文档");
    expect([...root.querySelectorAll(".facts button")].filter((button) => button.textContent?.trim() === "预览")).toHaveLength(1);

    [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "打开项目")!.click();
    expect(api.openProject).toHaveBeenCalledWith("card-detail");
    [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "预览")!.click();
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
    expect(api.getSpecDocument).toHaveBeenCalledWith("card-detail");
    expect(root.querySelector("fk-markdown-preview")).not.toBeNull();
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
  });

  it("shows legacy metadata fallbacks and keeps resource failures in the detail", async () => {
    const api = {
      openProject: vi.fn(() => throwError(() => new Error("missing"))),
      getSpecDocument: vi.fn(() => throwError(() => new Error("missing"))),
    };
    const fixture = await render(api, { projectPath: undefined, specDocumentPath: undefined });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain("未上报项目路径");
    expect(root.textContent).toContain("未上报 spec 文档");
    expect(root.querySelector("fk-markdown-preview")).toBeNull();
  });
});
