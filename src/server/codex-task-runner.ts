import { statSync } from "node:fs";
import type { CreateCodexTaskResponse } from "../shared/lifecycle-contract.js";
import type { CardRepository } from "./card-repository.js";
import { CodexRuntimeUnavailableError, CodexTaskBusyError, CodexTaskProjectError } from "./errors.js";

export interface RunningCodexTask {
  threadId: string;
  completion: Promise<void>;
  stop(): Promise<void>;
}

export interface CodexTaskRunner {
  start(input: { cwd: string; prompt: string }): Promise<RunningCodexTask>;
}

export class CodexTaskCoordinator {
  private activeTask: RunningCodexTask | undefined;
  private startPromise: Promise<RunningCodexTask> | undefined;
  private readonly stoppingTasks = new WeakMap<RunningCodexTask, Promise<void>>();
  private closed = false;

  constructor(
    private readonly repository: CardRepository,
    private readonly runner: CodexTaskRunner,
  ) {}

  async create(projectName: string, prompt: string): Promise<CreateCodexTaskResponse> {
    if (this.closed) throw new CodexRuntimeUnavailableError("Codex task service is shutting down");
    if (this.startPromise || this.activeTask) throw new CodexTaskBusyError("A Codex task is already running");
    const paths = this.repository.listProjectPaths(projectName);
    if (paths.length === 0) throw new CodexTaskProjectError("Project path is unavailable");
    if (paths.length > 1) throw new CodexTaskProjectError("Project name maps to multiple directories");
    const cwd = paths[0]!;
    try {
      if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new CodexTaskProjectError("Project directory is unavailable");
    }

    const startPromise = this.runner.start({ cwd, prompt });
    this.startPromise = startPromise;
    let task: RunningCodexTask;
    try {
      task = await startPromise;
    } finally {
      if (this.startPromise === startPromise) this.startPromise = undefined;
    }
    if (this.closed) {
      await this.stopTask(task);
      throw new CodexRuntimeUnavailableError("Codex task service is shutting down");
    }
    this.activeTask = task;
    const release = (): void => {
      if (this.activeTask === task) this.activeTask = undefined;
    };
    void task.completion.then(release, release);
    return { threadId: task.threadId, status: "in_progress" };
  }

  async close(): Promise<void> {
    this.closed = true;
    const startPromise = this.startPromise;
    if (startPromise) {
      try {
        const startingTask = await startPromise;
        await this.stopTask(startingTask);
      } catch {
        // Startup failure already propagates to the request that owns it.
      }
    }
    const task = this.activeTask;
    this.activeTask = undefined;
    if (task) await this.stopTask(task);
  }

  private stopTask(task: RunningCodexTask): Promise<void> {
    const existing = this.stoppingTasks.get(task);
    if (existing) return existing;
    const stopping = task.stop();
    this.stoppingTasks.set(task, stopping);
    return stopping;
  }
}
