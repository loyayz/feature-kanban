import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import type { CardSummary, LifecycleStage } from "../../../../src/shared/lifecycle-contract";
import { LifecycleCardComponent } from "./lifecycle-card.component";

@Component({
  selector: "fk-lifecycle-column",
  standalone: true,
  imports: [LifecycleCardComponent],
  templateUrl: "./lifecycle-column.component.html",
  styleUrl: "./lifecycle-column.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "[attr.data-stage]": "stage" },
})
export class LifecycleColumnComponent {
  @Input({ required: true }) stage!: LifecycleStage;
  @Input({ required: true }) label = "";
  @Input({ required: true }) index = 0;
  @Input({ required: true }) cards: CardSummary[] = [];
  @Output() readonly openCard = new EventEmitter<string>();
}
