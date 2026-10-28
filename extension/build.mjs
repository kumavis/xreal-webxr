import { build } from "esbuild";
import {
  mkdir,
  copyFile,
  readFile,
  readdir,
  writeFile,
  rename,
} from "node:fs/promises";
import { createHash } from "node:crypto";
// Deterministic source revision, including build tooling and local scene assets.
const inputs = [
  "build.mjs",
  "manifest.json",
  "package-lock.json",
  ...(await readdir("src"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => `src/${name}`),
  ...["index", "demo", "scene"].map((name) => `../web/${name}.html`),
].sort();
const hash = createHash("sha256");
for (const path of inputs) {
  hash.update(path);
  hash.update(await readFile(path));
}
const buildId = hash.digest("hex");
await mkdir("dist", { recursive: true });
for (const name of ["runtime", "relay", "background"])
  await build({
    entryPoints: [`src/${name}.js`],
    outfile: `dist/${name}.js`,
    bundle: true,
    format: "iife",
    target: "chrome120",
    legalComments: "eof",
    define: { __XREAL_BUILD_ID__: JSON.stringify(buildId) },
  });
await copyFile("manifest.json", "dist/manifest.json");

await mkdir("dist/licenses", { recursive: true });
for (const [name, file] of [
  ["iwer", "LICENSE"],
  ["gl-matrix", "LICENSE.md"],
  ["webxr-layers-polyfill", "LICENSE"],
]) {
  await copyFile(`node_modules/${name}/${file}`, `dist/licenses/${name}.txt`);
}
await copyFile("../LICENSE", "dist/licenses/xreal-webxr.txt");

// A self-contained local scene: no CDN or runtime network requests.
await mkdir("../web/dist", { recursive: true });
const threeLicense = await readFile("node_modules/three/LICENSE", "utf8");
await build({
  entryPoints: ["src/scene.js"],
  outfile: "../web/dist/scene.js",
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  legalComments: "eof",
  footer: { js: "/* Three.js license\n" + threeLicense + "*/" },
});

// Publish only after every build step succeeds. A failed/partial build must not
// trigger chrome.runtime.reload() against incomplete output.
await writeFile("../web/dist/build.json.tmp", JSON.stringify({ id: buildId }));
await rename("../web/dist/build.json.tmp", "../web/dist/build.json");
console.log(
  `Built ${buildId.slice(0, 12)} — connected development pages will reload.`,
);
