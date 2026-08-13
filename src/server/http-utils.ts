import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { ApiErrorBody } from "../shared/lifecycle-contract.js";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export class BodyReadError extends Error {}

export async function readJsonBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new BodyReadError("Request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new BodyReadError("Request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BodyReadError("Request body must be valid JSON");
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(json);
}

export function sendError(
  response: ServerResponse,
  status: number,
  error: string,
  details?: string[],
): void {
  const body: ApiErrorBody = { error, ...(details && details.length > 0 ? { details } : {}) };
  sendJson(response, status, body);
}

export function applyLocalCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol !== "http:"
      || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")
    ) return false;
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return true;
  } catch {
    return false;
  }
}

export function serveStaticFile(
  response: ServerResponse,
  staticDirectory: string,
  requestPath: string,
): boolean {
  const decoded = decodeURIComponent(requestPath);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(staticDirectory, relative);
  const root = resolve(staticDirectory);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return false;
  try {
    const stats = statSync(candidate);
    if (!stats.isFile()) return false;
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(candidate).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": extname(candidate) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(candidate).pipe(response);
    return true;
  } catch {
    return false;
  }
}
