import { XRDevice } from "iwer";
import { validPose, verticalFov } from "./validation.js";

// A fixed seated position, rotational tracking only. No pretend hands, cameras, or room mesh.
const device = new XRDevice(
  {
    name: "XREAL Air 2 Ultra (3DoF bridge)",
    controllerConfig: undefined,
    supportedSessionModes: ["inline", "immersive-vr"],
    supportedFeatures: ["viewer", "local", "local-floor"],
    supportedFrameRates: [60],
    internalNominalFrameRate: 60,
    isSystemKeyboardSupported: false,
    environmentBlendModes: { "immersive-vr": "opaque" },
    interactionMode: "screen-space",
    userAgent: navigator.userAgent,
  },
  { stereoEnabled: true, ipd: 0.063, fovy: verticalFov(52) },
);
device.position.set(0, 1.2, 0);
device.installRuntime({
  globalObject: window,
  polyfillLayers: false,
  forceInstall: true,
});
let pose = null,
  lastUpdate = 0,
  session = null,
  statusText = "Start the Rust helper, then Connect";
let status, feedback, connectButton;
let reloadScheduled = false;
let pendingAction = null,
  actionTimer;
const messages = {
  connect: ["Connecting…", "Connected — head tracking is live"],
  recenter: ["Recentering…", "Recentered ✓"],
  calibrate: [
    "Starting calibration…",
    "Calibration started — hold still for two seconds",
  ],
  stereo: ["Switching to stereo…", "Stereo mode enabled ✓"],
  mono: ["Switching to mirror…", "Mirror mode enabled ✓"],
};
function completeAction(ok, message) {
  clearTimeout(actionTimer);
  feedback.textContent = message;
  feedback.dataset.state = ok ? "success" : "error";
  pendingAction = null;
}
function beginAction(name) {
  if (pendingAction) return;
  pendingAction = name;
  feedback.textContent = messages[name][0];
  feedback.dataset.state = "pending";
  actionTimer = setTimeout(
    () =>
      completeAction(
        false,
        pose && performance.now() - lastUpdate < 500
          ? pose.connected
            ? "Helper did not confirm the command. Check the USB connection and try again."
            : pose.status
          : "No response from the helper. Check that it is running, then click Connect.",
      ),
    4500,
  );
  command(name);
}
const trackingReady = () =>
  pose?.connected &&
  pose.calibrated &&
  pose.age_ms < 200 &&
  performance.now() - lastUpdate < 500;
