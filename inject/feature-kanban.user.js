(() => {
  "use strict";

  const BOARD_ORIGIN = "http://127.0.0.1:46171";
  const ENTRY_ID = "feature-kanban-entry";
  const PANEL_ID = "feature-kanban-panel";
  const STYLE_ID = "feature-kanban-style";
  const API_KEY = "__featureKanban";
  const ACTIVE_ENTRY_CLASS = "bg-token-list-hover-background";
  const INACTIVE_NATIVE_SELECTION_CSS = `
    aside nav [aria-current="page"]:not(#${ENTRY_ID}),
    aside nav [data-app-action-sidebar-thread-selected="true"]:not(#${ENTRY_ID}),
    [data-sidebar] nav [aria-current="page"]:not(#${ENTRY_ID}),
    [data-sidebar] nav [data-app-action-sidebar-thread-selected="true"]:not(#${ENTRY_ID}) {
      background-color: transparent !important;
    }
  `;

  if (window[API_KEY]?.version === 1) {
    window[API_KEY].remount();
    return;
  }

  let challenge = "";
  let active = false;
  let panel;
  let frame;
  let entry;
  let selectionStyle;
  let lastTheme;

  function rendererMain() {
    return (
      document.querySelector("[data-app-shell-main-surface]")
      || document.querySelector("[data-app-main]")
      || document.querySelector("[role='main']")
      || document.querySelector("main")
      || document.body
    );
  }

  function sidebarNavigation() {
    return document.querySelector("aside nav") || document.querySelector("[data-sidebar] nav");
  }

  function sidebarEntryAnchor() {
    const sidebar = sidebarNavigation();
    if (!sidebar) return null;
    return [...sidebar.querySelectorAll("button")].find((button) => {
      const label = (button.innerText || button.textContent || "").trim();
      return label === "插件" || label === "Plugins";
    }) || null;
  }

  function ensurePanel() {
    const host = rendererMain();
    const previousFrame = frame;
    panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("section");
      panel.id = PANEL_ID;
      panel.dataset.featureKanbanOwned = "true";
      panel.setAttribute("aria-label", "Feature Kanban");
      Object.assign(panel.style, {
        position: "absolute",
        inset: "0",
        zIndex: "2147483000",
        display: "none",
        overflow: "hidden",
        background: "Canvas",
      });
      panel.style.webkitAppRegion = "no-drag";
      frame = document.createElement("iframe");
      frame.src = `${BOARD_ORIGIN}/`;
      frame.title = "Feature Kanban";
      frame.setAttribute("allow", "clipboard-write");
      Object.assign(frame.style, { width: "100%", height: "100%", border: "0", display: "block" });
      frame.style.webkitAppRegion = "no-drag";
      panel.append(frame);
    } else {
      frame = panel.querySelector("iframe");
    }
    if (frame !== previousFrame) {
      challenge = "";
      lastTheme = undefined;
    }
    if (panel.parentElement !== host) host.append(panel);
  }

  function ensureSelectionStyle() {
    selectionStyle = document.getElementById(STYLE_ID);
    if (!selectionStyle) {
      selectionStyle = document.createElement("style");
      selectionStyle.id = STYLE_ID;
      selectionStyle.dataset.featureKanbanOwned = "true";
      (document.head || document.documentElement).append(selectionStyle);
    }
    selectionStyle.textContent = active ? INACTIVE_NATIVE_SELECTION_CSS : "";
  }

  function setActive(next) {
    active = next;
    ensurePanel();
    ensureSelectionStyle();
    panel.style.display = active ? "block" : "none";
    if (entry) {
      entry.setAttribute("aria-pressed", String(active));
      entry.dataset.active = String(active);
      entry.classList.toggle(ACTIVE_ENTRY_CLASS, active);
      if (active) {
        entry.setAttribute("aria-current", "page");
        entry.dataset.appActionSidebarThreadSelected = "true";
      } else {
        entry.removeAttribute("aria-current");
        delete entry.dataset.appActionSidebarThreadSelected;
      }
    }
  }

  function ensureEntry() {
    const anchor = sidebarEntryAnchor();
    entry = document.getElementById(ENTRY_ID);
    if (!anchor || !anchor.parentElement) {
      entry?.remove();
      entry = undefined;
      return;
    }
    if (entry) {
      if (entry.previousElementSibling !== anchor) anchor.after(entry);
      return;
    }
    entry = document.createElement("button");
    entry.id = ENTRY_ID;
    entry.type = "button";
    entry.dataset.featureKanbanOwned = "true";
    entry.className = anchor.className;
    entry.innerHTML = '<span aria-hidden="true">▥</span><span>任务看板</span>';
    entry.addEventListener("click", () => setActive(!active));
    anchor.after(entry);
    entry.setAttribute("aria-pressed", String(active));
    entry.dataset.active = String(active);
    entry.classList.toggle(ACTIVE_ENTRY_CLASS, active);
    if (active) {
      entry.setAttribute("aria-current", "page");
      entry.dataset.appActionSidebarThreadSelected = "true";
    }
  }

  function onSidebarClick(event) {
    if (!active || !(event.target instanceof Element)) return;
    const sidebar = sidebarNavigation();
    if (!sidebar?.contains(event.target) || event.target.closest(`#${ENTRY_ID}`)) return;
    setActive(false);
  }

  function remount() {
    ensurePanel();
    ensureSelectionStyle();
    ensureEntry();
  }

  function validChallenge(value) {
    return typeof value === "string" && value.length >= 8 && value.length <= 128;
  }

  function hostTheme() {
    const root = document.documentElement;
    if (
      root.classList.contains("electron-dark")
      || root.classList.contains("dark")
      || root.dataset.theme === "dark"
    ) return "dark";
    if (
      root.classList.contains("electron-light")
      || root.classList.contains("light")
      || root.dataset.theme === "light"
    ) return "light";
    const colorScheme = getComputedStyle(root).colorScheme.trim().toLowerCase();
    if (colorScheme === "dark" || colorScheme === "light") return colorScheme;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function publishTheme(force = false) {
    if (!frame?.contentWindow || !challenge) return;
    const theme = hostTheme();
    if (!force && theme === lastTheme) return;
    lastTheme = theme;
    frame.contentWindow.postMessage({ type: "feature-kanban:ready", challenge, theme }, BOARD_ORIGIN);
  }

  function findThreadRow(threadId) {
    return [...document.querySelectorAll("[data-app-action-sidebar-thread-id]")].find(
      (row) => {
        const rowId = row.getAttribute("data-app-action-sidebar-thread-id");
        return rowId === threadId || rowId === `local:${threadId}`;
      },
    );
  }

  function waitForThreadState(threadId, predicate, timeoutMs, timeoutMessage) {
    const current = findThreadRow(threadId);
    if (current && predicate(current)) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, row) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        if (error) reject(error);
        else resolve(row);
      };
      const inspect = () => {
        const row = findThreadRow(threadId);
        if (row && predicate(row)) finish(undefined, row);
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-current", "data-app-action-sidebar-thread-selected"],
      });
      const timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
      inspect();
    });
  }

  function waitForThreadRow(threadId, timeoutMs = 5000) {
    return waitForThreadState(
      threadId,
      () => true,
      timeoutMs,
      "该对话尚未出现在 Codex 侧边栏，请刷新或重新打开 Codex 后重试。",
    );
  }

  function waitForThreadSelection(threadId) {
    return waitForThreadState(
      threadId,
      (row) => row.getAttribute("data-app-action-sidebar-thread-selected") === "true"
        || row.getAttribute("aria-current") === "page",
      2000,
      "Codex 未能选中目标对话，请刷新或重新打开 Codex 后重试。",
    );
  }

  function validThreadId(threadId) {
    return typeof threadId === "string"
      && threadId.length >= 8
      && threadId.length <= 160
      && /^[a-zA-Z0-9-]+$/.test(threadId);
  }

  function navigateToThread(threadId) {
    window.postMessage(
      { type: "navigate-to-route", path: `/local/${threadId}` },
      window.location.origin,
    );
  }

  async function openSession(threadId) {
    if (
      !validThreadId(threadId)
    ) {
      throw new Error("无效的 Codex 会话 ID");
    }
    let row = findThreadRow(threadId);
    if (!row) {
      navigateToThread(threadId);
      row = await waitForThreadRow(threadId, 10_000);
    }
    const selected = row.getAttribute("data-app-action-sidebar-thread-selected") === "true"
      || row.getAttribute("aria-current") === "page";
    if (!selected) row.click();
    await waitForThreadSelection(threadId);
    setActive(false);
    return true;
  }

  async function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== BOARD_ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    if (data.type === "feature-kanban:hello") {
      if (!validChallenge(data.challenge)) return;
      challenge = data.challenge;
      publishTheme(true);
      return;
    }
    if (data.type !== "feature-kanban:open-session" || data.challenge !== challenge || !challenge) return;
    try {
      await openSession(data.externalSessionId);
      frame.contentWindow.postMessage(
        { type: "feature-kanban:navigation-result", challenge, ok: true },
        BOARD_ORIGIN,
      );
    } catch (error) {
      frame.contentWindow.postMessage(
        {
          type: "feature-kanban:navigation-result",
          challenge,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 180) : "无法打开会话",
        },
        BOARD_ORIGIN,
      );
    }
  }

  const observer = new MutationObserver(() => {
    const mountedEntry = document.getElementById(ENTRY_ID);
    const mountedPanel = document.getElementById(PANEL_ID);
    const mountedStyle = document.getElementById(STYLE_ID);
    const anchor = sidebarEntryAnchor();
    if (!mountedStyle || mountedPanel?.parentElement !== rendererMain() || (anchor && mountedEntry?.previousElementSibling !== anchor) || (!anchor && mountedEntry)) remount();
  });
  const themeObserver = new MutationObserver(() => publishTheme());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "style"],
  });
  document.addEventListener("click", onSidebarClick, true);
  window.addEventListener("message", onMessage);
  window[API_KEY] = {
    version: 1,
    activate: () => setActive(true),
    remount,
    dispose: () => {
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("click", onSidebarClick, true);
      window.removeEventListener("message", onMessage);
      document.getElementById(ENTRY_ID)?.remove();
      document.getElementById(PANEL_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
      delete window[API_KEY];
    },
  };
  remount();
})();
