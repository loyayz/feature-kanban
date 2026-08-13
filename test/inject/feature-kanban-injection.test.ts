import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
// @ts-expect-error jsdom does not ship declarations; the test uses only its stable constructor API.
import { JSDOM } from "jsdom";

const BOARD_ORIGIN = "http://127.0.0.1:46171";
const script = readFileSync(resolve(process.cwd(), "inject/feature-kanban.user.js"), "utf8");

function harness() {
  const dom = new JSDOM(
    "<!doctype html><html><head><style>.bg-token-list-hover-background { background-color: rgb(255, 0, 0); }</style></head><body><aside><nav><div><button class='sidebar-item'>插件</button></div><div id='native-current' role='button' aria-current='page' data-app-action-sidebar-thread-selected='true' class='bg-token-list-hover-background'>current</div></nav></aside><main id='app-shell'><main data-app-shell-main-surface='default'></main></main><button data-app-action-sidebar-thread-id='thread-visible'>thread</button></body></html>",
    { runScripts: "outside-only", url: "https://codex.local/" },
  );
  const { window } = dom;
  const outerMain = window.document.querySelector<HTMLElement>("#app-shell")!;
  outerMain.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 1200, height: 700, right: 1200, bottom: 700,
    x: 0, y: 0, toJSON: () => ({}),
  });
  const main = window.document.querySelector<HTMLElement>("[data-app-shell-main-surface]")!;
  main.getBoundingClientRect = () => ({
    left: 200, top: 36, width: 1000, height: 664, right: 1200, bottom: 700,
    x: 200, y: 36, toJSON: () => ({}),
  });
  window.eval(script);
  return { dom, window };
}

