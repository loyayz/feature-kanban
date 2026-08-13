import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, signal } from "@angular/core";
import type { CardDetail, SessionRecord, SpecDocumentResponse } from "../../../../src/shared/lifecycle-contract";
import { CardApiService } from "../core/card-api.service";
import { CodexHostService } from "../core/codex-host.service";
import { MarkdownPreviewComponent } from "./markdown-preview.component";

@Component({
  selector: "fk-card-detail",
  standalone: true,
  imports: [MarkdownPreviewComponent],
  templateUrl: "./card-detail.component.html",
  styleUrl: "./card-detail.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetailComponent implements OnChanges {
  @Input({ required: true }) card!: CardDetail;
  @Output() readonly closeDetail = new EventEmitter<void>();
  @Output() readonly archive = new EventEmitter<boolean>();

  readonly preview = signal<SpecDocumentResponse | null>(null);
  readonly resourceLoading = signal(false);
  readonly resourceError = signal<string | null>(null);
  private operationGeneration = 0;

  constructor(readonly host: CodexHostService, private readonly api: CardApiService) {}

  ngOnChanges(): void {
    this.operationGeneration += 1;
    this.preview.set(null);
    this.resourceLoading.set(false);
    this.resourceError.set(null);
  }

  openProject(): void {
    const generation = ++this.operationGeneration;
    this.resourceLoading.set(true);
    this.resourceError.set(null);
    this.api.openProject(this.card.id).subscribe({
      next: () => {
        if (generation !== this.operationGeneration) return;
        this.resourceLoading.set(false);
      },
      error: () => {
        if (generation !== this.operationGeneration) return;
        this.resourceLoading.set(false);
        this.resourceError.set("无法打开项目目录，请确认路径仍然存在。");
      },
    });
  }

  openSpec(): void {
    const generation = ++this.operationGeneration;
    this.resourceLoading.set(true);
    this.resourceError.set(null);
    this.api.getSpecDocument(this.card.id).subscribe({
      next: (document) => {
        if (generation !== this.operationGeneration) return;
        this.preview.set(document);
        this.resourceLoading.set(false);
      },
      error: () => {
        if (generation !== this.operationGeneration) return;
        this.resourceLoading.set(false);
        this.resourceError.set("无法预览需求文档，请确认 spec 文件仍然存在。");
      },
    });
  }

  closePreview(): void {
    this.operationGeneration += 1;
    this.preview.set(null);
    this.resourceLoading.set(false);
    this.resourceError.set(null);
  }

  openSession(session: SessionRecord): void {
    if (session.aiTool === "codex" && session.externalSessionId) {
      this.host.openCodexSession(session.externalSessionId);
      return;
    }
    if (session.jumpUri?.startsWith("https://")) this.host.openExternal(session.jumpUri);
  }

  canOpen(session: SessionRecord): boolean {
    return Boolean(
      (session.aiTool === "codex" && session.externalSessionId) || session.jumpUri?.startsWith("https://"),
    );
  }

  async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }
}
