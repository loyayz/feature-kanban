import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { createConnection, createServer, type Server } from "node:net";

export interface SocketIdentity { dev: number; ino: number }

export interface SingleInstanceLease {
  primary: boolean;
  onActivate(handler: () => void): void;
  close(): Promise<void>;
}

export function launcherPipeName(userHome = homedir()): string {
  const identity = createHash("sha256").update(userHome.toLowerCase()).digest("hex").slice(0, 16);
  return `\\\\.\\pipe\\feature-kanban-${identity}`;
}

export function launcherEndpoint(
  userHome = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") return launcherPipeName(userHome);
  const identity = createHash("sha256").update(userHome).digest("hex").slice(0, 16);
  return resolve(userHome, ".feature-kanban", `launcher-${identity}.sock`);
}

function isWindowsPipe(endpoint: string): boolean {
  return endpoint.startsWith("\\\\.\\pipe\\");
}

function sendMessage(endpoint: string, message: "activate" | "probe"): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint, () => socket.end(`${message}\n`));
    socket.once("error", reject);
    socket.once("close", () => resolve());
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ECONNREFUSED" || code === "ENOENT";
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function ensureSafeSocketDirectory(endpoint: string): void {
  const directory = dirname(endpoint);
  try {
    const entry = lstatSync(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Launcher socket directory is unsafe: ${directory}`);
    }
    return;
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  const created = lstatSync(directory);
  if (!created.isDirectory() || created.isSymbolicLink()) {
    throw new Error(`Launcher socket directory is unsafe: ${directory}`);
  }
}

export function removeVerifiedStaleSocket(endpoint: string, expected?: SocketIdentity): void {
  const entry = lstatSync(endpoint);
  if (entry.isSymbolicLink() || !entry.isSocket()) {
    throw new Error(`Refusing to remove an unverified launcher socket: ${endpoint}`);
  }
  if (expected && (entry.dev !== expected.dev || entry.ino !== expected.ino)) {
    throw new Error(`Refusing to remove a launcher socket that changed during recovery: ${endpoint}`);
  }
  unlinkSync(endpoint);
}

function socketIdentity(endpoint: string): SocketIdentity {
  const entry = lstatSync(endpoint);
  if (entry.isSymbolicLink() || !entry.isSocket()) {
    throw new Error(`Launcher endpoint is not a verified socket: ${endpoint}`);
  }
  return { dev: entry.dev, ino: entry.ino };
}

export async function isLauncherActive(endpoint = launcherEndpoint()): Promise<boolean> {
  try {
    await sendMessage(endpoint, "probe");
    return true;
  } catch (error) {
    if (isConnectionRefused(error)) return false;
    throw error;
  }
}

function listen(endpoint: string, onConnection: (message: string) => void): Promise<Server | undefined> {
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", (message) => onConnection(String(message).trim()));
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolveServer(undefined);
      else reject(error);
    });
    server.listen(endpoint, () => resolveServer(server));
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function acquireUnixServer(
  endpoint: string,
  receive: (message: string) => void,
  secondaryMessage: "activate" | "probe",
): Promise<Server | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const server = await listen(endpoint, receive);
    if (server) return server;
    let contested: SocketIdentity;
    try { contested = socketIdentity(endpoint); }
    catch (error) { if (isMissingPath(error)) continue; throw error; }
    try {
      await sendMessage(endpoint, secondaryMessage);
      return undefined;
    } catch (error) {
      if (!isConnectionRefused(error)) throw error;
    }
    await delay(25);
    try {
      const current = socketIdentity(endpoint);
      if (current.dev !== contested.dev || current.ino !== contested.ino) continue;
      await sendMessage(endpoint, secondaryMessage);
      return undefined;
    } catch (error) {
      if (!isConnectionRefused(error) && !isMissingPath(error)) throw error;
    }
    try { removeVerifiedStaleSocket(endpoint, contested); }
    catch (error) {
      if (isMissingPath(error) || /changed during recovery/u.test((error as Error).message)) continue;
      throw error;
    }
  }
  throw new Error(`Unable to acquire or contact the launcher socket after stale recovery: ${endpoint}`);
}

async function closeEndpointServer(
  server: Server,
  endpoint: string,
  ownedSocket?: SocketIdentity,
): Promise<void> {
  await closeServer(server);
  if (isWindowsPipe(endpoint)) return;
  try {
    const current = socketIdentity(endpoint);
    if (!ownedSocket || current.dev !== ownedSocket.dev || current.ino !== ownedSocket.ino) {
      throw new Error(`Refusing to remove a launcher socket that this process did not create: ${endpoint}`);
    }
    unlinkSync(endpoint);
  }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function acquireSingleInstance(
  endpoint = launcherEndpoint(),
  secondaryMessage: "activate" | "probe" = "activate",
): Promise<SingleInstanceLease> {
  let activationHandler = () => {};
  if (!isWindowsPipe(endpoint)) ensureSafeSocketDirectory(endpoint);
  const receive = (message: string): void => {
    if (message === "activate") activationHandler();
  };
  const server = isWindowsPipe(endpoint)
    ? await listen(endpoint, receive)
    : await acquireUnixServer(endpoint, receive, secondaryMessage);
  if (!server) {
    if (isWindowsPipe(endpoint)) await sendMessage(endpoint, secondaryMessage);
    return { primary: false, onActivate: () => {}, close: async () => {} };
  }
  const ownedSocket = isWindowsPipe(endpoint) ? undefined : socketIdentity(endpoint);
  return {
    primary: true,
    onActivate: (handler) => { activationHandler = handler; },
    close: () => closeEndpointServer(server, endpoint, ownedSocket),
  };
}
