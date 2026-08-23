import { TestBed } from "@angular/core/testing";
import { NEVER, of, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { makeCard, projects } from "../testing/card-fixtures";
import { CardApiService } from "../core/card-api.service";
import { BoardStore } from "../core/board-store";
import { CardRefreshCoordinator } from "../core/card-refresh-coordinator";
import { BoardPageComponent } from "./board-page.component";
import { CardMotionService } from "./card-motion.service";

describe("BoardPageComponent", () => {
  async function render(api: {
    listCards: ReturnType<typeof vi.fn>;
    listProjects: ReturnType<typeof vi.fn>;
    getCard: ReturnType<typeof vi.fn>;
    setProjectHidden?: ReturnType<typeof vi.fn>;
  }) {
    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      providers: [
        { provide: CardApiService, useValue: api },
        { provide: CardRefreshCoordinator, useValue: { refreshes$: NEVER } },
        { provide: CardMotionService, useValue: { capture: vi.fn(), play: vi.fn() } },
        BoardStore,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BoardPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it("renders the seven-stage projection and exposes read-only details without stage editing or dragging", async () => {
    const card = makeCard("card-alpha", "designing");
    const api = {
      listCards: vi.fn(() => of([card])),
      listProjects: vi.fn(() => of(projects)),
      getCard: vi.fn(() => of(card)),
    };
    const fixture = await render(api);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll("fk-lifecycle-column")).toHaveLength(7);
    expect(root.querySelector("fk-lifecycle-column")?.getAttribute("data-stage")).toBe("initializing");
    expect(root.textContent).toContain("All");
    expect(root.textContent).toContain("初始化");
    expect(root.textContent).not.toContain("已完成");
    expect(root.textContent).toContain("1 个可见流程");
    expect(root.querySelectorAll("select")).toHaveLength(0);
    expect(root.querySelectorAll(".segmented button")).toHaveLength(3);
    expect(root.querySelector("[draggable='true']")).toBeNull();

    root.querySelector<HTMLButtonElement>(".card__open")!.click();
    fixture.detectChanges();
    expect(root.querySelector("fk-card-detail")).not.toBeNull();
    expect(root.textContent).toContain("AI 会话");
    expect(root.textContent).toContain("打开 Codex 对话");
    expect(root.textContent).toContain("任务完成后将自动归档");
    expect(root.querySelector(".archive-button")).toBeNull();
  });

  it("requires a concrete project before opening the create-task dialog", async () => {
    const card = makeCard("task-card", "designing");
    const api = {
      listCards: vi.fn(() => of([card])),
      listProjects: vi.fn(() => of(projects)),
      getCard: vi.fn(() => of(card)),
      createCodexTask: vi.fn(),
    };
    const fixture = await render(api);
    const root = fixture.nativeElement as HTMLElement;
    const create = root.querySelector<HTMLButtonElement>(".create-task")!;
    expect(create.disabled).toBe(true);
    expect(create.title).toBe("请先选择一个具体项目");

    [...root.querySelectorAll<HTMLButtonElement>(".project-select")]
      .find((button) => button.textContent?.includes("alpha"))!.click();
    fixture.detectChanges();
    expect(create.disabled).toBe(false);
    create.click();
    fixture.detectChanges();
    expect(root.querySelector("fk-create-task-dialog")).not.toBeNull();
    expect(root.textContent).toContain("这段文字会成为新对话的第一条提示词");
  });

  it("shows initialization, excludes completed, and keeps aggregate badges separate from visible count", async () => {
    const visible = makeCard("card-visible", "requirements_review", { title: "Visible flow" });
    const api = {
      listCards: vi.fn(() => of([
        makeCard("card-initializing", "initializing", { title: "Initializing flow" }),
        visible,
        makeCard("card-completed", "completed"),
      ])),
      listProjects: vi.fn(() => of(projects)),
      getCard: vi.fn(() => of(visible)),
    };
    const fixture = await render(api);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll(".card__open")).toHaveLength(2);
    expect(root.textContent).toContain("Initializing flow");
    expect(root.textContent).toContain("Visible flow");
    expect(root.querySelector(".statusline span")?.textContent).toContain("2 个可见流程");
    const projectCounts = [...root.querySelectorAll(".project-nav button em")].map((count) => count.textContent);
    expect(projectCounts).toEqual(["3", "2", "1"]);
  });

  it("keeps an initializing project's aggregate badge stable when selected", async () => {
    const initializing = makeCard("card-initializing", "initializing", { projectName: "feature-kanban" });
    const projectList = [{ name: "feature-kanban", activeCount: 1, archivedCount: 0, hidden: false }];
    const api = {
      listCards: vi.fn(() => of([initializing])),
      listProjects: vi.fn(() => of(projectList)),
      getCard: vi.fn(() => of(initializing)),
    };
    const fixture = await render(api);
    const root = fixture.nativeElement as HTMLElement;
    const projectButton = [...root.querySelectorAll<HTMLButtonElement>(".project-select")]
      .find((button) => button.textContent?.includes("feature-kanban"))!;

    expect(projectButton.querySelector("em")?.textContent).toBe("1");
    expect(root.textContent).toContain("1 个可见流程");
    projectButton.click();
    fixture.detectChanges();

    expect(api.listCards).toHaveBeenLastCalledWith({ archived: false, project: "feature-kanban" });
    expect(projectButton.querySelector("em")?.textContent).toBe("1");
    expect(root.textContent).toContain("1 个可见流程");
  });

  it("hides persisted projects and cards until the eye override reveals them", async () => {
    const alpha = makeCard("card-alpha", "designing", { title: "Alpha flow" });
    const beta = makeCard("card-beta", "designing", { projectName: "beta", title: "Beta flow" });
    const hiddenProjects = [
      { name: "alpha", activeCount: 1, archivedCount: 0, hidden: false },
      { name: "beta", activeCount: 1, archivedCount: 0, hidden: true },
    ];
    const setProjectHidden = vi.fn(() => of({ ...hiddenProjects[1]!, hidden: false }));
    const api = {
      listCards: vi.fn(() => of([alpha, beta])),
      listProjects: vi.fn(() => of(hiddenProjects)),
      getCard: vi.fn(() => of(alpha)),
      setProjectHidden,
    };
    const fixture = await render(api);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain("Alpha flow");
    expect(root.textContent).not.toContain("Beta flow");
    expect(root.querySelector('[aria-label="恢复项目 beta"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('.project-visibility-master')!.click();
    fixture.detectChanges();
    expect(root.textContent).toContain("Beta flow");
    root.querySelector<HTMLButtonElement>('[aria-label="恢复项目 beta"]')!.click();
    expect(setProjectHidden).toHaveBeenCalledWith("beta", false);
  });

  it("shows every archived stage at active-card width and restores the active projection", async () => {
    const active = makeCard("card-active", "designing", { title: "Active flow" });
    const completed = makeCard("card-completed", "completed", { archived: true, title: "Completed flow" });
    const archivedInProgress = makeCard("card-archived-in-progress", "initializing", {
      archived: true,
      title: "Archived in-progress flow",
    });
    const api = {
      listCards: vi.fn((filters: { archived?: boolean }) => of(
        filters.archived ? [completed, archivedInProgress] : [active],
      )),
      listProjects: vi.fn(() => of(projects)),
      getCard: vi.fn(() => of(completed)),
    };
    const fixture = await render(api);
    const root = fixture.nativeElement as HTMLElement;
    const viewButtons = [...root.querySelectorAll<HTMLButtonElement>(".view-switch button")];

    expect(root.querySelectorAll("fk-lifecycle-column")).toHaveLength(7);
    expect(root.textContent).toContain("Active flow");
    viewButtons.find((button) => button.textContent?.trim() === "已归档")!.click();
    fixture.detectChanges();

    expect(api.listCards).toHaveBeenLastCalledWith({ archived: true });
    expect(root.querySelectorAll("fk-lifecycle-column")).toHaveLength(0);
    expect(root.querySelectorAll(".archive-card fk-lifecycle-card")).toHaveLength(2);
    expect(root.querySelector(".board")?.classList.contains("board--archive")).toBe(true);
    expect(getComputedStyle(root.querySelector(".board")!).gridTemplateColumns).toContain("repeat(6");
    expect(root.textContent).toContain("Completed flow");
    expect(root.textContent).toContain("Archived in-progress flow");
    expect(root.querySelector(".statusline span")?.textContent).toContain("2 个可见流程");
    root.querySelectorAll<HTMLButtonElement>(".archive-card .card__open")[1]!.click();
    expect(api.getCard).toHaveBeenCalledWith("card-archived-in-progress");

    viewButtons.find((button) => button.textContent?.trim() === "进行中")!.click();
    fixture.detectChanges();
    expect(api.listCards).toHaveBeenLastCalledWith({ archived: false });
    expect(root.querySelectorAll("fk-lifecycle-column")).toHaveLength(7);
    expect(root.textContent).toContain("Active flow");
    expect(root.textContent).not.toContain("Completed flow");
  });

  it("does not project retained active cards into an archived load", async () => {
    const active = makeCard("retained-active", "designing", { title: "Retained active flow" });
    const archived = makeCard("loaded-archive", "requirements_review", {
      archived: true,
      title: "Loaded archived flow",
    });
    const archivedRequest = new Subject<ReturnType<typeof makeCard>[]>();
    const api = {
      listCards: vi.fn((filters: { archived?: boolean }) => filters.archived ? archivedRequest : of([active])),
      listProjects: vi.fn(() => of(projects)),
      getCard: vi.fn(() => of(archived)),
    };
    const fixture = await render(api);
    const root = fixture.nativeElement as HTMLElement;

    [...root.querySelectorAll<HTMLButtonElement>(".view-switch button")]
      .find((button) => button.textContent?.trim() === "已归档")!.click();
    fixture.detectChanges();
    expect(root.textContent).not.toContain("Retained active flow");
    expect(root.querySelector(".statusline span")?.textContent).toContain("0 个可见流程");

    archivedRequest.next([archived]);
    archivedRequest.complete();
    fixture.detectChanges();
    expect(root.textContent).toContain("Loaded archived flow");
    expect(root.querySelector(".statusline span")?.textContent).toContain("1 个可见流程");
  });

  it("switches from Claude back to all with explicit tool controls", async () => {
    const codexCard = makeCard("codex-card", "designing", { aiTool: "codex", title: "Codex flow" });
    const claudeCard = makeCard("claude-card", "designing", { aiTool: "claude", title: "Claude flow" });
    const api = {
      listCards: vi.fn((filters: { aiTool?: string }) => of(
        filters.aiTool === "claude" ? [claudeCard] : filters.aiTool === "codex" ? [codexCard] : [codexCard, claudeCard],
      )),
      listProjects: vi.fn(() => of(projects)),
      getCard: vi.fn(() => of(codexCard)),
    };
    const fixture = await render(api);
    const root = fixture.nativeElement as HTMLElement;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".segmented button")];

    buttons.find((button) => button.textContent?.trim() === "Claude")!.click();
    fixture.detectChanges();
    expect(root.textContent).toContain("Claude flow");
    expect(root.textContent).not.toContain("Codex flow");
    expect(api.listCards).toHaveBeenLastCalledWith({ archived: false, aiTool: "claude" });

    buttons.find((button) => button.textContent?.trim() === "全部")!.click();
    fixture.detectChanges();
    expect(root.textContent).toContain("Claude flow");
    expect(root.textContent).toContain("Codex flow");
    expect(api.listCards).toHaveBeenLastCalledWith({ archived: false });
  });

  it("accepts another refresh after the previous load completes", async () => {
    const card = makeCard("refresh-card", "designing");
    const api = {
      listCards: vi.fn(() => of([card])),
      listProjects: vi.fn(() => of(projects)),
      getCard: vi.fn(() => of(card)),
    };
    const fixture = await render(api);
    const root = fixture.nativeElement as HTMLElement;
    const refresh = root.querySelector<HTMLButtonElement>(".refresh")!;

    expect(refresh.disabled).toBe(false);
    refresh.click();
    fixture.detectChanges();
    expect(refresh.disabled).toBe(false);
    refresh.click();
    fixture.detectChanges();

    expect(api.listCards).toHaveBeenCalledTimes(3);
    expect(api.listProjects).toHaveBeenCalledTimes(3);
  });
});
