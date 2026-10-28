import { test } from "node:test";
import assert from "node:assert/strict";
import { validPose, verticalFov } from "../src/validation.js";
const p = {
  connected: true,
  calibrated: true,
  status: "tracking",
  age_ms: 0,
  quaternion: [0, 0, 0, 1],
};
test("reject malformed and unnormalized hardware poses", () => {
  assert.ok(validPose(p));
  assert.ok(!validPose({ ...p, quaternion: [NaN, 0, 0, 1] }));
  assert.ok(!validPose({ ...p, quaternion: [0, 0, 0, 0] }));
  assert.ok(!validPose({ ...p, quaternion: [0, 0, 1] }));
});
test("52 degree diagonal becomes about 27 degree vertical per eye", () => {
  const v = (verticalFov(52) * 180) / Math.PI;
  assert.ok(v > 26 && v < 28);
});
