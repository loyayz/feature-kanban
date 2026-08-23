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
    const previewButton = [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "预览")!;
    previewButton.focus();
    previewButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
    expect(api.getSpecDocument).toHaveBeenCalledWith("card-detail");
    expect(root.querySelector("fk-spec-preview-dialog")).not.toBeNull();
    expect(root.querySelector(".drawer")?.hasAttribute("inert")).toBe(true);
    expect(root.querySelector(".drawer fk-markdown-preview")).toBeNull();
    expect(root.querySelector(".drawer")?.textContent).toContain("项目路径");
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
    expect(globalThis.document.activeElement).toBe(
      root.querySelector<HTMLButtonElement>('[aria-label="关闭需求文档预览"]'),
    );
    root.querySelector<HTMLButtonElement>('[aria-label="关闭需求文档预览"]')!.click();
    fixture.detectChanges();
    await Promise.resolve();
    expect(root.querySelector("fk-spec-preview-dialog")).toBeNull();
    expect(root.querySelector(".drawer")?.hasAttribute("inert")).toBe(false);
    expect(globalThis.document.activeElement).toBe(previewButton);
    expect(root.querySelector("#detail-title")).not.toBeNull();
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

  it("opens the newest Codex session with a real external ID from the prominent action", async () => {
    const api = { openProject: vi.fn(), getSpecDocument: vi.fn() };
    const sessions = [
      {
        sessionRecordId: "44444444-4444-4444-8444-444444444444", cardId: "card-detail", aiTool: "claude",
        jumpUri: "https://example.test/session", startedAt: "2026-08-12T07:00:00.000Z",
        lastSeenAt: "2026-08-12T07:00:00.000Z", active: false,
      },
      {
        sessionRecordId: "11111111-1111-4111-8111-111111111111", cardId: "card-detail", aiTool: "codex",
        externalSessionId: "thread-old", startedAt: "2026-08-12T08:00:00.000Z", lastSeenAt: "2026-08-12T08:00:00.000Z", active: false,
      },
      {
        sessionRecordId: "22222222-2222-4222-8222-222222222222", cardId: "card-detail", aiTool: "codex",
        startedAt: "2026-08-12T09:00:00.000Z", lastSeenAt: "2026-08-12T09:00:00.000Z", active: false,
      },
      {
        sessionRecordId: "33333333-3333-4333-8333-333333333333", cardId: "card-detail", aiTool: "codex",
        externalSessionId: "thread-new", startedAt: "2026-08-12T10:00:00.000Z", lastSeenAt: "2026-08-12T10:00:00.000Z", active: true,
      },
    ];
    const fixture = await render(api, { sessions });
    const root = fixture.nativeElement as HTMLElement;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.filter((button) => button.textContent?.trim() === "打开 Codex 对话")).toHaveLength(1);
    expect(buttons.filter((button) => button.textContent?.trim() === "打开会话")).toHaveLength(1);
    root.querySelector<HTMLButtonElement>(".codex-entry button")!.click();
    expect(fixture.componentInstance.host.openCodexSession).toHaveBeenCalledWith("thread-new");
    expect(root.querySelector(".codex-entry")?.textContent).toContain("打开这个流程最近一次");
  });

  it("shows an explicit disabled Codex action when no real external ID exists", async () => {
    const api = { openProject: vi.fn(), getSpecDocument: vi.fn() };
    const fixture = await render(api, {
      sessions: [{
        sessionRecordId: "22222222-2222-4222-8222-222222222222", cardId: "card-detail", aiTool: "codex",
        startedAt: "2026-08-12T09:00:00.000Z", lastSeenAt: "2026-08-12T09:00:00.000Z", active: true,
      }],
    });
    const entry = (fixture.nativeElement as HTMLElement).querySelector(".codex-entry")!;
    expect(entry.textContent).toContain("暂无可打开的 Codex 对话");
    expect(entry.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  });
});
