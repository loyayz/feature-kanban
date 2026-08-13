import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { MarkdownPreviewComponent, parseMarkdown } from "./markdown-preview.component";

describe("MarkdownPreviewComponent", () => {
  it("parses the lifecycle spec block vocabulary", () => {
    const blocks = parseMarkdown([
      "# Title",
      "",
      "> Context",
      "",
      "- [x] Complete",
      "- [ ] Pending",
      "",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n"));
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "quote", "list", "code"]);
    expect(blocks[2]).toMatchObject({
      kind: "list",
      items: [{ text: "Complete", checked: true }, { text: "Pending", checked: false }],
    });
  });

  it("renders HTML-like document content as inert text", async () => {
    await TestBed.configureTestingModule({ imports: [MarkdownPreviewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(MarkdownPreviewComponent);
    fixture.componentRef.setInput("content", "# Safe\n\n<img src=x onerror=alert(1)>");
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
