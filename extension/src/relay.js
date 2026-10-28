let port;
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "xreal-page") return;
  const command = event.data.command;
  if (
    ![
      "connect",
      "disconnect",
      "recenter",
      "calibrate",
      "stereo",
      "mono",
    ].includes(command)
  )
    return;
  if (!port) {
    port = chrome.runtime.connect({ name: "xreal" });
    port.onMessage.addListener((data) =>
      window.postMessage(
        { source: "xreal-extension", ...data },
        location.origin,
      ),
    );
    port.onDisconnect.addListener(() => {
      port = null;
      window.postMessage(
        {
          source: "xreal-extension",
          type: "status",
          status: "Extension disconnected; reload this page",
        },
        location.origin,
      );
    });
  }
  port.postMessage({ command });
});
