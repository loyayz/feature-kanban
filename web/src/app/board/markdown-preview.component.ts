import { ChangeDetectionStrategy, Component, Input } from "@angular/core";

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "code"; language: string; text: string }
  | { kind: "list"; ordered: boolean; items: Array<{ text: string; checked?: boolean }> };

const blockStart = /^(?:#{1,6}\s+|```|>\s?|\s*(?:[-*+] |\d+\. )|\s*(?:---+|\*\*\*+)\s*$)/;

export function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^```\s*(.*)$/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) body.push(lines[index++] ?? "");
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language: fence[1]?.trim() ?? "", text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2] ?? "" });
      index += 1;
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index++] ?? "").replace(/^>\s?/, ""));
      }
      blocks.push({ kind: "quote", text: quote.join("\n") });
      continue;
    }
    const listItem = line.match(/^\s*([-*+]|\d+\.)\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (listItem) {
      const ordered = /\d+\./.test(listItem[1] ?? "");
      const items: Array<{ text: string; checked?: boolean }> = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s*([-*+]|\d+\.)\s+(?:\[([ xX])\]\s+)?(.*)$/);
        if (!item || /\d+\./.test(item[1] ?? "") !== ordered) break;
        items.push({
          text: item[3] ?? "",
          ...(item[2] !== undefined ? { checked: item[2].toLowerCase() === "x" } : {}),
        });
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index]?.trim() && !blockStart.test(lines[index] ?? "")) {
      paragraph.push((lines[index++] ?? "").trim());
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

@Component({
  selector: "fk-markdown-preview",
  standalone: true,
  templateUrl: "./markdown-preview.component.html",
  styleUrl: "./markdown-preview.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownPreviewComponent {
  private value = "";
  blocks: MarkdownBlock[] = [];

  @Input({ required: true })
  set content(content: string) {
    this.value = content;
    this.blocks = parseMarkdown(content);
  }

  get content(): string { return this.value; }
}
