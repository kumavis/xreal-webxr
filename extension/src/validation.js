export function validPose(p) {
  if (
    !p ||
    typeof p.connected !== "boolean" ||
    typeof p.calibrated !== "boolean" ||
    typeof p.status !== "string" ||
    !Number.isFinite(p.age_ms)
  )
    return false;
  if (
    !Array.isArray(p.quaternion) ||
    p.quaternion.length !== 4 ||
    !p.quaternion.every(Number.isFinite)
  )
    return false;
  return Math.abs(Math.hypot(...p.quaternion) - 1) < 0.02;
}
// Convert diagonal optical FOV to vertical FOV for each 16:9 eye viewport.
export function verticalFov(diagonalDegrees) {
  return (
    2 *
    Math.atan(
      Math.tan((diagonalDegrees * Math.PI) / 360) / Math.hypot(16 / 9, 1),
    )
  );
}
