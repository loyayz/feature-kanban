import { computed, Injectable, signal } from "@angular/core";
import { forkJoin } from "rxjs";
import type { CardDetail, CardSummary, ProjectSummary } from "../../../../src/shared/lifecycle-contract";
import { CardApiService } from "./card-api.service";
import { CardRefreshCoordinator, type RefreshResult } from "./card-refresh-coordinator";
import { CardMotionService } from "../board/card-motion.service";

export interface CardMovement {
  cardId: string;
  fromStage: CardSummary["stage"];
  toStage: CardSummary["stage"];
}

@Injectable({ providedIn: "root" })
export class BoardStore {
  private readonly cardState = signal<CardSummary[]>([]);
  private readonly projectState = signal<ProjectSummary[]>([]);
  private readonly selectedProjectState = signal("all");
  private readonly selectedToolState = signal("all");
  private readonly archivedState = signal(false);
  private readonly showHiddenProjectsState = signal(false);
  private readonly loadingState = signal(true);
  private readonly errorState = signal<string | null>(null);
  private readonly detailState = signal<CardDetail | null>(null);
  private readonly detailLoadingState = signal(false);
  private readonly lastMovementState = signal<CardMovement | null>(null);
  private loadGeneration = 0;
  private detailGeneration = 0;
  private targetedRefreshSequence = 0;
  private readonly targetedCardSequences = new Map<string, number>();
  private projectGeneration = 0;

  readonly cards = this.cardState.asReadonly();
  readonly projects = this.projectState.asReadonly();
  readonly selectedProject = this.selectedProjectState.asReadonly();
  readonly selectedTool = this.selectedToolState.asReadonly();
  readonly archived = this.archivedState.asReadonly();
  readonly showHiddenProjects = this.showHiddenProjectsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly detail = this.detailState.asReadonly();
  readonly detailLoading = this.detailLoadingState.asReadonly();
  readonly lastMovement = this.lastMovementState.asReadonly();
  readonly totalVisible = computed(() => this.cardState().length);

  constructor(
    private readonly api: CardApiService,
    refreshCoordinator: CardRefreshCoordinator,
    private readonly motion: CardMotionService,
  ) {
    refreshCoordinator.refreshes$.subscribe((refresh) => this.applyRefresh(refresh));
  }

  load(): void {
    const generation = ++this.loadGeneration;
    const targetedSequenceAtStart = this.targetedRefreshSequence;
    const projectGeneration = ++this.projectGeneration;
    this.loadingState.set(true);
    this.errorState.set(null);
    this.lastMovementState.set(null);
    forkJoin({
      cards: this.api.listCards(this.currentFilters()),
      projects: this.api.listProjects(),
    }).subscribe({
      next: ({ cards, projects }) => {
        if (generation !== this.loadGeneration) return;
        if (projectGeneration === this.projectGeneration) this.projectState.set(projects);
        const selectedProject = this.selectedProjectState();
        if (
          !this.showHiddenProjectsState()
          && selectedProject !== "all"
          && projects.some((project) => project.name === selectedProject && project.hidden)
        ) {
          this.selectedProjectState.set("all");
          this.load();
          return;
        }
        this.cardState.set(this.mergeTargetedCards(cards, targetedSequenceAtStart));
        this.loadingState.set(false);
      },
      error: () => {
        if (generation !== this.loadGeneration) return;
        this.errorState.set("看板服务暂时不可用。确认本地服务正在运行后重试。");
        this.loadingState.set(false);
      },
    });
  }

  selectProject(project: string): void {
    if (project === this.selectedProjectState()) return;
    this.selectedProjectState.set(project);
    this.load();
  }

  selectTool(tool: string): void {
    if (tool === this.selectedToolState()) return;
    this.selectedToolState.set(tool);
    this.load();
  }

  setArchived(archived: boolean): void {
    if (archived === this.archivedState()) return;
    this.archivedState.set(archived);
    this.closeDetail();
    this.load();
  }

