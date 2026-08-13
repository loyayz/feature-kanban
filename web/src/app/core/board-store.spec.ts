import { of, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { makeCard, projects } from "../testing/card-fixtures";
import type { CardDetail, CardSummary, ProjectSummary } from "../../../../src/shared/lifecycle-contract";
import type { CardMotionService } from "../board/card-motion.service";
import type { CardApiService } from "./card-api.service";
import { BoardStore } from "./board-store";
import type { CardRefreshCoordinator, RefreshResult } from "./card-refresh-coordinator";

describe("BoardStore", () => {
  function setup() {
    const source = [
      makeCard("card-alpha", "implementing_and_reviewing"),
      makeCard("card-beta", "designing", { projectName: "beta", aiTool: "claude" }),
      makeCard("card-archive", "completed", { archived: true }),
    ];
    const api = {
      listCards: vi.fn((filters: { project?: string; aiTool?: string; archived?: boolean }) =>
        of(source.filter((card) =>
          card.archived === Boolean(filters.archived) &&
          (!filters.project || card.projectName === filters.project) &&
          (!filters.aiTool || card.aiTool === filters.aiTool))),
      ),
      listProjects: vi.fn(() => of(projects)),
      getCard: vi.fn((id: string) => of(source.find((card) => card.id === id)!)),
      setArchived: vi.fn(),
      setProjectHidden: vi.fn((projectName: string, hidden: boolean) => of({
        ...projects.find((project) => project.name === projectName)!,
        hidden,
      })),
    } as unknown as CardApiService;
    const refreshes = new Subject<RefreshResult>();
    const coordinator = { refreshes$: refreshes } as unknown as CardRefreshCoordinator;
    const motion = { capture: vi.fn(), play: vi.fn() } as unknown as CardMotionService;
    const store = new BoardStore(api, coordinator, motion);
    store.load();
    return { api, refreshes, motion, store };
  }

  it("starts with All and applies project, tool, and archive filters without animation", () => {
    const { store, motion } = setup();
    expect(store.selectedProject()).toBe("all");
    expect(store.cards()).toHaveLength(2);
    store.selectProject("beta");
    expect(store.cards().map((card) => card.id)).toEqual(["card-beta"]);
    store.selectTool("claude");
    expect(store.cards().map((card) => card.id)).toEqual(["card-beta"]);
    store.setArchived(true);
    expect(store.cards()).toEqual([]);
    expect(motion.capture).not.toHaveBeenCalled();
  });

  it("persists project visibility, falls back to All, and keeps the eye override transient", () => {
    const { api, store } = setup();
    store.selectProject("beta");
    store.setProjectHidden("beta", true);
    expect(api.setProjectHidden).toHaveBeenCalledWith("beta", true);
    expect(store.selectedProject()).toBe("all");
    expect(store.projects().find((project) => project.name === "beta")?.hidden).toBe(true);
    expect(store.showHiddenProjects()).toBe(false);
    store.toggleHiddenProjects();
    expect(store.showHiddenProjects()).toBe(true);
  });

  it("falls back to All when a hidden selection becomes invisible locally or through SSE", () => {
    let projectSnapshot = projects.map((project) => ({ ...project }));
    const api = {
      listCards: vi.fn(() => of([makeCard("card-beta", "designing", { projectName: "beta" })])),
      listProjects: vi.fn(() => of(projectSnapshot)),
    } as unknown as CardApiService;
    const refreshes = new Subject<RefreshResult>();
    const store = new BoardStore(
      api,
      { refreshes$: refreshes } as unknown as CardRefreshCoordinator,
      { capture: vi.fn(), play: vi.fn() } as unknown as CardMotionService,
    );
    store.load();
    store.toggleHiddenProjects();
    store.selectProject("beta");
    projectSnapshot = projectSnapshot.map((project) =>
      project.name === "beta" ? { ...project, hidden: true } : project);
    refreshes.next({ kind: "full", animate: false });
    expect(store.selectedProject()).toBe("beta");
    store.toggleHiddenProjects();
    expect(store.selectedProject()).toBe("all");

    projectSnapshot = projectSnapshot.map((project) =>
      project.name === "beta" ? { ...project, hidden: false } : project);
    refreshes.next({ kind: "full", animate: false });
    store.selectProject("beta");
    projectSnapshot = projectSnapshot.map((project) =>
      project.name === "beta" ? { ...project, hidden: true } : project);
    refreshes.next({ kind: "full", animate: false });
    expect(store.selectedProject()).toBe("all");
  });

  it("replaces one targeted card and animates a legal stage regression", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    const { store, refreshes, motion } = setup();
    refreshes.next({ kind: "targeted", card: makeCard("card-alpha", "designing"), animate: true });
    expect(store.cards().find((card) => card.id === "card-alpha")?.stage).toBe("designing");
    expect(store.lastMovement()).toEqual({
      cardId: "card-alpha",
      fromStage: "implementing_and_reviewing",
      toStage: "designing",
    });
    expect(motion.capture).toHaveBeenCalledOnce();
    expect(motion.play).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("performs reconnect full loads without movement", () => {
    const { api, refreshes, motion } = setup();
    refreshes.next({ kind: "full", animate: false });
    expect(api.listCards).toHaveBeenCalledTimes(2);
    expect(motion.capture).not.toHaveBeenCalled();
  });

  it("ignores a stale load that completes after a newer project selection", () => {
    const cardRequests = [new Subject<CardSummary[]>(), new Subject<CardSummary[]>()];
    const projectRequests = [new Subject<ProjectSummary[]>(), new Subject<ProjectSummary[]>()];
    let cardRequestIndex = 0;
    let projectRequestIndex = 0;
    const api = {
      listCards: vi.fn(() => cardRequests[cardRequestIndex++]!),
      listProjects: vi.fn(() => projectRequests[projectRequestIndex++]!),
    } as unknown as CardApiService;
    const refreshes = new Subject<RefreshResult>();
    const coordinator = { refreshes$: refreshes } as unknown as CardRefreshCoordinator;
    const motion = { capture: vi.fn(), play: vi.fn() } as unknown as CardMotionService;
    const store = new BoardStore(api, coordinator, motion);

    store.load();
    store.selectProject("beta");
    cardRequests[1]!.next([makeCard("card-beta", "designing", { projectName: "beta" })]);
    cardRequests[1]!.complete();
    projectRequests[1]!.next(projects);
    projectRequests[1]!.complete();
    expect(store.cards().map((card) => card.id)).toEqual(["card-beta"]);

    cardRequests[0]!.next([makeCard("card-alpha")]);
    cardRequests[0]!.complete();
    projectRequests[0]!.next(projects);
    projectRequests[0]!.complete();
    expect(store.selectedProject()).toBe("beta");
    expect(store.cards().map((card) => card.id)).toEqual(["card-beta"]);
    expect(store.loading()).toBe(false);
  });

  it("keeps the latest card detail when an older request completes last", () => {
    const detailRequests = [new Subject<CardDetail>(), new Subject<CardDetail>()];
    let detailRequestIndex = 0;
    const api = {
      getCard: vi.fn(() => detailRequests[detailRequestIndex++]!),
    } as unknown as CardApiService;
    const refreshes = new Subject<RefreshResult>();
    const coordinator = { refreshes$: refreshes } as unknown as CardRefreshCoordinator;
    const motion = { capture: vi.fn(), play: vi.fn() } as unknown as CardMotionService;
    const store = new BoardStore(api, coordinator, motion);

    store.openDetail("card-alpha");
    store.openDetail("card-beta");
    detailRequests[1]!.next(makeCard("card-beta"));
    detailRequests[1]!.complete();
    expect(store.detail()?.id).toBe("card-beta");

    detailRequests[0]!.next(makeCard("card-alpha"));
    detailRequests[0]!.complete();
    expect(store.detail()?.id).toBe("card-beta");
    expect(store.detailLoading()).toBe(false);
  });

  it("does not reopen card detail when a pending request completes after close", () => {
    const detailRequest = new Subject<CardDetail>();
    const api = { getCard: vi.fn(() => detailRequest) } as unknown as CardApiService;
    const refreshes = new Subject<RefreshResult>();
    const coordinator = { refreshes$: refreshes } as unknown as CardRefreshCoordinator;
    const motion = { capture: vi.fn(), play: vi.fn() } as unknown as CardMotionService;
    const store = new BoardStore(api, coordinator, motion);

    store.openDetail("card-alpha");
    store.closeDetail();
    detailRequest.next(makeCard("card-alpha"));
    detailRequest.complete();

    expect(store.detail()).toBeNull();
    expect(store.detailLoading()).toBe(false);
  });

  it("does not let an older full load overwrite a targeted card or newer project counts", () => {
    const cardRequest = new Subject<CardSummary[]>();
    const projectRequests = [new Subject<ProjectSummary[]>(), new Subject<ProjectSummary[]>()];
    let projectRequestIndex = 0;
    const api = {
      listCards: vi.fn(() => cardRequest),
      listProjects: vi.fn(() => projectRequests[projectRequestIndex++]!),
    } as unknown as CardApiService;
    const refreshes = new Subject<RefreshResult>();
    const coordinator = { refreshes$: refreshes } as unknown as CardRefreshCoordinator;
    const motion = { capture: vi.fn(), play: vi.fn() } as unknown as CardMotionService;
    const store = new BoardStore(api, coordinator, motion);

    store.load();
    refreshes.next({
      kind: "targeted",
      card: makeCard("card-alpha", "implementing_and_reviewing"),
      animate: true,
    });
    const currentProjects = [{ name: "alpha", activeCount: 2, archivedCount: 0, hidden: false }];
    projectRequests[1]!.next(currentProjects);
    projectRequests[1]!.complete();

    cardRequest.next([makeCard("card-alpha", "designing")]);
    cardRequest.complete();
    projectRequests[0]!.next([{ name: "alpha", activeCount: 1, archivedCount: 0, hidden: false }]);
    projectRequests[0]!.complete();

    expect(store.cards()[0]?.stage).toBe("implementing_and_reviewing");
    expect(store.projects()).toEqual(currentProjects);
    expect(store.loading()).toBe(false);
  });

  it("does not close a newly opened detail when an older archive request completes", () => {
    const archiveResponse = new Subject<CardDetail>();
    const detailResponse = new Subject<CardDetail>();
    const api = {
      getCard: vi.fn(() => detailResponse),
      setArchived: vi.fn(() => archiveResponse),
      listCards: vi.fn(() => of([])),
      listProjects: vi.fn(() => of(projects)),
    } as unknown as CardApiService;
    const refreshes = new Subject<RefreshResult>();
    const coordinator = { refreshes$: refreshes } as unknown as CardRefreshCoordinator;
    const motion = { capture: vi.fn(), play: vi.fn() } as unknown as CardMotionService;
    const store = new BoardStore(api, coordinator, motion);

    store.openDetail("card-alpha");
    detailResponse.next(makeCard("card-alpha"));
    store.archiveDetail(true);
    store.openDetail("card-beta");
    detailResponse.next(makeCard("card-beta"));
    archiveResponse.next(makeCard("card-alpha", "designing", { archived: true }));
    archiveResponse.complete();

    expect(store.detail()?.id).toBe("card-beta");
    expect(api.listCards).toHaveBeenCalledOnce();
  });
});
