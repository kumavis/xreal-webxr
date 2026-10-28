let port;
const connectionKey = "xreal-webxr:connected";
function getPort() {
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
          status: "Extension disconnected; waiting for page refresh",
        },
        location.origin,
      );
    });
  }
  return port;
}
function send(command) {
  try {
    getPort().postMessage({ command });
  } catch {
    port = null;
  }
}
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
  try {
    if (command === "connect") sessionStorage.setItem(connectionKey, "yes");
    if (command === "disconnect") sessionStorage.removeItem(connectionKey);
  } catch {}
  send(command);
});
// Content-script activity wakes a suspended MV3 worker without alarms, broad tab
// permissions, or keeping a worker permanently alive. Background tabs may throttle.
send("dev_check");
setInterval(() => send("dev_check"), 2000);
try {
  if (sessionStorage.getItem(connectionKey) === "yes") send("connect");
} catch {}
