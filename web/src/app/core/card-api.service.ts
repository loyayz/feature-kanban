import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import type {
  CardChangedEvent,
  CardDetail,
  CardFilters,
  CardSummary,
  CreateCodexTaskResponse,
  ProjectChangedEvent,
  ProjectSummary,
  SpecDocumentResponse,
} from "../../../../src/shared/lifecycle-contract";

export type BoardNotification =
  | { kind: "card"; event: CardChangedEvent }
  | { kind: "project"; event: ProjectChangedEvent }
  | { kind: "reconnected" };

function boardChange(value: unknown): BoardNotification | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    (record["type"] === "card.created" ||
      record["type"] === "card.updated") &&
    typeof record["cardId"] === "string"
  ) return { kind: "card", event: record as unknown as CardChangedEvent };
  if (record["type"] === "project.updated" && typeof record["projectName"] === "string") {
    return { kind: "project", event: record as unknown as ProjectChangedEvent };
  }
  return undefined;
}

@Injectable({ providedIn: "root" })
export class CardApiService {
  constructor(private readonly http: HttpClient) {}

  listCards(filters: CardFilters): Observable<CardSummary[]> {
    let params = new HttpParams().set("archived", String(filters.archived ?? false));
    if (filters.project) params = params.set("project", filters.project);
    if (filters.aiTool) params = params.set("aiTool", filters.aiTool);
    return new Observable((subscriber) => {
      const subscription = this.http
        .get<{ cards: CardSummary[] }>("/api/cards", { params })
        .subscribe({
          next: ({ cards }) => subscriber.next(cards),
          error: (error: unknown) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });
      return () => subscription.unsubscribe();
    });
  }

  listProjects(): Observable<ProjectSummary[]> {
    return new Observable((subscriber) => {
      const subscription = this.http.get<{ projects: ProjectSummary[] }>("/api/projects").subscribe({
        next: ({ projects }) => subscriber.next(projects),
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      return () => subscription.unsubscribe();
    });
  }

  getCard(cardId: string): Observable<CardDetail> {
    return new Observable((subscriber) => {
      const subscription = this.http.get<{ card: CardDetail }>(`/api/cards/${encodeURIComponent(cardId)}`).subscribe({
        next: ({ card }) => subscriber.next(card),
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      return () => subscription.unsubscribe();
    });
  }

  setProjectHidden(projectName: string, hidden: boolean): Observable<ProjectSummary> {
    return new Observable((subscriber) => {
      const subscription = this.http
        .patch<{ project: ProjectSummary }>(
          `/api/projects/${encodeURIComponent(projectName)}/visibility`,
          { hidden },
        )
        .subscribe({
          next: ({ project }) => subscriber.next(project),
          error: (error: unknown) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });
      return () => subscription.unsubscribe();
    });
  }

  openProject(cardId: string): Observable<void> {
    return this.http.post<void>(`/api/cards/${encodeURIComponent(cardId)}/open-project`, null);
  }

  getSpecDocument(cardId: string): Observable<SpecDocumentResponse> {
    return this.http.get<SpecDocumentResponse>(`/api/cards/${encodeURIComponent(cardId)}/spec-document`);
  }

  createCodexTask(projectName: string, prompt: string): Observable<CreateCodexTaskResponse> {
    return this.http.post<CreateCodexTaskResponse>("/api/codex/tasks", { projectName, prompt });
  }

  notifications(): Observable<BoardNotification> {
    return new Observable((subscriber) => {
      const source = new EventSource("/api/events");
      let opened = false;
      let reconnecting = false;
      source.onopen = () => {
        if (opened || reconnecting) subscriber.next({ kind: "reconnected" });
        opened = true;
        reconnecting = false;
      };
      source.onmessage = (message) => {
        try {
          const parsed: unknown = JSON.parse(message.data as string);
          const notification = boardChange(parsed);
          if (notification) subscriber.next(notification);
        } catch {
          // Ignore malformed local notifications; a later reconnect performs a full refresh.
        }
      };
      source.onerror = () => {
        // EventSource owns reconnection; onopen emits the refresh signal once reconnected.
        reconnecting = true;
      };
      return () => source.close();
    });
  }
}
