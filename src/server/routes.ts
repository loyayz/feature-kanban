import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  validateCreateCodexTask,
} from "../shared/codex-task-validation.js";
import {
  validateCreateCard,
  validateProjectVisibilityBody,
  validateUpdateCard,
} from "../shared/lifecycle-validation.js";
import type { HealthResponse } from "../shared/lifecycle-contract.js";
import type { CardRepository } from "./card-repository.js";
import type { CodexTaskCoordinator } from "./codex-task-runner.js";
import {
  CodexProtocolError,
  CodexRuntimeUnavailableError,
  CodexTaskBusyError,
  CodexTaskProjectError,
  ConflictError,
  LocalResourceNotFoundError,
  LocalResourceOperationError,
  LocalResourceValidationError,
  NotFoundError,
  UnsupportedPlatformError,
  ValidationStorageError,
} from "./errors.js";
import type { EventHub } from "./event-hub.js";
import type { LocalCardResources } from "./local-card-resources.js";
import {
  applyLocalCors,
  BodyReadError,
  readJsonBody,
  sendError,
  sendJson,
  serveStaticFile,
} from "./http-utils.js";

export interface RouteDependencies {
  repository: CardRepository;
  eventHub: EventHub;
  staticDirectory: string;
  version: string;
  localResources: LocalCardResources;
  codexTasks: CodexTaskCoordinator;
}

function parseArchived(value: string | null): boolean {
  return value === "true" || value === "1";
}

function cardIdFrom(pathname: string, suffix = ""): string | undefined {
  const pattern = suffix
    ? new RegExp(`^/api/cards/([^/]+)/${suffix}$`)
    : /^\/api\/cards\/([^/]+)$/;
  const match = pathname.match(pattern);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function projectNameFrom(pathname: string): string | undefined {
  const match = pathname.match(/^\/api\/projects\/([^/]+)\/visibility$/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function handleFailure(response: ServerResponse, error: unknown): void {
  if (error instanceof BodyReadError) return sendError(response, 400, error.message);
  if (error instanceof NotFoundError) return sendError(response, 404, error.message);
  if (error instanceof LocalResourceNotFoundError) return sendError(response, 404, error.message);
  if (error instanceof LocalResourceValidationError) return sendError(response, 422, error.message);
  if (error instanceof UnsupportedPlatformError) return sendError(response, 501, error.message);
  if (error instanceof LocalResourceOperationError) return sendError(response, 500, error.message);
  if (error instanceof ConflictError) return sendError(response, 409, error.message);
  if (error instanceof CodexTaskProjectError) return sendError(response, 409, error.message);
  if (error instanceof CodexTaskBusyError) return sendError(response, 409, error.message);
  if (error instanceof CodexRuntimeUnavailableError) return sendError(response, 503, error.message);
  if (error instanceof CodexProtocolError) return sendError(response, 502, error.message);
  if (error instanceof ValidationStorageError) return sendError(response, 500, error.message);
  console.error(error);
  sendError(response, 500, "Internal server error");
}

export function createRequestHandler(dependencies: RouteDependencies) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!applyLocalCors(request, response)) {
      sendError(response, 403, "Origin is not allowed");
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const { pathname } = url;
    try {
      if (request.method === "GET" && pathname === "/api/health") {
        const health: HealthResponse = {
          product: "feature-kanban",
          version: dependencies.version,
          pid: process.pid,
        };
        sendJson(response, 200, health);
        return;
      }
      if (request.method === "GET" && pathname === "/api/projects") {
        sendJson(response, 200, { projects: dependencies.repository.listProjects() });
        return;
      }
      if (request.method === "GET" && pathname === "/api/cards") {
        sendJson(response, 200, {
          cards: dependencies.repository.listCards({
            ...(url.searchParams.get("project") ? { project: url.searchParams.get("project")! } : {}),
            ...(url.searchParams.get("aiTool") ? { aiTool: url.searchParams.get("aiTool")! } : {}),
            archived: parseArchived(url.searchParams.get("archived")),
          }),
        });
        return;
      }
      if (request.method === "GET" && pathname === "/api/events") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        dependencies.eventHub.add(response);
        return;
      }
      if (request.method === "POST" && pathname === "/api/cards") {
        const validation = validateCreateCard(await readJsonBody(request));
        if (!validation.ok) return sendError(response, 400, "Invalid card", validation.errors);
        const result = dependencies.repository.createCard(validation.value);
        if (result.created) dependencies.eventHub.publish({ type: "card.created", cardId: result.card.id });
        sendJson(response, result.created ? 201 : 200, { card: result.card, created: result.created });
        return;
      }
      if (request.method === "POST" && pathname === "/api/codex/tasks") {
        const validation = validateCreateCodexTask(await readJsonBody(request));
        if (!validation.ok) return sendError(response, 400, "Invalid Codex task", validation.errors);
        const task = await dependencies.codexTasks.create(validation.value.projectName, validation.value.prompt);
        sendJson(response, 202, task);
        return;
      }

      const projectName = projectNameFrom(pathname);
      if (request.method === "PATCH" && projectName) {
        const validation = validateProjectVisibilityBody(await readJsonBody(request));
        if (!validation.ok) return sendError(response, 400, "Invalid project visibility", validation.errors);
        const project = dependencies.repository.setProjectHidden(projectName, validation.value.hidden);
        dependencies.eventHub.publish({ type: "project.updated", projectName: project.name });
        sendJson(response, 200, { project });
        return;
      }

      const openProjectCardId = cardIdFrom(pathname, "open-project");
      if (request.method === "POST" && openProjectCardId) {
        const card = dependencies.repository.getCard(openProjectCardId);
        if (!card.projectPath) throw new NotFoundError("Project path is unavailable");
        await dependencies.localResources.openProject(card.projectPath);
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
        return;
      }

      const specDocumentCardId = cardIdFrom(pathname, "spec-document");
      if (request.method === "GET" && specDocumentCardId) {
        const card = dependencies.repository.getCard(specDocumentCardId);
        if (!card.specDocumentPath) throw new NotFoundError("Spec document path is unavailable");
        sendJson(response, 200, await dependencies.localResources.readSpec(card.specDocumentPath));
        return;
      }

      const cardId = cardIdFrom(pathname);
      if (request.method === "GET" && cardId) {
        sendJson(response, 200, { card: dependencies.repository.getCard(cardId) });
        return;
      }
      if (request.method === "PATCH" && cardId) {
        const validation = validateUpdateCard(await readJsonBody(request));
        if (!validation.ok) return sendError(response, 400, "Invalid card snapshot", validation.errors);
        const card = dependencies.repository.updateCard(cardId, validation.value);
        dependencies.eventHub.publish({ type: "card.updated", cardId: card.id });
        sendJson(response, 200, { card });
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendError(response, 404, "API route not found");
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        sendError(response, 405, "Method not allowed");
        return;
      }
      if (serveStaticFile(response, dependencies.staticDirectory, pathname)) return;
      const indexPath = resolve(dependencies.staticDirectory, "index.html");
      if (existsSync(indexPath) && serveStaticFile(response, dependencies.staticDirectory, "/index.html")) return;
      sendError(response, 404, "Feature Kanban web assets are not built");
    } catch (error) {
      handleFailure(response, error);
    }
  };
}
