import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from "@angular/core";
import type { SpecDocumentResponse } from "../../../../src/shared/lifecycle-contract";
import { MarkdownPreviewComponent } from "./markdown-preview.component";

@Component({
  selector: "fk-spec-preview-dialog",
  standalone: true,
  imports: [MarkdownPreviewComponent],
  templateUrl: "./spec-preview-dialog.component.html",
  styleUrl: "./spec-preview-dialog.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecPreviewDialogComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) document!: SpecDocumentResponse;
  @Output() readonly closePreview = new EventEmitter<void>();
  @Output() readonly copyPath = new EventEmitter<string>();

  @ViewChild("dialog", { static: true }) private readonly dialog!: ElementRef<HTMLElement>;
  @ViewChild("closeButton", { static: true }) private readonly closeButton!: ElementRef<HTMLButtonElement>;

  private readonly previouslyFocused =
    globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;

  ngAfterViewInit(): void {
    this.closeButton.nativeElement.focus();
  }

  ngOnDestroy(): void {
    const target = this.previouslyFocused;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
  }

  @HostListener("keydown", ["$event"])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.closePreview.emit();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...this.dialog.nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
}
