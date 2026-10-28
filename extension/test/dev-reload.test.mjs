import test from "node:test";
import assert from "node:assert/strict";
import { createDevReloader } from "../src/dev-reload.js";
const oldBuild = "a".repeat(64),
  newBuild = "b".repeat(64);

test("a completed build notifies connected pages before one extension reload", async () => {
  const events = [];
  let checks = 0;
  const reload = createDevReloader(oldBuild, {
    fetchBuild: async () => {
      checks++;
      return { ok: true, json: async () => ({ id: newBuild }) };
    },
    wait: async () => events.push("wait"),
    reload: () => events.push("reload"),
  });
  const removed = {
    postMessage: () => assert.fail("removed port was notified"),
  };
  reload.add(removed);
  reload.remove(removed);
  reload.add({ postMessage: (message) => events.push(message) });
  reload.add({
    postMessage() {
      throw Error("tab closed");
    },
  });
  await Promise.all([reload.check(), reload.check()]);
  await reload.check();
  assert.equal(checks, 1);
  assert.deepEqual(events, [
    { type: "dev_reload", build: newBuild },
    "wait",
    "reload",
  ]);
});

test("same, missing, malformed, and failed build checks leave the running extension alone", async () => {
  for (const fetchBuild of [
    async () => ({ ok: true, json: async () => ({ id: oldBuild }) }),
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ id: "partial" }) }),
    async () => ({
      ok: true,
      json: async () => {
        throw Error("partial JSON");
      },
    }),
    async () => {
      throw Error("helper offline");
    },
  ]) {
    const reload = createDevReloader(oldBuild, {
      fetchBuild,
      reload: () => assert.fail("unexpected reload"),
    });
    await reload.check();
  }
});

test("checking recovers when the helper returns after an outage", async () => {
  let online = false,
    reloads = 0;
  const reload = createDevReloader(oldBuild, {
    fetchBuild: async () => {
      if (!online) throw Error("offline");
      return { ok: true, json: async () => ({ id: newBuild }) };
    },
    wait: async () => {},
    reload: () => reloads++,
  });
  await reload.check();
  online = true;
  await reload.check();
  assert.equal(reloads, 1);
});
