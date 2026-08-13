import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import type { ServerConfig } from "../../src/server/config.js";
import {
  installedStandaloneOverrides,
  startStandaloneService,
  type StandaloneApp,
  type StandaloneDependencies,
} from "../../src/server/standalone.js";
import { openWindowsDefaultBrowser } from "../../src/server/windows-browser.js";

const installRoot = "C:\\programs\\Feature Kanban";

function createConfig(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 46171,
    dataDirectory: resolve(homedir(), ".feature-kanban"),
    databasePath: resolve(homedir(), ".feature-kanban", "feature-kanban.sqlite"),
    logPath: resolve(homedir(), ".feature-kanban", "feature-kanban.log"),
    staticDirectory: resolve(installRoot, "app", "web", "browser"),
    version: "0.1.0",
  };
}

function dependenciesFor(
  app: StandaloneApp,
  openBrowser: StandaloneDependencies["openBrowser"],
  events: string[],
): StandaloneDependencies {
  return {
    createApp: (overrides) => {
      events.push(`create:${overrides.host}:${overrides.port}:${overrides.dataDirectory}`);
      return app;
    },
    openBrowser,
    log: (_app, message) => events.push(`log:${message}`),
    warn: (message) => events.push(`warn:${message}`),
  };
}

test("standalone server uses fixed installed configuration and opens the browser after listening", async () => {
  const events: string[] = [];
  let closeCount = 0;
  const app: StandaloneApp = {
    config: createConfig(),
    listen: async () => {
      events.push("listen");
      return { address: "127.0.0.1", family: "IPv4", port: 46171 };
    },
    close: async () => { closeCount += 1; },
  };
  const service = await startStandaloneService(installRoot, dependenciesFor(
    app,
    async (url) => { events.push(`browser:${url}`); },
    events,
  ));

  assert.deepEqual(installedStandaloneOverrides(installRoot), {
    host: "127.0.0.1",
    port: 46171,
    dataDirectory: resolve(homedir(), ".feature-kanban"),
    staticDirectory: resolve(installRoot, "app", "web", "browser"),
    version: "0.1.0",
  });
  assert.ok(events.indexOf("listen") < events.indexOf("browser:http://127.0.0.1:46171"));
  await service.stop("SIGINT");
  await service.stop("SIGHUP");
  assert.equal(closeCount, 1);
});

test("browser launch failure is a warning and leaves the standalone service available", async () => {
  const events: string[] = [];
  let closeCount = 0;
  const app: StandaloneApp = {
    config: createConfig(),
    listen: async () => ({ address: "127.0.0.1", family: "IPv4", port: 46171 }),
    close: async () => { closeCount += 1; },
  };

  const service = await startStandaloneService(installRoot, dependenciesFor(
    app,
    async () => { throw new Error("no browser association"); },
    events,
  ));

  assert.equal(closeCount, 0);
  assert.ok(events.some((event) => event.includes("warn:Feature Kanban is running") && event.includes("no browser association")));
  await service.stop("SIGTERM");
  assert.equal(closeCount, 1);
});

test("operational log failures do not block browser launch or shutdown", async () => {
  const events: string[] = [];
  let closeCount = 0;
  const app: StandaloneApp = {
    config: createConfig(),
    listen: async () => ({ address: "127.0.0.1", family: "IPv4", port: 46171 }),
    close: async () => { closeCount += 1; },
  };
  const dependencies = dependenciesFor(
    app,
    async () => { events.push("browser"); },
    events,
  );
  dependencies.log = () => { throw new Error("log is read-only"); };

  const service = await startStandaloneService(installRoot, dependencies);
  await service.stop("SIGINT");

  assert.ok(events.includes("browser"));
  assert.equal(closeCount, 1);
  assert.equal(events.filter((event) => event.includes("could not write its operational log")).length, 2);
});

test("port conflict closes startup resources and never opens the browser", async () => {
  let closeCount = 0;
  let browserCount = 0;
  const conflict = Object.assign(new Error("occupied"), { code: "EADDRINUSE" });
  const app: StandaloneApp = {
    config: createConfig(),
    listen: async () => { throw conflict; },
    close: async () => { closeCount += 1; },
  };

  await assert.rejects(
    startStandaloneService(installRoot, dependenciesFor(
      app,
      async () => { browserCount += 1; },
      [],
    )),
    /loopback TCP port 46171 is already in use/,
  );
  assert.equal(closeCount, 1);
  assert.equal(browserCount, 0);
});

test("Windows browser adapter invokes the default URL handler without a command shell", async () => {
  const child = new EventEmitter() as ChildProcess;
  let unrefCount = 0;
  child.unref = () => { unrefCount += 1; return child; };
  let invocation: unknown[] | undefined;

  const opened = openWindowsDefaultBrowser("http://127.0.0.1:46171", (command, args, options) => {
    invocation = [command, args, options];
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  await opened;

  assert.deepEqual(invocation, [
    "rundll32.exe",
    ["url.dll,FileProtocolHandler", "http://127.0.0.1:46171/"],
    { detached: true, stdio: "ignore", windowsHide: true },
  ]);
  assert.equal(unrefCount, 1);
  assert.throws(
    () => openWindowsDefaultBrowser("https://example.com", () => child),
    /only opens its loopback HTTP URL/,
  );
});
