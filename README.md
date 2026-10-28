# XREAL WebXR

An experimental, MIT-licensed bridge from XREAL glasses to WebXR on macOS. A Rust helper reads the glasses' IMU over USB; a Chromium extension supplies head orientation and side-by-side stereo to WebXR pages using [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime).

No custom browser, account, paid runtime, cameras, or base stations. The bridge runs locally. The website you visit may have its own account requirements.

**Prototype status:** real Air 2 Ultra sensor input and stationary calibration have been verified on an Apple Silicon Mac, at approximately 1,000 sensor samples/second. Automated tests cover fusion, stereo views, tracked orientation, and disconnect handling. The stereo diagnostic has also been confirmed working through the glasses by a user. The target website and the new Three.js scene still need visual verification. This is an experimental browser shim, not a certified WebXR runtime or a general OpenXR driver.

## What it does

- Rotational head tracking (3DoF), with a fixed seated position.
- Separate left/right views with adjustable IPD and field of view.
- On-demand full side-by-side display mode; restores the original mode on a normal Ctrl-C shutdown.
- Recenter, stationary gyro calibration, local status and stereo test pages.

There is no positional tracking, hand tracking, controller emulation, passthrough, or wireless transport. Moving your head sideways will not translate your virtual viewpoint. Yaw may drift; use Recenter. Sites that require hands, controllers, immersive AR, or unsupported WebXR features may not work.

## Requirements

- macOS, tested on Apple Silicon; Rust 1.88+ and Node.js 22+ with npm.
- Chrome or Brave with support for unpacked Manifest V3 extensions.
- XREAL glasses connected directly by a USB-C cable/port carrying both display output and USB data. Tested hardware: Air 2 Ultra. The vendored driver supports other Air models, but those have not been verified here.
- Close other software that owns the glasses' sensors, such as another XREAL tracking helper.

## Build and run

```sh
git clone https://github.com/kumavis/xreal-webxr.git
cd xreal-webxr
cargo run --release
```

Keep the glasses stationary for two seconds while calibration completes. The helper listens only on `127.0.0.1:4242`. It does not change display mode until you request it.

In another terminal:

```sh
cd xreal-webxr/extension
npm ci
npm run build
```

1. Open `chrome://extensions` (or `brave://extensions`).
2. Enable **Developer mode**, click **Load unpacked**, and select `extension/dist`.
3. Open <http://127.0.0.1:4242/demo>. Click **Connect** in the XREAL toolbar. Wait for **Tracking**, look forward, and click **Recenter**.
4. Click **Stereo mode**. The glasses should switch to a full side-by-side display (3840 × 1080). In macOS Display settings, use the glasses as an **extended display**, not a mirror of the laptop. Use the full 32:9 resolution if macOS offers scaled alternatives.
5. Move the browser window onto the glasses' display. Click the toolbar's **Fullscreen**, then the test page's **Enter VR**. Do this in that order; exit and re-enter XR after resizing or moving to a different screen.
6. The left eye should have a red background and the right a blue background. The white world marker should move opposite your head turn and remain fixed in the virtual world. **Alt+R** recenters. Use **Escape** to leave fullscreen, then **Exit XR** to end the session.
7. After the test works, open your `https://goooooo.ooo/` link, click **Connect** there, and use that site's **Enter VR** control. Private URL fragments remain in your browser; they are not part of this repository or sent to the helper.

Button presses now show immediate feedback. **Recentered ✓** appears only after the sensor worker confirms the command; ordinary pose updates cannot confirm it. **Enter VR** shows startup progress and any failure beside the button.

After installing the auto-reload version for the first time, click **Reload** on the extension card and refresh your open test page once. Subsequent successful builds automatically reload the extension and refresh connected supported pages. A refreshed page remembers whether it was connected to the helper; VR itself must be entered again. Rust helper changes still require rebuilding/restarting the helper.

The default optical values are 63 mm IPD and 52° diagonal FOV (Air 2 Ultra). Adjust the toolbar values to your glasses and fit. These are symmetric approximate optics, not factory lens calibration; IPD changes the rendered eye separation, not the physical optics.

## Orbit Room: full Three.js scene

Open <http://127.0.0.1:4242/scene> for a complete Three.js scene with a lit floor, nearby geometric exhibits, a moving orbital sculpture, shadows, and surrounding architectural landmarks. The page automatically connects to the helper; keep the glasses in stereo mode and the browser on their extended display, wait for Tracking, then click **Fullscreen + Enter VR**. Look forward and press **Alt+R** if the scene needs centering.

**Space** pauses/resumes the sculpture; **Escape** ends VR. Flat-screen preview supports dragging to orbit. In VR, the viewpoint is seated at 1.2 m with rotational tracking only. The scene hides its flat HTML controls during VR to avoid displaying them to just one eye.

