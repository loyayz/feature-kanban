import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { NativeLocalCardResources, type LocalResourceSpawner } from "../../src/server/local-card-resources.js";

function childProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.unref = () => child;
  queueMicrotask(() => child.emit("spawn"));
  return child;
}

test("opens an existing project with the platform file manager", async () => {
  const directory = mkdtempSync(join(tmpdir(), "feature-kanban-project-"));
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const spawner: LocalResourceSpawner = (command, args) => {
    calls.push({ command, args });
    return childProcess();
  };
  try {
    await new NativeLocalCardResources("win32", spawner).openProject(directory);
    await new NativeLocalCardResources("darwin", spawner).openProject(directory);
    assert.deepEqual(calls, [
      { command: "explorer.exe", args: [directory] },
      { command: "open", args: [directory] },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reads only regular Markdown specs up to 1 MiB", async () => {
  const directory = mkdtempSync(join(tmpdir(), "feature-kanban-spec-"));
  const spec = join(directory, "feature.md");
  const text = join(directory, "feature.txt");
  const tooLarge = join(directory, "large.md");
  const nested = join(directory, "nested.md");
  writeFileSync(spec, "# Feature\n", "utf8");
  writeFileSync(text, "plain", "utf8");
  writeFileSync(tooLarge, Buffer.alloc(1024 * 1024 + 1));
  mkdirSync(nested);
  const resources = new NativeLocalCardResources("win32", (() => childProcess()) as LocalResourceSpawner);
  try {
    assert.deepEqual(await resources.readSpec(spec), { path: spec, content: "# Feature\n" });
    await assert.rejects(() => resources.readSpec(text), /must be Markdown/);
    await assert.rejects(() => resources.readSpec(tooLarge), /exceeds 1 MiB/);
    await assert.rejects(() => resources.readSpec(nested), /not a file/);
    await assert.rejects(() => resources.readSpec(join(directory, "missing.md")), /does not exist/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects project files and unsupported platforms", async () => {
  const directory = mkdtempSync(join(tmpdir(), "feature-kanban-project-errors-"));
  const file = join(directory, "project.md");
  writeFileSync(file, "# Project", "utf8");
  try {
    const resources = new NativeLocalCardResources("linux", (() => childProcess()) as LocalResourceSpawner);
    await assert.rejects(() => resources.openProject(file), /not a directory/);
    await assert.rejects(() => resources.openProject(directory), /unsupported/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("converts file-manager spawn failures into a stable local-resource error", async () => {
  const directory = mkdtempSync(join(tmpdir(), "feature-kanban-project-spawn-"));
  const spawner: LocalResourceSpawner = () => {
    const child = new EventEmitter() as ChildProcess;
    child.unref = () => child;
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  };
  try {
    await assert.rejects(
      () => new NativeLocalCardResources("win32", spawner).openProject(directory),
      /Project file manager could not be started/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
