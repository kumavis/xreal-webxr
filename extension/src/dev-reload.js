// Only checks our loopback build marker. No page URL or contents leave the browser.
export function createDevReloader(
  buildId,
  {
    fetchBuild = () =>
      fetch(`http://127.0.0.1:4242/dev/build?loaded=${buildId}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      }),
    reload = () => chrome.runtime.reload(),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const ports = new Set();
  let checking = null,
    requested = false;
  return {
    add(port) {
      ports.add(port);
    },
    remove(port) {
      ports.delete(port);
    },
    check() {
      if (requested) return Promise.resolve();
      if (checking) return checking;
      checking = (async () => {
        try {
          const response = await fetchBuild();
          if (!response.ok) return;
          const next = await response.json();
          if (!/^[a-f0-9]{64}$/.test(next.id) || next.id === buildId) return;
          requested = true;
          for (const port of ports) {
            try {
              port.postMessage({ type: "dev_reload", build: next.id });
            } catch {
              ports.delete(port);
            }
          }
          // MAIN-world timers survive extension invalidation; they refresh pages
          // after Chrome has loaded the new content scripts.
          await wait(300);
          reload();
        } catch {
          // Helper offline or build marker unavailable: keep the current runtime.
        }
      })().finally(() => {
        checking = null;
      });
      return checking;
    },
  };
}