Three.js is pinned in the npm lockfile and bundled locally, with no CDN or external assets. `cd extension && npm ci && npm run build` generates `web/dist/scene.js` as well as the extension. The helper serves that bundle from the source checkout, so keep the checkout in place when running the binary. A missing bundle returns an actionable build message. Scene JavaScript and HTML edits are picked up by the development watcher. The helper reads HTML from the checkout, falling back to embedded HTML if those files are absent.

## Recovery and diagnostics

- `<http://127.0.0.1:4242/>` shows helper status; `/status` exposes JSON.
- If there is no toolbar, verify the extension is enabled, reload it, and refresh the page. Its site access is intentionally limited to the local test and `goooooo.ooo`.
- If Connect fails, check that the helper is running. If Chrome asks for local-network access, allow it for this extension. The bridge does not need Accessibility, Screen Recording, a webcam, or Computer Use permission.
- If calibration does not finish, put the glasses on a steady surface and click **Calibrate**. Calibration requires two continuous seconds without movement.
- If the display looks doubled or cut in half, use **Mirror mode**. Exit XR before changing display modes. End the helper with **Ctrl-C** to restore the display mode it found on startup.
- If the helper crashed while stereo was active, stop any remaining helper and run `cargo run --release -- --mono` to restore a conventional mirrored image in the glasses.
- After USB disconnect, the helper automatically reopens the device when it returns. Keep the glasses still for two seconds to recalibrate, then re-enter VR. The existing browser connection can remain open. The browser ends XR when tracking is stale or lost.

Additional modes (stop the normal helper before using these):

```sh
cargo run --release -- --probe     # Read hardware for six seconds and exit
cargo run --release -- --simulate  # Synthetic rotation, no USB hardware
cargo run --release -- --mono      # Restore mirrored display and exit
```

## Architecture and privacy

```text
XREAL IMU ── USB HID ── Rust fusion ── loopback WebSocket ── extension ── WebXR page
XREAL displays ◀── USB-C DisplayPort ◀── fullscreen browser stereo canvas
```

`helper/` owns the HID connection, estimates orientation, and broadcasts pose at about 90 Hz. `extension/` runs IWER in the page's JavaScript world and relays pose through an isolated content script and extension service worker. WebXR applications receive two views separated by the configured IPD. Rendering and optical output depend on browser/display refresh; the 1,000 Hz IMU rate is not the rendering rate. There is no prediction or asynchronous reprojection.

The helper receives only `recenter`, `calibrate`, `stereo`, and `mono` commands. It does not receive the website URL, its contents, or credentials. There is no telemetry. The socket is loopback-only and checks browser Origin; any locally installed Chromium extension can connect, so this is not a boundary against hostile local software. The enabled website can access orientation through the injected runtime.

To add another site, edit both content-script `matches` lists in `extension/manifest.json` and the origin allowlist in `extension/src/background.js`, then rebuild and reload. Cross-origin iframes are not injected by default. WebXR content inside an iframe may require additional explicit host matching and frame support. The extension overrides native WebXR only on its enabled pages; disable it when using another headset/runtime there.

## Development

For automatic builds and browser reloads, keep the helper running and start:

```sh
cd extension
npm run dev
```

The watcher rebuilds after edits to extension JavaScript, local scene HTML, the manifest, build script, or lockfile. A completed build publishes an atomic revision marker; connected supported pages check it about every two seconds. On a new revision, the extension tells those pages to refresh, calls Chrome's `runtime.reload()`, and the page then loads the new scripts. It ends any active XR session before refreshing. No new Chrome permissions are required.

A supported page must be open for polling; background tabs can be throttled by Chrome. If no supported page is open, the next visit performs the check. Only pages attached to this extension are refreshed, including the enabled remote site. Failed builds and an unavailable helper do not trigger reloads. `npm run build` also publishes a revision, so the watcher is optional if you prefer explicit builds. Rebuilding unchanged inputs does not reload anything.

The build endpoint receives only the installed build hash, never the current page URL or contents. The helper logs a new observed build hash, which can be used to verify that an automatic reload completed. The watcher stops with Ctrl-C.

Run checks with:

```sh
cargo test --workspace
cargo fmt --all -- --check
cd extension
npm ci
npm run build
npm test
```

The browser integration test runs the actual bundle in jsdom with a mocked WebGL context. It checks native-runtime replacement, session gating, two 1920 × 1080 eye viewports at a 3840 × 1080 test size, 63 mm separation, quaternion propagation, and session shutdown on sensor loss. It does not test a GPU, extension service-worker integration in Chrome, or physical optics.

The implementation is MIT licensed. See [THIRD_PARTY.md](THIRD_PARTY.md) for the MIT driver and IWER provenance. Built extensions include dependency licenses in `dist/licenses/`.

The Three.js integration test uses the real `WebXRManager` with the bundled bridge and mocked graphics calls. It verifies stereo cameras, full eye viewports, floor-relative height, quaternion propagation, and session cleanup; physical GPU rendering still requires a browser check.
