import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import {
  NativeMacProcessAdapter,
  parseMacProcessList,
  resolveMacBundleExecutable,
  type MacProcessDependencies,
} from "../../src/launcher/macos-processes.js";
import { macOSAlertArguments } from "../../src/launcher/message-box.js";
import { wrapManagedChild } from "../../src/launcher/processes.js";

function missing(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`missing: ${path}`), { code: "ENOENT" });
}

function fakeChild(): ChildProcess & { terminations: number } {
  const child = new EventEmitter() as ChildProcess & { terminations: number };
  Object.assign(child, {
    pid: 321,
    killed: false,
    terminations: 0,
    kill() { this.killed = true; this.terminations += 1; return true; },
  });
  return child;
}

interface BundleFixture { candidate: string; canonical: string; executable: string }

function fakeDependencies(
  bundles: BundleFixture[],
  processList = "",
): MacProcessDependencies & { launches: Array<{ executable: string; args: string[]; environment: NodeJS.ProcessEnv }> } {
  const launches: Array<{ executable: string; args: string[]; environment: NodeJS.ProcessEnv }> = [];
  return {
    launches,
    homeDirectory: () => "/Users/tester",
    canonicalPath: async (path) => {
      const bundle = bundles.find((candidate) => candidate.candidate === path);
      if (bundle) return bundle.canonical;
      const executable = bundles.find((candidate) => (
        path === resolve(candidate.canonical, "Contents", "MacOS", "ChatGPT")
        || path === resolve(candidate.canonical, "Contents", "MacOS", "Codex")
      ));
      if (executable) return executable.executable;
      throw missing(path);
    },
    isRegularFile: async () => true,
    assertExecutable: async () => {},
    readPlistValue: async (infoPath) => {
      const bundle = bundles.find((candidate) => infoPath === resolve(candidate.canonical, "Contents", "Info.plist"));
      if (!bundle) throw missing(infoPath);
      return bundle.executable.endsWith("Codex") ? "Codex" : "ChatGPT";
    },
    listProcesses: async () => processList,
    spawn: (executable, args, environment) => {
      launches.push({ executable, args: [...args], environment });
      return fakeChild();
    },
  };
}

test("prefers an explicit bundle and deduplicates canonical ChatGPT/Codex candidates", async () => {
  const canonical = resolve("fixtures", "ChatGPT.app");
  const executable = resolve(canonical, "Contents", "MacOS", "ChatGPT");
  const dependencies = fakeDependencies([
    { candidate: "/custom/ChatGPT.app", canonical, executable },
    { candidate: "/Applications/ChatGPT.app", canonical, executable },
  ], `42 ${executable} --remote-debugging-port=46172`);
  const adapter = new NativeMacProcessAdapter(dependencies, "/custom/ChatGPT.app");
  assert.equal(await adapter.resolveCodexExecutable(), executable);
  assert.deepEqual(await adapter.listCodexDesktopProcesses(), [{ pid: 42, executablePath: executable }]);
});

test("falls back from ChatGPT.app to legacy Codex.app and reports a missing official app", async () => {
  const canonical = resolve("fixtures", "Codex.app");
  const executable = resolve(canonical, "Contents", "MacOS", "Codex");
  const dependencies = fakeDependencies([
    { candidate: "/Applications/Codex.app", canonical, executable },
  ]);
  assert.equal(await new NativeMacProcessAdapter(dependencies).resolveCodexExecutable(), executable);
  await assert.rejects(
    new NativeMacProcessAdapter(fakeDependencies([])).resolveCodexExecutable(),
    /official ChatGPT or Codex app was not found/,
  );
});

test("bundle resolution rejects plist traversal, escaped canonical paths, and non-executable files", async () => {
  const bundle = resolve("fixtures", "ChatGPT.app");
  const executable = resolve(bundle, "Contents", "MacOS", "ChatGPT");
  const base = fakeDependencies([{ candidate: bundle, canonical: bundle, executable }]);
  await assert.rejects(resolveMacBundleExecutable(bundle, {
    ...base,
    readPlistValue: async () => "../outside",
  }), /Invalid CFBundleExecutable/);
  await assert.rejects(resolveMacBundleExecutable(bundle, {
    ...base,
    canonicalPath: async (path) => path === bundle ? bundle : resolve("fixtures", "outside", "ChatGPT"),
  }), /escapes Contents\/MacOS/);
  await assert.rejects(resolveMacBundleExecutable(bundle, {
    ...base,
    isRegularFile: async () => false,
  }), /not a regular file/);
  await assert.rejects(resolveMacBundleExecutable(bundle, {
    ...base,
    assertExecutable: async () => { throw Object.assign(new Error("not executable"), { code: "EACCES" }); },
  }), /not executable/);
});

test("process parsing matches only an exact canonical executable prefix, including spaces", () => {
  const executable = "/Applications/ChatGPT Special.app/Contents/MacOS/ChatGPT";
  assert.deepEqual(parseMacProcessList([
    `101 ${executable} --flag`,
    `102 ${executable}-helper --flag`,
    `103 /bin/sh ${executable}`,
    `101 ${executable}`,
    "malformed",
  ].join("\n"), [executable]), [{ pid: 101, executablePath: executable }]);
});

test("launch forwards structured arguments and environment without a shell", () => {
  const dependencies = fakeDependencies([]);
  const adapter = new NativeMacProcessAdapter(dependencies);
  const environment = { FEATURE_VALUE: "text; $(touch never)" };
  const child = adapter.launch("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT", ["--flag", "value with spaces"], environment);
  assert.equal(child.pid, 321);
  assert.deepEqual(dependencies.launches, [{
    executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    args: ["--flag", "value with spaces"],
    environment,
  }]);
  child.terminate();
  assert.equal((dependencies.launches.length), 1);
});

test("managed children expose one stable exit promise even after a fast exit", async () => {
  const child = fakeChild();
  const managed = wrapManagedChild(child);
  child.emit("exit", 7, null);
  assert.deepEqual(await Promise.all([managed.waitForExit(), managed.waitForExit()]), [7, 7]);
});

test("macOS alerts keep hostile message text out of AppleScript source", () => {
  const message = `bad \"text\" & do shell script \"touch /tmp/never\"`;
  const title = "Title ' with symbols";
  const args = macOSAlertArguments(message, title, "critical");
  assert.deepEqual(args.slice(-3), ["--", message, title]);
  assert.doesNotMatch(args.slice(0, -3).join("\n"), /touch \/tmp\/never|Title '/);
  assert.match(args.join("\n"), /on run argv/);
});
