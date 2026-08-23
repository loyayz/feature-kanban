import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { SpecPreviewDialogComponent } from "./spec-preview-dialog.component";

describe("SpecPreviewDialogComponent", () => {
  it("renders a roomy modal and emits copy and close actions from owned controls", async () => {
    await TestBed.configureTestingModule({ imports: [SpecPreviewDialogComponent] }).compileComponents();
    const fixture = TestBed.createComponent(SpecPreviewDialogComponent);
    fixture.componentRef.setInput("document", {
      path: "C:\\repo\\docs\\superpowers\\specs\\feature.md",
      content: "# Preview\n\nUse `inline code` safely.",
    });
    const close = vi.fn();
    const copy = vi.fn();
    fixture.componentInstance.closePreview.subscribe(close);
    fixture.componentInstance.copyPath.subscribe(copy);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const closeButton = root.querySelector<HTMLButtonElement>('[aria-label="关闭需求文档预览"]')!;
    const copyButton = [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "复制路径")!;

    expect(root.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(root.querySelector("fk-markdown-preview")).not.toBeNull();
    expect(root.textContent).toContain("C:\\repo\\docs\\superpowers\\specs\\feature.md");
    expect(globalThis.document.activeElement).toBe(closeButton);

    closeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(globalThis.document.activeElement).toBe(copyButton);
    copyButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(globalThis.document.activeElement).toBe(closeButton);

    copyButton.click();
    expect(copy).toHaveBeenCalledWith("C:\\repo\\docs\\superpowers\\specs\\feature.md");

    root.querySelector<HTMLElement>(".preview-dialog")!.click();
    expect(close).not.toHaveBeenCalled();
    closeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    closeButton.click();
    root.querySelector<HTMLElement>(".preview-backdrop")!.click();
    expect(close).toHaveBeenCalledTimes(3);
  });
});
