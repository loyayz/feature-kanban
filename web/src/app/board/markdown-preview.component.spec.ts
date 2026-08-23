import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { MarkdownPreviewComponent, parseInlineMarkdown, parseMarkdown } from "./markdown-preview.component";

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
      items: [
        { content: [{ kind: "text", text: "Complete" }], checked: true },
        { content: [{ kind: "text", text: "Pending" }], checked: false },
      ],
    });
  });

  it("parses paired backticks as inline code and leaves unmatched delimiters as text", () => {
    expect(parseInlineMarkdown("Use `cardId` and `branch`.")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "inline-code", text: "cardId" },
      { kind: "text", text: " and " },
      { kind: "inline-code", text: "branch" },
      { kind: "text", text: "." },
    ]);
    expect(parseInlineMarkdown("Keep `unclosed")).toEqual([
      { kind: "text", text: "Keep `unclosed" },
    ]);
  });

  it("renders inline code across block contexts without delimiter text", async () => {
    await TestBed.configureTestingModule({ imports: [MarkdownPreviewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(MarkdownPreviewComponent);
    fixture.componentRef.setInput("content", [
      "# `Heading`",
      "",
      "Use `paragraph`.",
      "",
      "> Quote `value`",
      "",
      "- Item `one`",
      "1. Item `two`",
      "",
      "Keep `unclosed",
      "",
      "```ts",
      "const raw = `fenced`;",
      "```",
    ].join("\n"));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect([...root.querySelectorAll(".inline-code")].map((node) => node.textContent)).toEqual([
      "Heading", "paragraph", "value", "one", "two",
    ]);
    expect(root.textContent).not.toContain("`Heading`");
    expect(root.textContent).not.toContain("`paragraph`");
    expect(root.textContent).toContain("Keep `unclosed");
    expect(root.querySelector("pre")?.textContent).toContain("const raw = `fenced`;");
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
