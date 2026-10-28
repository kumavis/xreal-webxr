// No website URL, page contents, credentials, or tokens are sent to the helper.
chrome.runtime.onConnect.addListener((port) => {
  const url = new URL(port.sender?.url || "about:blank");
  if (
    port.name !== "xreal" ||
    !["https://goooooo.ooo", "http://127.0.0.1:4242"].includes(url.origin)
  ) {
    port.disconnect();
    return;
  }
  let socket;
  const send = (data) => {
    try {
      port.postMessage(data);
    } catch {
      socket?.close();
    }
  };
  port.onMessage.addListener((message) => {
    if (message.command === "connect") {
      if (socket && socket.readyState < 2) return;
      socket = new WebSocket("ws://127.0.0.1:4242/ws");
      socket.onmessage = (e) => {
        try {
          send({ type: "pose", pose: JSON.parse(e.data) });
        } catch {}
      };
      socket.onerror = () =>
        send({
          type: "status",
          status: "Cannot reach Rust helper. Run cargo run --release.",
        });
      socket.onclose = () =>
        send({ type: "status", status: "Helper disconnected" });
    } else if (
      ["recenter", "calibrate", "stereo", "mono"].includes(message.command) &&
      socket?.readyState === 1
    ) {
      socket.send(message.command);
    } else if (message.command === "disconnect") {
      socket?.close();
    }
  });
  port.onDisconnect.addListener(() => socket?.close());
});
