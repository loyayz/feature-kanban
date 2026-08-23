import { HttpErrorResponse } from "@angular/common/http";
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { CardApiService } from "../core/card-api.service";
import { CodexHostService } from "../core/codex-host.service";

@Component({
  selector: "fk-create-task-dialog",
  standalone: true,
  templateUrl: "./create-task-dialog.component.html",
  styleUrl: "./create-task-dialog.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateTaskDialogComponent implements AfterViewInit {
  @Input({ required: true }) projectName!: string;
  @Output() readonly closeDialog = new EventEmitter<void>();

  @ViewChild("dialog", { static: true }) private readonly dialog!: ElementRef<HTMLElement>;
  @ViewChild("promptInput", { static: true }) private readonly promptInput!: ElementRef<HTMLTextAreaElement>;

  readonly prompt = signal("");
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly threadId = signal<string | null>(null);
  readonly openAttempted = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  private readonly previouslyFocused =
    globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;

  constructor(
    private readonly api: CardApiService,
    readonly host: CodexHostService,
  ) {}

  ngAfterViewInit(): void {
    this.promptInput.nativeElement.focus();
    this.destroyRef.onDestroy(() => {
      const target = this.previouslyFocused;
      queueMicrotask(() => {
        if (target?.isConnected) target.focus();
      });
    });
  }

  updatePrompt(event: Event): void {
    this.prompt.set((event.target as HTMLTextAreaElement).value);
    this.error.set(null);
  }

  submit(): void {
    const prompt = this.prompt().trim();
    if (!prompt) {
      this.error.set("请输入第一条提示词。");
      this.promptInput.nativeElement.focus();
      return;
    }
    if (prompt.length > 4000) {
      this.error.set("提示词不能超过 4000 个字符。");
      return;
    }
    if (this.submitting() || this.threadId()) return;
    this.submitting.set(true);
    this.error.set(null);
    this.api.createCodexTask(this.projectName, prompt)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ threadId }) => {
          this.threadId.set(threadId);
          this.submitting.set(false);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.error.set(this.errorMessage(error));
        },
      });
  }

  openTask(): void {
    const threadId = this.threadId();
    if (threadId) {
      this.openAttempted.set(true);
      this.host.openCodexSession(threadId);
    }
  }

  requestClose(): void {
    if (!this.submitting()) this.closeDialog.emit();
  }

  @HostListener("keydown", ["$event"])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !this.submitting()) {
      event.preventDefault();
      this.closeDialog.emit();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...this.dialog.nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && globalThis.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && globalThis.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { error?: unknown } | null;
      if (body && typeof body.error === "string" && body.error.trim()) return body.error;
    }
    return "Codex 任务创建失败，请确认本地服务和 Codex 登录状态后重试。";
  }
}
