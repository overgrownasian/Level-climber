(() => {
  const key = "level-climber.web-recovery.v1";
  const maxLength = 2 * 1024 * 1024;
  let suspendCallback;

  function validSave(text) {
    return typeof text === "string" && text.length > 0 && text.length <= maxLength;
  }

  function read() {
    try {
      const text = window.localStorage.getItem(key);
      return validSave(text) ? text : "";
    } catch {
      return "";
    }
  }

  function write(text) {
    if (!validSave(text)) return false;
    try {
      window.localStorage.setItem(key, text);
      return true;
    } catch {
      return false;
    }
  }

  function onSuspend(callback) {
    if (typeof callback === "function") suspendCallback = callback;
  }

  function suspend() {
    try {
      suspendCallback?.();
    } catch {
      // The browser may be suspending an engine that has already shut down.
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") suspend();
  });
  window.addEventListener("pagehide", suspend);

  window.levelClimberRecovery = { read, write, onSuspend };
})();
