import { HttpErrorResponse } from "@angular/common/http";
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Subject, of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { CardApiService } from "../core/card-api.service";
import { CodexHostService } from "../core/codex-host.service";
import { CreateTaskDialogComponent } from "./create-task-dialog.component";

describe("CreateTaskDialogComponent", () => {
  async function render(createCodexTask: ReturnType<typeof vi.fn>) {
    const host = { openCodexSession: vi.fn(), navigationError: signal<string | null>(null) };
    await TestBed.configureTestingModule({
      imports: [CreateTaskDialogComponent],
      providers: [
        { provide: CardApiService, useValue: { createCodexTask } },
        { provide: CodexHostService, useValue: host },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CreateTaskDialogComponent);
    fixture.componentRef.setInput("projectName", "alpha");
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, host };
  }

  it("sends the trimmed first prompt and exposes the returned Codex thread", async () => {
    const pending = new Subject<{ threadId: string; status: "in_progress" }>();
    const createCodexTask = vi.fn(() => pending);
    const { fixture, host } = await render(createCodexTask);
    const root = fixture.nativeElement as HTMLElement;
    const textarea = root.querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.value = "  Build the smallest proof.  ";
    textarea.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>(".confirm")!.click();
    fixture.detectChanges();
    expect(createCodexTask).toHaveBeenCalledWith("alpha", "Build the smallest proof.");
    expect(textarea.disabled).toBe(true);
    expect(root.textContent).toContain("正在创建");

    pending.next({ threadId: "thread-created", status: "in_progress" });
    pending.complete();
    fixture.detectChanges();
    expect(root.textContent).toContain("首条提示词正在执行");
    host.navigationError.set("之前的导航错误");
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    root.querySelector<HTMLButtonElement>(".open-task")!.click();
    expect(host.openCodexSession).toHaveBeenCalledWith("thread-created");
    host.navigationError.set("无法在 Codex 中打开这个会话。");
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("无法在 Codex 中打开");
  });

  it("keeps the dialog open with a stable server error and allows retry", async () => {
    const createCodexTask = vi.fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({
        status: 409,
        error: { error: "A Codex task is already running" },
      })))
      .mockReturnValueOnce(of({ threadId: "thread-retry", status: "in_progress" as const }));
    const { fixture } = await render(createCodexTask);
    const root = fixture.nativeElement as HTMLElement;
    const textarea = root.querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.value = "Retry me";
    textarea.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>(".confirm")!.click();
    fixture.detectChanges();
    expect(root.textContent).toContain("A Codex task is already running");
    expect(textarea.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>(".confirm")!.click();
    fixture.detectChanges();
    expect(root.querySelector(".open-task")).not.toBeNull();
  });
});
