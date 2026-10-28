# Third-party software

- `vendor/ar-drivers`: Alex Badics and contributors, MIT. Copied from https://github.com/badicsalex/ar-drivers-rs at commit `56bfa489ab697706ea95b36c2e43c5ca15d6a263`. Original license and source headers retained. Includes Air 2 Ultra support. Local changes, if any, are documented below.
- `iwer` 2.7.0: Meta Platforms, Inc. and affiliates, MIT. https://github.com/meta-quest/immersive-web-emulation-runtime. Bundled by npm/esbuild; license notices retained in the bundle. Supplies browser-side WebXR emulation, including stereo views.
- Other Rust/JavaScript dependencies and exact versions are recorded in Cargo.lock and extension/package-lock.json. Their upstream licenses apply.

No code from the noncommercial AR Workspace Manager application or the closed-source VertoXR app is included. The new bridge implementation is MIT licensed.

## Local driver changes

Added raw display-mode read/restore methods in `nreal_air.rs` to preserve the exact stereo/refresh mode at shutdown; the upstream enum merges several firmware modes.
