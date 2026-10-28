import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
for (const name of ["runtime", "relay", "background"])
  await build({
    entryPoints: [`src/${name}.js`],
    outfile: `dist/${name}.js`,
    bundle: true,
    format: "iife",
    target: "chrome120",
    legalComments: "eof",
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