  toggleHiddenProjects(): void {
    const showHidden = !this.showHiddenProjectsState();
    this.showHiddenProjectsState.set(showHidden);
    const selectedProject = this.selectedProjectState();
    if (
      !showHidden
      && selectedProject !== "all"
      && this.projectState().some((project) => project.name === selectedProject && project.hidden)
    ) {
      this.selectedProjectState.set("all");
      this.load();
    }
  }

  setProjectHidden(projectName: string, hidden: boolean): void {
    this.errorState.set(null);
    this.api.setProjectHidden(projectName, hidden).subscribe({
      next: (project) => {
        if (hidden && this.selectedProjectState() === projectName) {
          this.selectedProjectState.set("all");
          this.load();
        }
        this.projectState.update((projects) =>
          projects.map((entry) => entry.name === project.name ? project : entry));
      },
      error: () => this.errorState.set("无法更新项目显示状态，请确认本地服务可用后重试。"),
    });
  }

  openDetail(cardId: string): void {
    const generation = ++this.detailGeneration;
    this.detailLoadingState.set(true);
    this.api.getCard(cardId).subscribe({
      next: (card) => {
        if (generation !== this.detailGeneration) return;
        this.detailState.set(card);
        this.detailLoadingState.set(false);
      },
      error: () => {
        if (generation !== this.detailGeneration) return;
        this.detailLoadingState.set(false);
      },
    });
  }

  closeDetail(): void {
    this.detailGeneration += 1;
    this.detailState.set(null);
    this.detailLoadingState.set(false);
  }

  clearMovement(): void {
    this.lastMovementState.set(null);
  }

  applyRefresh(refresh: RefreshResult): void {
    if (refresh.kind === "full") {
      this.load();
      return;
    }
    const next = refresh.card;
    const targetedSequence = ++this.targetedRefreshSequence;
    this.targetedCardSequences.set(next.id, targetedSequence);
    const cards = this.cardState();
    const current = cards.find((card) => card.id === next.id);
    const included = this.matchesCurrentFilter(next);
    if (current && included && current.stage !== next.stage) {
      this.motion.capture(next.id);
      this.lastMovementState.set({ cardId: next.id, fromStage: current.stage, toStage: next.stage });
    } else {
      this.lastMovementState.set(null);
    }
    this.cardState.set(
      included
        ? current
          ? cards.map((card) => (card.id === next.id ? next : card))
          : [...cards, next]
        : cards.filter((card) => card.id !== next.id),
    );
    if (current && included && current.stage !== next.stage) {
      const play = () => this.motion.play(next.id, next.stage);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(play));
      else queueMicrotask(play);
    }
    if (this.detailState()?.id === next.id) this.detailState.set(next);
    const projectGeneration = ++this.projectGeneration;
    this.api.listProjects().subscribe({
      next: (projects) => {
        if (projectGeneration === this.projectGeneration) this.projectState.set(projects);
      },
    });
  }

  private mergeTargetedCards(cards: CardSummary[], targetedSequenceAtStart: number): CardSummary[] {
    const merged = new Map(cards.map((card) => [card.id, card]));
    const currentCards = new Map(this.cardState().map((card) => [card.id, card]));
    for (const [cardId, sequence] of this.targetedCardSequences) {
      if (sequence <= targetedSequenceAtStart) continue;
      const current = currentCards.get(cardId);
      if (current && this.matchesCurrentFilter(current)) merged.set(cardId, current);
      else merged.delete(cardId);
    }
    return [...merged.values()];
  }

  private currentFilters() {
    return {
      archived: this.archivedState(),
      ...(this.selectedProjectState() === "all" ? {} : { project: this.selectedProjectState() }),
      ...(this.selectedToolState() === "all" ? {} : { aiTool: this.selectedToolState() }),
    };
  }

  private matchesCurrentFilter(card: CardSummary): boolean {
    return (
      card.archived === this.archivedState() &&
      (this.selectedProjectState() === "all" || card.projectName === this.selectedProjectState()) &&
      (this.selectedToolState() === "all" || card.aiTool === this.selectedToolState())
    );
  }
}
