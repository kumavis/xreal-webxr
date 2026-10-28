import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("bundled runtime replaces native XR, uses tracked stereo views, and ends on sensor loss", async () => {
  const dom = new JSDOM("<!doctype html><body><canvas></canvas></body>", {
    url: "http://127.0.0.1:4242/demo",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  try {
    w.DOMPointReadOnly = class {
      constructor(x = 0, y = 0, z = 0, w = 1) {
        Object.assign(this, { x, y, z, w });
      }
    };
    w.WebGL2RenderingContext = class {};
    w.WebGLRenderingContext = class {};
    Object.defineProperty(w, "innerWidth", { value: 3840 });
    Object.defineProperty(w, "innerHeight", { value: 1080 });
    const native = {
      requestSession() {
        throw Error("native runtime should be replaced");
      },
      isSessionSupported: async () => false,
    };
    Object.defineProperty(w.navigator, "xr", {
      value: native,
      configurable: true,
    });
    w.eval(
      await readFile(new URL("../dist/runtime.js", import.meta.url), "utf8"),
    );
    await new Promise((r) => w.setTimeout(r, 20));
    assert.notEqual(w.navigator.xr, native);
    assert.equal(await w.navigator.xr.isSessionSupported("immersive-vr"), true);
    assert.equal(
      await w.navigator.xr.isSessionSupported("immersive-ar"),
      false,
    );
    await assert.rejects(w.navigator.xr.requestSession("immersive-vr"), {
      name: "InvalidStateError",
    });
    const q = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)];
    const feed = (extra = {}) =>
      w.dispatchEvent(
        new w.MessageEvent("message", {
          source: w,
          data: {
            source: "xreal-extension",
            type: "pose",
            pose: {
              connected: true,
              calibrated: true,
              age_ms: 0,
              status: "Tracking",
              quaternion: q,
              ...extra,
            },
          },
        }),
      );
    feed();
    const toolbar = w.document.querySelector("#xreal-webxr-toolbar").shadowRoot;
    toolbar.querySelector("#connect").click();
    feed({
      connected: false,
      calibrated: false,
      status: "Waiting for XREAL USB connection — retrying automatically",
    });
    assert.match(
      toolbar.querySelector("#feedback").textContent,
      /Waiting for XREAL USB/,
    );
    assert.equal(toolbar.querySelector("#feedback").dataset.state, "error");
    feed();
    assert.equal(
      toolbar.querySelector("#feedback").textContent,
      "Glasses reconnected — tracking is live",
    );
    toolbar.querySelector("#recenter").click();
    assert.equal(
      toolbar.querySelector("#feedback").textContent,
      "Recentering…",
    );
    // A pose is not an acknowledgement, even if orientation happens to be zero.
    feed();
    assert.equal(
      toolbar.querySelector("#feedback").textContent,
      "Recentering…",
    );
    w.dispatchEvent(
      new w.MessageEvent("message", {
        source: w,
        data: {
          source: "xreal-extension",
          type: "command_result",
          command: "recenter",
          ok: true,
        },
      }),
    );
    assert.equal(
      toolbar.querySelector("#feedback").textContent,
      "Recentered ✓",
    );
    feed();
    assert.equal(
      toolbar.querySelector("#feedback").textContent,
      "Recentered ✓",
    );
    const session = await w.navigator.xr.requestSession("immersive-vr", {
      requiredFeatures: ["local"],
    });
    const canvas = w.document.querySelector("canvas");
    const gl = {
      canvas,
      COLOR_CLEAR_VALUE: 1,
      DEPTH_CLEAR_VALUE: 2,
      STENCIL_CLEAR_VALUE: 3,
      COLOR_BUFFER_BIT: 4,
      DEPTH_BUFFER_BIT: 8,
      STENCIL_BUFFER_BIT: 16,
      getParameter(p) {
        return p === 1 ? [0, 0, 0, 0] : 0;
      },
      clear() {},
      clearColor() {},
      clearDepth() {},
      clearStencil() {},
    };
    const layer = new w.XRWebGLLayer(session, gl);
    session.updateRenderState({ baseLayer: layer });
    const ref = await session.requestReferenceSpace("local");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("No XR frame within 2 seconds")),
        2000,
      );
      session.requestAnimationFrame((t, frame) => {
        try {
          const pose = frame.getViewerPose(ref);
          assert.equal(pose.views.length, 2);
          assert.deepEqual(
            Array.from(pose.views, (v) => v.eye),
            ["left", "right"],
          );
          const boxes = Array.from(pose.views, (v) => {
            const p = layer.getViewport(v);
            return [p.x, p.y, p.width, p.height];
          });
          assert.deepEqual(boxes, [
            [0, 0, 1920, 1080],
            [1920, 0, 1920, 1080],
          ]);
          assert.ok(Math.abs(pose.transform.orientation.y - q[1]) < 1e-5);
          const eyes = pose.views.map((v) => v.transform.position);
          assert.ok(
            Math.abs(
              Math.hypot(
                eyes[0].x - eyes[1].x,
                eyes[0].y - eyes[1].y,
                eyes[0].z - eyes[1].z,
              ) - 0.063,
            ) < 1e-5,
          );
          assert.equal(session.inputSources.length, 0);
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
    });
    // Transport can remain alive after USB loss: that must still stop XR.
    const ended = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("XR did not end after sensor loss")),
        1500,
      );
      session.addEventListener(
        "end",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
    feed({ connected: false, calibrated: false });
    await ended;
    await assert.rejects(w.navigator.xr.requestSession("immersive-vr"), {
      name: "InvalidStateError",
    });
    const demo = await readFile(
      new URL("../../web/demo.html", import.meta.url),
      "utf8",
    );
    const parsed = new JSDOM(demo);
    const source = parsed.window.document.querySelector("script").textContent;
    for (const id of ["enter", "result"])
      w.document.body.append(parsed.window.document.querySelector("#" + id));
    parsed.window.close();
    canvas.id = "c";
    Object.setPrototypeOf(gl, w.WebGLRenderingContext.prototype);
    Object.assign(gl, {
      bindFramebuffer() {},
      enable() {},
      disable() {},
      viewport() {},
      scissor() {},
    });
    canvas.getContext = () => gl;
    w.eval(source);
    w.document.querySelector("#enter").click();
    assert.equal(
      w.document.querySelector("#enter").textContent,
      "Starting VR…",
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.match(
      w.document.querySelector("#result").textContent,
      /Could not start VR: Connect glasses/,
    );
    feed();
    w.document.querySelector("#enter").click();
    const deadline = Date.now() + 2000;
    while (!w.xrTest?.frames && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(
      w.xrTest?.frames > 0,
      w.document.querySelector("#result").textContent,
    );
    assert.equal(w.xrTest.views, 2);
    assert.equal(w.document.querySelector("#enter").textContent, "VR running");
    w.dispatchEvent(
      new w.MessageEvent("message", {
        source: w,
        data: {
          source: "xreal-extension",
          type: "dev_reload",
          build: "b".repeat(64),
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.match(
      toolbar.querySelector("#feedback").textContent,
      /Extension rebuilt/,
    );
    assert.match(w.document.querySelector("#result").textContent, /VR ended/);
  } finally {
    w.close();
  }
});
