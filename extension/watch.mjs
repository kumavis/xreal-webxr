import { watch } from "node:fs";
import { spawn } from "node:child_process";
let child = null,
  queued = false,
  timer;
function rebuild() {
  if (child) {
    queued = true;
    return;
  }
  child = spawn(process.execPath, ["build.mjs"], { stdio: "inherit" });
  child.on("exit", (code) => {
    child = null;
    if (code)
      console.error("Build failed; keeping the previous reload marker.");
    if (queued) {
      queued = false;
      rebuild();
    }
  });
}
const watchers = [];
for (const directory of ["src", "../web", "."]) {
  watchers.push(
    watch(directory, (_event, name) => {
      if (!name) return;
      const relevant =
        directory === "src"
          ? name.endsWith(".js")
          : directory === "../web"
            ? name.endsWith(".html")
            : ["build.mjs", "manifest.json", "package-lock.json"].includes(
                name,
              );
      if (!relevant) return;
      clearTimeout(timer);
      timer = setTimeout(rebuild, 150);
    }),
  );
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearTimeout(timer);
    watchers.forEach((w) => w.close());
    child?.kill();
    process.exit(0);
  });
console.log(
  "Watching extension source and local scene. Ctrl-C stops watching.",
);
rebuild();
