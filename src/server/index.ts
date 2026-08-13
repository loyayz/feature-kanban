import { appendOperationalLog, createFeatureKanbanApp } from "./app.js";

const app = createFeatureKanbanApp();
let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  appendOperationalLog(app.config, `received ${signal}; shutting down`);
  try {
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

try {
  const address = await app.listen();
  const message = `Feature Kanban listening on http://${address.address}:${address.port}`;
  console.log(message);
  appendOperationalLog(app.config, message);
} catch (error) {
  const failure = error as NodeJS.ErrnoException;
  const message = failure.code === "EADDRINUSE"
    ? `Feature Kanban cannot start because loopback TCP port ${app.config.port} is already in use.`
    : failure.message;
  console.error(message);
  appendOperationalLog(app.config, `startup failed: ${message}`);
  process.exitCode = 1;
}
