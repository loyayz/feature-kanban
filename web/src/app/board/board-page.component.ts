import { ChangeDetectionStrategy, Component, computed, OnInit } from "@angular/core";
import type { CardSummary, LifecycleStage } from "../../../../src/shared/lifecycle-contract";
import { BoardStore } from "../core/board-store";
import { CardDetailComponent } from "./card-detail.component";
import { LifecycleCardComponent } from "./lifecycle-card.component";
import { LifecycleColumnComponent } from "./lifecycle-column.component";

const activeStages = [
  "designing",
  "requirements_review",
  "implementation_planning",
  "implementing_and_reviewing",
  "finalizing_branch",
  "awaiting_integration",
] as const satisfies readonly LifecycleStage[];

type DisplayStage = (typeof activeStages)[number];

const activeStageSet = new Set<LifecycleStage>(activeStages);

const stageLabels: Record<DisplayStage, string> = {
  designing: "方案设计",
  requirements_review: "需求评审",
  implementation_planning: "实现计划",
  implementing_and_reviewing: "编码与评审",
  finalizing_branch: "分支整理",
  awaiting_integration: "待整合",
};

@Component({
  selector: "fk-board-page",
  standalone: true,
  imports: [LifecycleColumnComponent, LifecycleCardComponent, CardDetailComponent],
  templateUrl: "./board-page.component.html",
  styleUrl: "./board-page.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardPageComponent implements OnInit {
  readonly stages = activeStages;
  readonly stageLabels = stageLabels;
  readonly visibleProjects = computed(() => this.store.projects()
    .filter((project) => this.store.showHiddenProjects() || !project.hidden));
  readonly visibleCards = computed<CardSummary[]>(() => this.store.cards()
    .filter((card) => card.archived === this.store.archived()
      && (this.store.archived() || activeStageSet.has(card.stage))
      && (this.store.showHiddenProjects()
        || !this.store.projects().find((project) => project.name === card.projectName)?.hidden))
    .sort((left, right) => right.lastSyncedAt.localeCompare(left.lastSyncedAt)));

  constructor(readonly store: BoardStore) {}

  ngOnInit(): void {
    this.store.load();
  }

  cardsFor(stage: DisplayStage): CardSummary[] {
    return this.visibleCards().filter((card) => card.stage === stage);
  }

  projectCount(name: string): number {
    const selectedProject = this.store.selectedProject();
    if (selectedProject === "all" || selectedProject === name) {
      return this.visibleCards().filter((card) => card.projectName === name).length;
    }
    const project = this.store.projects().find((item) => item.name === name);
    return this.store.archived() ? (project?.archivedCount ?? 0) : (project?.activeCount ?? 0);
  }

  allCount(): number {
    return this.visibleProjects().reduce((sum, project) => sum + this.projectCount(project.name), 0);
  }

  visibleCount(): number {
    return this.visibleCards().length;
  }
}