function send(window: Window, frameWindow: Window, origin: string, data: unknown): void {
  const RealmMessageEvent = (window as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent;
  window.dispatchEvent(new RealmMessageEvent("message", { source: frameWindow, origin, data }));
}

test("mounts once and rejects the wrong origin/challenge", async () => {
  const { dom, window } = harness();
  window.eval(script);
  assert.equal(window.document.querySelectorAll("#feature-kanban-entry").length, 1);
  assert.equal(window.document.querySelectorAll("#feature-kanban-panel").length, 1);
  const frame = window.document.querySelector("iframe")!;
  const responses: unknown[] = [];
  frame.contentWindow!.postMessage = (message: unknown) => { responses.push(message); };
  send(window, frame.contentWindow!, "https://attacker.invalid", {
    type: "feature-kanban:hello", challenge: "challenge-one",
  });
  send(window, frame.contentWindow!, BOARD_ORIGIN, {
    type: "feature-kanban:hello", challenge: "short",
  });
  assert.equal(responses.length, 0);
  send(window, frame.contentWindow!, BOARD_ORIGIN, {
    type: "feature-kanban:hello", challenge: "challenge-one",
  });
  assert.equal((responses[0] as { type: string }).type, "feature-kanban:ready");
  (window as unknown as { __featureKanban: { dispose(): void } }).__featureKanban.dispose();
  dom.window.close();
});

test("syncs the Codex Electron theme and stops observing after disposal", async () => {
  const { dom, window } = harness();
  const root = window.document.documentElement;
  const frame = window.document.querySelector("iframe")!;
  const responses: Array<{ type: string; theme?: string }> = [];
  frame.contentWindow!.postMessage = (message: unknown) => {
    responses.push(message as { type: string; theme?: string });
  };

  root.className = "electron-dark";
  send(window, frame.contentWindow!, BOARD_ORIGIN, {
    type: "feature-kanban:hello", challenge: "theme-challenge",
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.deepEqual(responses.map(({ type, theme }) => ({ type, theme })), [
    { type: "feature-kanban:ready", theme: "dark" },
  ]);

  root.className = "electron-light";
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.deepEqual(responses.map(({ type, theme }) => ({ type, theme })), [
    { type: "feature-kanban:ready", theme: "dark" },
    { type: "feature-kanban:ready", theme: "light" },
  ]);

  root.dataset.theme = "light";
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(responses.length, 2);

  window.document.querySelector("#feature-kanban-panel")!.remove();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  const remountedFrame = window.document.querySelector("iframe")!;
  const remountedResponses: Array<{ type: string; theme?: string }> = [];
  remountedFrame.contentWindow!.postMessage = (message: unknown) => {
    remountedResponses.push(message as { type: string; theme?: string });
  };
  root.className = "electron-dark";
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(remountedResponses.length, 0);

  send(window, remountedFrame.contentWindow!, BOARD_ORIGIN, {
    type: "feature-kanban:hello", challenge: "remount-challenge",
  });
  assert.deepEqual(remountedResponses.map(({ type, theme }) => ({ type, theme })), [
    { type: "feature-kanban:ready", theme: "dark" },
  ]);

  (window as unknown as { __featureKanban: { dispose(): void } }).__featureKanban.dispose();
  root.className = "electron-light";
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(responses.length, 2);
  assert.equal(remountedResponses.length, 1);
  dom.window.close();
});

test("covers only the Codex main content surface", () => {
  const { dom, window } = harness();
  window.document.querySelector<HTMLButtonElement>("#feature-kanban-entry")!.click();
  const panel = window.document.querySelector<HTMLElement>("#feature-kanban-panel")!;
  const content = window.document.querySelector<HTMLElement>("[data-app-shell-main-surface]")!;

  assert.equal(panel.parentElement, content);
  assert.equal(panel.style.position, "absolute");
  assert.equal(panel.style.inset, "0");
  assert.equal(panel.style.left, "");
  assert.equal(panel.style.top, "");
  assert.equal(panel.style.width, "");
  assert.equal(panel.style.height, "");
  assert.equal((panel.style as CSSStyleDeclaration & { webkitAppRegion: string }).webkitAppRegion, "no-drag");
  const frameStyle = panel.querySelector<HTMLIFrameElement>("iframe")!.style as CSSStyleDeclaration & { webkitAppRegion: string };
  assert.equal(frameStyle.webkitAppRegion, "no-drag");
  (window as unknown as { __featureKanban: { dispose(): void } }).__featureKanban.dispose();
  dom.window.close();
});

test("mounts below Plugins and observes native sidebar clicks without changing Codex events", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><head><style>.bg-token-list-hover-background { background-color: rgb(255, 0, 0); }</style></head><body><main></main></body></html>",
    { runScripts: "outside-only", url: "https://codex.local/" },
  );
  const { window } = dom;
  window.eval(script);
  assert.equal(window.document.querySelector("#feature-kanban-entry"), null);

  const aside = window.document.createElement("aside");
  const nav = window.document.createElement("nav");
  const group = window.document.createElement("div");
  const plugins = window.document.createElement("button");
  plugins.className = "sidebar-item";
  plugins.textContent = "插件";
  const nativeCurrent = window.document.createElement("div");
  nativeCurrent.id = "native-current";
  nativeCurrent.className = "bg-token-list-hover-background";
  nativeCurrent.setAttribute("role", "button");
  nativeCurrent.setAttribute("aria-current", "page");
  nativeCurrent.dataset.appActionSidebarThreadSelected = "true";
  group.append(plugins);
  nav.append(group, nativeCurrent);
  aside.append(nav);
  window.document.body.prepend(aside);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

  const entry = window.document.querySelector<HTMLButtonElement>("#feature-kanban-entry")!;
  assert.equal(entry.parentElement, group);
  assert.equal(plugins.nextElementSibling, entry);
  assert.equal(entry.className, plugins.className);
  assert.equal(entry.textContent?.trim(), "▥任务看板");
  entry.focus();
  entry.click();
  const panel = window.document.querySelector<HTMLElement>("#feature-kanban-panel")!;
  const frame = panel.querySelector<HTMLIFrameElement>("iframe")!;
  assert.equal(panel.style.display, "block");
  assert.equal(entry.getAttribute("aria-pressed"), "true");
  assert.equal(entry.classList.contains("bg-token-list-hover-background"), true);
  assert.equal(window.getComputedStyle(nativeCurrent).backgroundColor, "rgba(0, 0, 0, 0)");
  assert.equal(nativeCurrent.getAttribute("aria-current"), "page");
  assert.equal(nativeCurrent.getAttribute("data-app-action-sidebar-thread-selected"), "true");
  assert.equal(nativeCurrent.classList.contains("bg-token-list-hover-background"), true);

  frame.focus();
  frame.blur();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(panel.style.display, "block");

  let nativeClicks = 0;
  let nativeDefaultPrevented = false;
  nativeCurrent.addEventListener("click", (event: Event) => {
    nativeClicks += 1;
    nativeDefaultPrevented = event.defaultPrevented;
  });
  nativeCurrent.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(panel.style.display, "none");
  assert.equal(nativeClicks, 1);
  assert.equal(nativeDefaultPrevented, false);
  assert.equal(entry.getAttribute("aria-pressed"), "false");
  assert.equal(entry.classList.contains("bg-token-list-hover-background"), false);
  assert.equal(window.getComputedStyle(nativeCurrent).backgroundColor, "rgb(255, 0, 0)");

  entry.click();
  assert.equal(panel.style.display, "block");
  (window as unknown as { __featureKanban: { dispose(): void } }).__featureKanban.dispose();
  nativeCurrent.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(window.document.querySelector("#feature-kanban-panel"), null);
  assert.equal(window.document.querySelector("#feature-kanban-style"), null);
  dom.window.close();
});

test("clicks a mounted thread, falls back to the route bridge, and reports failure", async () => {
  const { dom, window } = harness();
  const frame = window.document.querySelector("iframe")!;
  const responses: Array<{ type: string; ok?: boolean }> = [];
  frame.contentWindow!.postMessage = (message: unknown) => { responses.push(message as { type: string; ok?: boolean }); };
  send(window, frame.contentWindow!, BOARD_ORIGIN, {
    type: "feature-kanban:hello", challenge: "challenge-two",
  });
  let clicked = false;
  const row = window.document.querySelector<HTMLElement>("[data-app-action-sidebar-thread-id]")!;
  row.addEventListener("click", () => { clicked = true; });
  send(window, frame.contentWindow!, BOARD_ORIGIN, {
    type: "feature-kanban:open-session",
    challenge: "challenge-two",
    externalSessionId: "thread-visible",
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(clicked, true);
  assert.equal(responses.at(-1)?.ok, true);

  row.remove();
  const routes: unknown[] = [];
  Object.defineProperty(window, "electronBridge", {
    configurable: true,
    value: { sendMessageFromView: (message: unknown) => { routes.push(message); } },
  });
  send(window, frame.contentWindow!, BOARD_ORIGIN, {
    type: "feature-kanban:open-session",
    challenge: "challenge-two",
    externalSessionId: "thread-route",
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(routes.length, 1);
  assert.equal((routes[0] as { type: string }).type, "navigate-to-route");
  assert.equal((routes[0] as { path: string }).path, "/local/thread-route");

  Object.defineProperty(window, "electronBridge", { configurable: true, value: undefined });
  send(window, frame.contentWindow!, BOARD_ORIGIN, {
    type: "feature-kanban:open-session",
    challenge: "challenge-two",
    externalSessionId: "thread-failure",
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(responses.at(-1)?.ok, false);
  (window as unknown as { __featureKanban: { dispose(): void } }).__featureKanban.dispose();
  dom.window.close();
});
