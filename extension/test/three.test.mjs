import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

test("Three.js WebXRManager consumes the bridge's floor-relative stereo frames", async () => {
  const dom = new JSDOM(
    '<!doctype html><body><canvas width="3840" height="1080"></canvas></body>',
    {
      url: "http://127.0.0.1:4242/scene",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
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
    w.eval(
      await readFile(new URL("../dist/runtime.js", import.meta.url), "utf8"),
    );
    const bundled = await build({
      stdin: {
        contents:
          'export {WebXRManager} from "three/src/renderers/webxr/WebXRManager.js"; export {PerspectiveCamera} from "three";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      },
      bundle: true,
      format: "iife",
      globalName: "ThreeTest",
      write: false,
    });
    w.eval(bundled.outputFiles[0].text);
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
            quaternion: [0, Math.sin(0.2), 0, Math.cos(0.2)],
          },
        },
      }),
    );
    const canvas = w.document.querySelector("canvas");
    const gl = {
      canvas,
      get drawingBufferWidth() {
        return canvas.width;
      },
      get drawingBufferHeight() {
        return canvas.height;
      },
      getContextAttributes() {
        return {
          xrCompatible: true,
          antialias: true,
          depth: true,
          stencil: false,
        };
      },
      COLOR_CLEAR_VALUE: 1,
      DEPTH_CLEAR_VALUE: 2,
      STENCIL_CLEAR_VALUE: 3,
      getParameter(p) {
        return p === 1 ? [0, 0, 0, 0] : 0;
      },
      clear() {},
      clearColor() {},
      clearDepth() {},
      clearStencil() {},
    };
    const renderer = {
      getRenderTarget() {
        return null;
      },
      getPixelRatio() {
        return 1;
      },
      getSize(v) {
        return v.set(canvas.width, canvas.height);
      },
      setPixelRatio() {},
      setSize(x, y) {
        canvas.width = x;
        canvas.height = y;
      },
      setRenderTarget() {},
      setRenderTargetFramebuffer() {},
      outputColorSpace: "srgb",
    };
    const xr = new w.ThreeTest.WebXRManager(renderer, gl);
    xr.setReferenceSpaceType("local-floor");
    const session = await w.navigator.xr.requestSession("immersive-vr", {
      requiredFeatures: ["local-floor"],
    });
    await xr.setSession(session);
    assert.ok(xr.getBaseLayer() instanceof w.XRWebGLLayer);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("No Three.js XR frame")),
        2000,
      );
      xr.setAnimationLoop(() => {
        try {
          const cameras = xr.getCamera().cameras;
          assert.equal(cameras.length, 2);
          assert.deepEqual(
            Array.from(cameras, (c) => Array.from(c.viewport.toArray())),
            [
              [0, 0, 1920, 1080],
              [1920, 0, 1920, 1080],
            ],
          );
          assert.ok(Math.abs(cameras[0].position.y - 1.2) < 1e-5);
          assert.ok(Math.abs(cameras[0].quaternion.y - Math.sin(0.2)) < 1e-5);
          xr.updateCamera(new w.ThreeTest.PerspectiveCamera(55, 1, 0.05, 80));
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
    await session.end();
    assert.equal(xr.isPresenting, false);
  } finally {
    w.close();
  }
});
