import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { BoardPageComponent } from "./board/board-page.component";
import { CodexHostService } from "./core/codex-host.service";

@Component({
  selector: "fk-root",
  standalone: true,
  imports: [BoardPageComponent],
  template: "<fk-board-page />",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly codexHost = inject(CodexHostService);

  constructor() {
    this.codexHost.connect();
  }
}