const command = (command) =>
  window.postMessage({ source: "xreal-page", command }, location.origin);
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "xreal-extension")
    return;
  if (event.data.type === "dev_reload") {
    if (reloadScheduled) return;
    reloadScheduled = true;
    if (feedback) {
      feedback.textContent = "Extension rebuilt — refreshing this page…";
      feedback.dataset.state = "pending";
    }
    session?.end().catch(() => {});
    // This timer lives in the page, so it survives chrome.runtime.reload().
    setTimeout(() => location.reload(), 1500);
    return;
  }
  if (event.data.type === "pose" && validPose(event.data.pose)) {
    const reconnected = pose?.connected === false && event.data.pose.connected;
    pose = event.data.pose;
    lastUpdate = performance.now();
    if (pose.connected && pose.calibrated && pose.age_ms < 200)
      device.quaternion.set(...pose.quaternion);
    statusText = pose.status;
    if (pendingAction === "connect") {
      completeAction(
        pose.connected,
        pose.connected
          ? pose.calibrated
            ? messages.connect[1]
            : "Connected — hold the glasses still for calibration"
          : pose.status,
      );
    }
    if (reconnected && !pendingAction && feedback?.dataset.state === "error")
      completeAction(
        true,
        pose.calibrated
          ? "Glasses reconnected — tracking is live"
          : "Glasses reconnected — hold still for calibration",
      );
  } else if (
    event.data.type === "command_result" &&
    event.data.command === pendingAction
  ) {
    completeAction(
      event.data.ok === true,
      event.data.ok === true
        ? messages[pendingAction][1]
        : String(event.data.message || "Command failed"),
    );
  } else if (event.data.type === "status") {
    statusText = String(event.data.status);
    pose = null;
    if (pendingAction) completeAction(false, statusText);
  }
});
const nativeRequest = navigator.xr.requestSession.bind(navigator.xr);
navigator.xr.requestSession = async (mode, options) => {
  if (mode !== "inline" && !trackingReady())
    throw new DOMException(
      "Connect glasses and finish calibration first.",
      "InvalidStateError",
    );
  const result = await nativeRequest(mode, options);
  if (mode !== "inline") {
    session = result;
    result.addEventListener("end", () => {
      session = null;
    });
  }
  return result;
};
function ui() {
  const host = document.createElement("div");
  host.id = "xreal-webxr-toolbar";
  host.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>:host{font:12px system-ui;color:#eee}section{background:#15191fee;border:1px solid #5d6977;border-radius:8px;padding:9px;max-width:650px}button,input{font:inherit;margin:3px;padding:5px;border:1px solid #667;border-radius:4px;background:#28303b;color:white}input{width:45px}small{display:block;color:#bac4d0}summary{cursor:pointer}#status{margin:4px 0}button{cursor:pointer;box-shadow:0 2px 0 #080b10;transition:background .1s,transform .1s}button:hover{background:#3c4d62}button:active{transform:translateY(2px);box-shadow:inset 0 2px 3px #0008;background:#526c88}button:focus-visible{outline:2px solid #80c5ff;outline-offset:2px}#feedback{min-height:1.5em;margin:6px 3px;font-weight:600;color:#b8d8ff}#feedback[data-state=success]{color:#8ce6a5}#feedback[data-state=error]{color:#ffb6a9}</style>
    <section><details open><summary>XREAL WebXR · 3DoF + stereo <span title="Auto-reload development build">· dev ${__XREAL_BUILD_ID__.slice(0, 8)}</span></summary><div id="status"></div><div id="feedback" role="status" aria-live="polite">Click Connect to start head tracking.</div>
    <button id="connect">Connect</button><button id="calibrate">Calibrate</button><button id="recenter">Recenter</button><button id="stereo">Stereo mode</button><button id="mono">Mirror mode</button><button id="fullscreen">Fullscreen</button><button id="exit">Exit XR</button>
    <label>IPD <input id="ipd" type="number" min="50" max="75" value="63">mm</label>
    <label>Diagonal FOV <input id="fov" type="number" min="35" max="65" value="52">°</label>
    <small>Move this browser window to the glasses, then Fullscreen and the site's Enter VR. Alt+R recenters. Escape exits fullscreen.</small></details></section>`;
  status = shadow.querySelector("#status");
  feedback = shadow.querySelector("#feedback");
  connectButton = shadow.querySelector("#connect");
  for (const name of ["connect", "calibrate", "recenter", "stereo", "mono"])
    shadow.querySelector("#" + name).onclick = () => beginAction(name);
  shadow.querySelector("#fullscreen").onclick = () =>
    document.documentElement
      .requestFullscreen()
      .catch((e) => (statusText = e.message));
  shadow.querySelector("#exit").onclick = () => session?.end();
  shadow.querySelector("#ipd").oninput = (e) => {
    const n = Number(e.target.value);
    if (n >= 50 && n <= 75) device.ipd = n / 1000;
  };
  shadow.querySelector("#fov").oninput = (e) => {
    const n = Number(e.target.value);
    if (n >= 35 && n <= 65) device.fovy = verticalFov(n);
  };
  document.body.append(host);
  setInterval(() => {
    const stale = performance.now() - lastUpdate > 500;
    status.textContent =
      stale && pose ? "Tracking stale — check USB connection" : statusText;
    connectButton.textContent =
      pose?.connected && !stale ? "Connected ✓" : "Connect";
    host.dataset.connected = String(!!pose?.connected && !stale);
    host.dataset.calibrated = String(!!pose?.calibrated && !stale);
    host.dataset.session = String(!!session);
    if (session && !trackingReady()) {
      session.end();
      statusText = "XR stopped: tracking disconnected";
    }
  }, 200);
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", ui, { once: true });
else ui();
window.addEventListener("keydown", (event) => {
  if (event.altKey && event.code === "KeyR") {
    event.preventDefault();
    beginAction("recenter");
  }
});
