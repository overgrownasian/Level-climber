(() => {
  if (window.levelClimberDiagnostics) return;

  const storageKey = "level-climber.web-diagnostics.v1";
  const logLimit = 64;
  const heartbeatMs = 4800;
  const modes = ["title", "run", "paused", "recovery", "dead", "settings", "shop", "classes", "scores", "checkpoints", "loadout"];
  const causes = ["spikes", "acid", "fire", "dart", "pendulum", "slime", "bat", "mimic", "retired", "wipe"];
  const errorReasons = ["out-of-memory", "network", "wasm-abort", "context-lost", "resource-error", "script-error", "unknown"];
  const navigationTypes = ["navigate", "reload", "back_forward", "prerender", "unknown"];
  const visibilityStates = ["visible", "hidden", "prerender", "unloaded"];
  const token = /^[a-z][a-z0-9_-]{0,39}$/;
  const version = /^[a-z0-9][a-z0-9._+-]{0,47}$/i;
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const canvas = document.getElementById("canvas");
  let storage;
  let events = [];
  let currentState;
  let lastRecordedState;
  let lastStateTime = -Infinity;
  let lastCapturedError;
  let dialog;

  function cleanDetails(details) {
    const clean = {};
    if (!details || typeof details !== "object") return clean;
    for (const [key, values] of [
      ["type", navigationTypes], ["visibility", visibilityStates], ["mode", modes],
      ["cause", causes], ["reason", errorReasons],
    ]) {
      if (values.includes(details[key])) clean[key] = details[key];
    }
    for (const key of ["discarded", "persisted"]) {
      if (typeof details[key] === "boolean") clean[key] = details[key];
    }
    for (const key of ["level", "distance", "code"]) {
      if (Number.isSafeInteger(details[key]) && details[key] >= 0) clean[key] = details[key];
    }
    if (typeof details.stage === "string" && token.test(details.stage)) clean.stage = details.stage;
    if (typeof details.version === "string" && version.test(details.version)) clean.version = details.version;
    return clean;
  }

  try {
    storage = window.localStorage;
    const saved = storage.getItem(storageKey);
    if (saved && saved.length <= 64000) {
      const entries = JSON.parse(saved);
      if (Array.isArray(entries)) {
        events = entries.slice(-logLimit).filter((entry) =>
          typeof entry?.type === "string" && token.test(entry.type) &&
          typeof entry.time === "string" && timestamp.test(entry.time)
        ).map(({ time, type, details }) => ({ time, type, details: cleanDetails(details) }));
      }
    }
  } catch {
    storage = undefined;
  }

  function record(type, details) {
    if (typeof type !== "string" || !token.test(type)) return;
    events.push({ time: new Date().toISOString(), type, details: cleanDetails(details) });
    if (events.length > logLimit) events.shift();
    if (storage) {
      try {
        storage.setItem(storageKey, JSON.stringify(events));
      } catch {
        storage = undefined;
      }
    }
  }

  function publishGameState(now) {
    record("game-state", currentState);
    lastRecordedState = currentState;
    lastStateTime = now;
  }

  function gameState(mode, level, distance, cause = "") {
    if (!modes.includes(mode)) return;
    const now = performance.now();
    currentState = {
      mode,
      level: Number.isFinite(level) ? Math.max(0, Math.trunc(level)) : 0,
      distance: Number.isFinite(distance) ? Math.max(0, Math.trunc(distance)) : 0,
    };
    if (mode === "dead" && causes.includes(cause)) currentState.cause = cause;
    if (mode !== lastRecordedState?.mode || currentState.level !== lastRecordedState?.level ||
      currentState.cause !== lastRecordedState?.cause || (mode === "run" && now - lastStateTime >= heartbeatMs)) {
      publishGameState(now);
    }
  }

  function recordLifecycle(type, details) {
    if (currentState?.mode === "run" && currentState.distance !== lastRecordedState?.distance) {
      publishGameState(performance.now());
    }
    record(type, details);
  }

  function errorReason(reason, fallback, message = "") {
    let name = "";
    if (typeof reason === "string") message = reason;
    else if (reason instanceof Error) {
      name = reason.name;
      message = reason.message;
    }
    if (typeof message !== "string") message = "";
    if (/out of memory|allocation failed/i.test(message)) return "out-of-memory";
    if (/webgl context lost|context is lost/i.test(message)) return "context-lost";
    if (name === "NetworkError" || /failed to fetch|load failed|networkerror|network request failed/i.test(message)) return "network";
    if (name === "RuntimeError" || /aborted\(|webassembly|wasm abort|memory access out of bounds/i.test(message)) return "wasm-abort";
    return fallback;
  }

  function captureError(type, error) {
    const reason = errorReason(error, "unknown");
    const now = performance.now();
    if (lastCapturedError?.type === type && lastCapturedError.reason === reason && now - lastCapturedError.time < 1000) return;
    record(type, { reason });
    lastCapturedError = { type, reason, time: now };
  }

  function reportText() {
    const lines = events.map(({ time, type, details }) => {
      const fields = Object.entries(details).map(([key, value]) => `${key}=${value}`).join("  ");
      return `${time}  ${type}${fields ? `  ${fields}` : ""}`;
    });
    return ["Level Climber browser diagnostics (UTC)",
      storage ? "Recent events stored in this browser." : "Browser storage unavailable. Showing this page's recent events.",
      "", ...lines].join("\n");
  }

  function open() {
    if (dialog) return;
    const previousFocus = document.activeElement;
    const panel = document.createElement("dialog");
    panel.className = "lc-diagnostics";
    panel.setAttribute("aria-labelledby", "lc-diagnostics-title");
    panel.setAttribute("aria-modal", "true");
    dialog = panel;

    const style = document.createElement("style");
    style.textContent = `
      .lc-diagnostics[open] {
        box-sizing: border-box; position: fixed; inset: 0; z-index: 10; margin: auto;
        display: flex; flex-direction: column; gap: .75rem; align-items: stretch;
        width: min(42rem, calc(100vw - 2rem)); height: fit-content;
        max-height: calc(100vh - 2rem); max-height: calc(100dvh - 2rem);
        overflow: auto; padding: 1rem; touch-action: pan-y;
        color: #f2dfb9; background: #29232b; border: 1px solid #bc9157;
        border-radius: .75rem; box-shadow: 0 1rem 3rem #08070b;
        font: 1rem/1.4 system-ui, sans-serif;
      }
      .lc-diagnostics::backdrop { background: #08070bd9; }
      .lc-diagnostics h2, .lc-diagnostics p { margin: 0; }
      .lc-diagnostics h2 { font-size: 1.25rem; }
      .lc-diagnostics textarea {
        box-sizing: border-box; width: 100%; min-height: 6rem;
        height: min(45vh, 24rem); height: min(45dvh, 24rem); resize: none;
        padding: .65rem; color: #f2dfb9; background: #111019;
        border: 1px solid #8f7a66; border-radius: .35rem;
        font: 1rem/1.4 ui-monospace, monospace; touch-action: pan-y;
      }
      .lc-diagnostics-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .6rem; }
      .lc-diagnostics button {
        min-height: 44px; padding: .35rem .9rem; border-radius: .35rem;
        color: #f2dfb9; background: #382e39; border: 1px solid #bc9157; font: inherit;
      }
      .lc-diagnostics :focus-visible { outline: 2px solid #91eacf; outline-offset: 2px; }
    `;

    const heading = document.createElement("h2");
    heading.id = "lc-diagnostics-title";
    heading.textContent = "Browser diagnostics";
    const summary = document.createElement("p");
    summary.textContent = "This report stays in your browser. You can copy it to share.";
    const report = document.createElement("textarea");
    report.readOnly = true;
    report.spellcheck = false;
    report.setAttribute("aria-label", "Diagnostic report");
    report.value = reportText();

    const actions = document.createElement("div");
    actions.className = "lc-diagnostics-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy report";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    const feedback = document.createElement("p");
    feedback.setAttribute("role", "status");
    actions.append(copy, close);
    panel.append(style, heading, summary, report, actions, feedback);

    function dismiss() {
      if (dialog !== panel) return;
      dialog = undefined;
      if (panel.open && typeof panel.close === "function") panel.close();
      panel.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }

    close.addEventListener("click", dismiss);
    panel.addEventListener("close", dismiss);
    panel.addEventListener("cancel", (event) => {
      event.preventDefault();
      dismiss();
    });
    panel.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      } else if (event.key === "Tab") {
        if (event.shiftKey && document.activeElement === report) {
          event.preventDefault();
          close.focus();
        } else if (!event.shiftKey && document.activeElement === close) {
          event.preventDefault();
          report.focus();
        }
      }
    });
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(report.value);
        feedback.textContent = "Report copied.";
      } catch {
        if (dialog !== panel) return;
        report.focus({ preventScroll: true });
        report.select();
        feedback.textContent = "Report selected. Use your device's Copy command.";
      }
    });

    document.body.append(panel);
    try {
      panel.showModal();
    } catch {
      panel.setAttribute("open", "");
    }
    close.focus({ preventScroll: true });
  }

  let previousState;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "navigation") break;
    if (events[index].type === "game-state") {
      previousState = events[index].details;
      break;
    }
  }
  record("navigation", {
    type: performance.getEntriesByType?.("navigation")?.[0]?.type || "unknown",
    discarded: document.wasDiscarded,
    visibility: document.visibilityState,
  });
  if (previousState) record("previous-game-state", previousState);

  document.addEventListener("visibilitychange", () => recordLifecycle("visibilitychange", { visibility: document.visibilityState }));
  document.addEventListener("freeze", () => recordLifecycle("freeze"));
  document.addEventListener("resume", () => recordLifecycle("resume"));
  window.addEventListener("pagehide", (event) => recordLifecycle("pagehide", { persisted: event.persisted }));
  window.addEventListener("pageshow", (event) => recordLifecycle("pageshow", { persisted: event.persisted }));
  canvas?.addEventListener("webglcontextlost", () => record("webglcontextlost"), { capture: true });
  canvas?.addEventListener("webglcontextrestored", () => record("webglcontextrestored"), { capture: true });
  window.addEventListener("error", (event) => {
    const reason = event.target === window
      ? errorReason(event.error, "script-error", event.message)
      : "resource-error";
    record("browser-error", { reason });
  }, { capture: true });
  window.addEventListener("unhandledrejection", (event) => {
    captureError("unhandledrejection", event.reason);
  });

  window.levelClimberDiagnostics = { record, gameState, captureError, open };
})();
