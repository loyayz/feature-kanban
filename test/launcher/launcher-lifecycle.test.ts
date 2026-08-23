import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import type { CdpClient, CdpTarget } from "../../src/launcher/cdp-client.js";
import { CodexSupervisor } from "../../src/launcher/codex-supervisor.js";
import { runLauncher, type LauncherDependencies } from "../../src/launcher/index.js";
import type { DesktopProcessAdapter, ManagedChild } from "../../src/launcher/processes.js";
import {
  assertSupportedNodeRuntime,
  installedServiceRuntime,
  ServiceSupervisor,
  type ServiceAdapter,
  type ServiceRuntime,
} from "../../src/launcher/service-supervisor.js";
import { acquireSingleInstance, launcherEndpoint, removeVerifiedStaleSocket } from "../../src/launcher/single-instance.js";

const windowsTest = process.platform === "win32" ? test : test.skip;
const macTest = process.platform === "darwin" ? test : test.skip;

function fakeChild(exitAfterMs = 0): ManagedChild & { terminations: number } {
  return {
    pid: 100,
    terminations: 0,
    waitForExit: () => new Promise((resolve) => setTimeout(() => resolve(0), exitAfterMs)),
    terminate() { this.terminations += 1; },
  };
}

windowsTest("a second named-pipe launch activates the existing launcher", async () => {
  const pipe = `\\\\.\\pipe\\feature-kanban-test-${randomUUID()}`;
  const primary = await acquireSingleInstance(pipe);
  let activated = false;
  primary.onActivate(() => { activated = true; });
  const secondary = await acquireSingleInstance(pipe);
  assert.equal(secondary.primary, false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(activated, true);
  await primary.close();
});

macTest("concurrent launchers recover one crashed Unix socket with exactly one primary", async () => {
  const { existsSync } = await import("node:fs");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const root = await mkdtemp(resolve(tmpdir(), "feature-kanban-live-socket-"));
  const endpoint = resolve(root, "state", "launcher.sock");
  const serverScript = [
    "const { mkdirSync } = require('node:fs');",
    "const { dirname } = require('node:path');",
    "const { createServer } = require('node:net');",
    "mkdirSync(dirname(process.argv[1]), { recursive: true });",
    "createServer().listen(process.argv[1], () => process.stdout.write('ready\\n'));",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const crashed = spawn(process.execPath, ["-e", serverScript, endpoint], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  try {
    await new Promise<void>((resolveReady, reject) => {
      crashed.stdout!.setEncoding("utf8");
      crashed.stdout!.once("data", () => resolveReady());
      crashed.once("error", reject);
      crashed.once("exit", (code) => reject(new Error(`Socket fixture exited early with ${String(code)}`)));
    });
    const crashedExit = once(crashed, "exit");
    crashed.kill("SIGKILL");
    await crashedExit;
    assert.equal(existsSync(endpoint), true);

    const leases = await Promise.all([
      acquireSingleInstance(endpoint),
      acquireSingleInstance(endpoint),
    ]);
    assert.equal(leases.filter((lease) => lease.primary).length, 1);
    await leases.find((lease) => lease.primary)!.close();
    assert.equal(existsSync(endpoint), false);
  } finally {
    if (crashed.exitCode === null && crashed.signalCode === null) crashed.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});

test("launcher endpoints remain platform-specific while services reuse local Node", () => {
  assert.match(launcherEndpoint("C:\\Users\\tester", "win32"), /^\\\\\.\\pipe\\feature-kanban-/);
  assert.match(launcherEndpoint("/Users/tester", "darwin"), /[\\/]\.feature-kanban[\\/]launcher-[0-9a-f]{16}\.sock$/);
  assert.equal(
    installedServiceRuntime("/Applications/Feature Kanban.app/Contents/Resources", {}, "darwin", "/usr/local/bin/node").nodeExecutable,
    "/usr/local/bin/node",
  );
  assert.equal(installedServiceRuntime("C:\\Feature Kanban", {}, "win32", "C:\\Node\\node.exe").nodeExecutable, "C:\\Node\\node.exe");
});

test("requires a local Node.js 24 or newer runtime", () => {
  assert.doesNotThrow(() => assertSupportedNodeRuntime("24.0.0"));
  assert.doesNotThrow(() => assertSupportedNodeRuntime("25.1.0"));
  assert.throws(() => assertSupportedNodeRuntime("23.11.0"), /requires local Node\.js 24 or newer/);
  assert.throws(() => assertSupportedNodeRuntime("invalid"), /requires local Node\.js 24 or newer/);
});

test("stale Unix-socket cleanup refuses an arbitrary file", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const root = await mkdtemp(resolve(tmpdir(), "feature-kanban-socket-"));
  const sentinel = resolve(root, "launcher.sock");
  try {
    await writeFile(sentinel, "keep");
    assert.throws(() => removeVerifiedStaleSocket(sentinel), /unverified launcher socket/);
    assert.equal(await import("node:fs").then(({ existsSync }) => existsSync(sentinel)), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unmanaged Codex blocks startup, shows guidance, and never launches or kills Codex", async () => {
  let messages = 0;
  let launched = 0;
  let serviceStarts = 0;
  let closed = 0;
  const dependencies = {
    acquireLease: async () => ({ primary: true, onActivate: () => {}, close: async () => { closed += 1; } }),
    processes: {
      listCodexDesktopProcesses: async () => [{ pid: 77, executablePath: "OpenAI.Codex_1\\app\\ChatGPT.exe" }],
      resolveCodexExecutable: async () => "ChatGPT.exe",
      launch: () => { launched += 1; return fakeChild(); },
    },
    service: { ensureRunning: async () => { serviceStarts += 1; }, stopOwned: () => {} },
    codex: { run: async () => {}, activate: async () => {}, dispose: () => {} },
    injectionScript: "",
    showMessage: () => { messages += 1; },
  } satisfies LauncherDependencies;
  await runLauncher(dependencies);
  assert.equal(messages, 1);
  assert.equal(launched, 0);
  assert.equal(serviceStarts, 0);
  assert.equal(closed, 1);
});

test("desktop discovery failure releases the primary launcher lease", async () => {
  let closed = 0;
  const dependencies = {
    acquireLease: async () => ({ primary: true, onActivate: () => {}, close: async () => { closed += 1; } }),
    processes: {
      listCodexDesktopProcesses: async () => { throw new Error("desktop discovery failed"); },
      resolveCodexExecutable: async () => "ChatGPT.exe",
      launch: () => fakeChild(),
    },
    service: { ensureRunning: async () => {}, stopOwned: () => {} },
    codex: { run: async () => {}, activate: async () => {}, dispose: () => {} },
    injectionScript: "",
    showMessage: () => {},
  } satisfies LauncherDependencies;

  await assert.rejects(runLauncher(dependencies), /desktop discovery failed/);
  assert.equal(closed, 1);
});

test("a secondary launch never enters the serialized installation preparation", async () => {
  let preflighted = 0;
  let prepared = 0;
  let discoveries = 0;
  const dependencies = {
    acquireLease: async () => ({ primary: false, onActivate: () => {}, close: async () => {} }),
    preflight: async () => { preflighted += 1; },
    prepare: async () => { prepared += 1; },
    processes: {
      listCodexDesktopProcesses: async () => { discoveries += 1; return []; },
      resolveCodexExecutable: async () => "ChatGPT.exe",
      launch: () => fakeChild(),
    },
    service: { ensureRunning: async () => {}, stopOwned: () => {} },
    codex: { run: async () => {}, activate: async () => {}, dispose: () => {} },
    injectionScript: "",
    showMessage: () => {},
  } satisfies LauncherDependencies;

  await runLauncher(dependencies);
  assert.equal(preflighted, 1);
  assert.equal(prepared, 0);
  assert.equal(discoveries, 0);
});

test("failed read-only preflight does not acquire the single-instance lease", async () => {
  let leases = 0;
  const dependencies = {
    acquireLease: async () => {
      leases += 1;
      return { primary: true, onActivate: () => {}, close: async () => {} };
    },
    preflight: async () => { throw new Error("invalid app bundle"); },
    processes: {
      listCodexDesktopProcesses: async () => [],
      resolveCodexExecutable: async () => "ChatGPT.exe",
      launch: () => fakeChild(),
    },
    service: { ensureRunning: async () => {}, stopOwned: () => {} },
    codex: { run: async () => {}, activate: async () => {}, dispose: () => {} },
    injectionScript: "",
    showMessage: () => {},
  } satisfies LauncherDependencies;

  await assert.rejects(runLauncher(dependencies), /invalid app bundle/);
  assert.equal(leases, 0);
});

test("reuses an independent service but stops exactly an owned service", async () => {
  const runtime: ServiceRuntime = {
    healthUrl: "http://127.0.0.1/health",
    nodeExecutable: "node.exe",
    serverEntry: "server.js",
    environment: {},
  };
  const reusedChild = fakeChild();
  const reuseAdapter: ServiceAdapter = {
    probe: async () => true,
    isPortAvailable: async () => false,
    spawn: () => reusedChild,
    delay: async () => {},
  };
  const reused = new ServiceSupervisor(runtime, reuseAdapter);
  assert.equal((await reused.ensureRunning()).owned, false);
  reused.stopOwned();
  assert.equal(reusedChild.terminations, 0);

  const ownedChild = fakeChild();
  let probes = 0;
  const ownedAdapter: ServiceAdapter = {
    probe: async () => ++probes > 1,
    isPortAvailable: async () => true,
    spawn: () => ownedChild,
    delay: async () => {},
  };
  const owned = new ServiceSupervisor(runtime, ownedAdapter);
  assert.equal((await owned.ensureRunning()).owned, true);
  owned.stopOwned();
  assert.equal(ownedChild.terminations, 1);
});

test("refuses an unrelated listener on the board port before spawning a service", async () => {
  const child = fakeChild();
  let spawns = 0;
  const runtime: ServiceRuntime = {
    healthUrl: "http://127.0.0.1:46171/api/health",
    nodeExecutable: "node.exe",
    serverEntry: "server.js",
    environment: {},
  };
  const adapter: ServiceAdapter = {
    probe: async () => false,
    isPortAvailable: async () => false,
    spawn: () => { spawns += 1; return child; },
    delay: async () => {},
  };

  await assert.rejects(new ServiceSupervisor(runtime, adapter).ensureRunning(), /port 46171 is already in use/);
  assert.equal(spawns, 0);
  assert.equal(child.terminations, 0);
});

test("installed service runtime ignores source-mode host, port, and data overrides", () => {
  const runtime = installedServiceRuntime("C:\\Feature Kanban", {
    FEATURE_KANBAN_HOST: "localhost",
    FEATURE_KANBAN_PORT: "49999",
    FEATURE_KANBAN_DATA_DIR: "C:\\source-data",
    FEATURE_KANBAN_STATIC_DIR: "C:\\source-web",
    FEATURE_KANBAN_VERSION: "source",
    KEEP_ME: "yes",
  });

  assert.equal(runtime.environment.FEATURE_KANBAN_HOST, undefined);
  assert.equal(runtime.environment.FEATURE_KANBAN_PORT, undefined);
  assert.equal(runtime.environment.FEATURE_KANBAN_DATA_DIR, undefined);
  assert.equal(runtime.healthUrl, "http://127.0.0.1:46171/api/health");
  assert.match(runtime.environment.FEATURE_KANBAN_STATIC_DIR ?? "", /app[\\/]web[\\/]browser$/);
  assert.equal(runtime.environment.FEATURE_KANBAN_VERSION, "0.1.0");
  assert.equal(runtime.environment.KEEP_ME, "yes");
});

test("injects replacement renderers and performs cleanup when managed Codex exits", async () => {
  const first: CdpTarget = { id: "first", type: "page", url: "one", webSocketDebuggerUrl: "ws://one" };
  const second: CdpTarget = { id: "second", type: "page", url: "two", webSocketDebuggerUrl: "ws://two" };
  const configured: string[] = [];
  const cdp = {
    waitForPage: async () => first,
    configureTarget: async (target: CdpTarget) => { configured.push(target.id); },
    listPages: async () => [first, second],
    bringToFront: async () => {},
  } as unknown as CdpClient;
  const child = fakeChild(35);
  let processChecks = 0;
  let launchArguments: string[] = [];
  const processes = {
    launch: (_executable: string, args: string[]) => { launchArguments = args; return child; },
    listCodexDesktopProcesses: async () => ++processChecks < 4
      ? [{ pid: 100, executablePath: "OpenAI.Codex_1\\app\\ChatGPT.exe" }]
      : [],
    resolveCodexExecutable: async () => "ChatGPT.exe",
  } as DesktopProcessAdapter;
  const supervisor = new CodexSupervisor(processes, cdp, {
    rendererPollMs: 5,
    desktopPollMs: 5,
    portAvailable: async () => true,
  });
  await supervisor.run("ChatGPT.exe", "injection");
  assert.deepEqual(configured.sort(), ["first", "second"]);
  assert.ok(launchArguments.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(launchArguments.includes("--remote-debugging-port=46172"));
  assert.ok(launchArguments.includes("--remote-allow-origins=http://127.0.0.1:46171"));
  supervisor.dispose();
});

test("refuses an occupied CDP port before launching Codex", async () => {
  let launches = 0;
  const processes = {
    launch: () => { launches += 1; return fakeChild(); },
    listCodexDesktopProcesses: async () => [],
    resolveCodexExecutable: async () => "ChatGPT.exe",
  } as DesktopProcessAdapter;
  const cdp = {} as CdpClient;
  const supervisor = new CodexSupervisor(processes, cdp, { portAvailable: async () => false });

  await assert.rejects(supervisor.run("ChatGPT.exe", "injection"), /port 46172 is already in use/);
  assert.equal(launches, 0);
});

test("activation rediscovers the page when the cached renderer target is stale", async () => {
  const first: CdpTarget = { id: "first", type: "page", url: "one", webSocketDebuggerUrl: "ws://one" };
  const attempts: Array<string | undefined> = [];
  const cdp = {
    bringToFront: async (target?: CdpTarget) => {
      attempts.push(target?.id);
      if (target) throw new Error("stale target");
    },
  } as unknown as CdpClient;
  const processes = {
    launch: () => fakeChild(),
    listCodexDesktopProcesses: async () => [],
    resolveCodexExecutable: async () => "ChatGPT.exe",
  } as DesktopProcessAdapter;
  const supervisor = new CodexSupervisor(processes, cdp, { portAvailable: async () => true });
  (supervisor as unknown as { activeTarget: CdpTarget }).activeTarget = first;

  await supervisor.activate();

  assert.deepEqual(attempts, ["first", undefined]);
});

test("terminates the launched Codex child when discovery or injection fails", async () => {
  const child = fakeChild();
  const cdp = {
    waitForPage: async () => { throw new Error("injection unavailable"); },
  } as unknown as CdpClient;
  const processes = {
    launch: () => child,
    listCodexDesktopProcesses: async () => [],
    resolveCodexExecutable: async () => "ChatGPT.exe",
  } as DesktopProcessAdapter;
  const supervisor = new CodexSupervisor(processes, cdp, { portAvailable: async () => true });

  await assert.rejects(supervisor.run("ChatGPT.exe", "injection"), /injection unavailable/);

  assert.equal(child.terminations, 1);
});

test("launcher cleanup stops its service after Codex exits and repeated activation is delegated", async () => {
  let activation: (() => void) | undefined;
  let stopped = 0;
  let disposed = 0;
  let activated = 0;
  const dependencies = {
    acquireLease: async () => ({
      primary: true,
      onActivate: (handler: () => void) => { activation = handler; },
      close: async () => {},
    }),
    processes: {
      listCodexDesktopProcesses: async () => [],
      resolveCodexExecutable: async () => "ChatGPT.exe",
      launch: () => fakeChild(),
    },
    service: { ensureRunning: async () => {}, stopOwned: () => { stopped += 1; } },
    codex: {
      run: async () => { activation?.(); await new Promise((resolve) => setTimeout(resolve, 0)); },
      activate: async () => { activated += 1; },
      dispose: () => { disposed += 1; },
    },
    injectionScript: "injection",
    showMessage: () => {},
  } satisfies LauncherDependencies;
  await runLauncher(dependencies);
  assert.equal(activated, 1);
  assert.equal(stopped, 1);
  assert.equal(disposed, 1);
});
