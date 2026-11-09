/** Sensor-axis comparison; not anatomical joint angles or clinical symmetry. */
export const wrapDegrees = value => ((value + 180) % 360 + 360) % 360 - 180;
export function angleFor(frame, axis, baseline = null, sign = 1) {
  return wrapDegrees((frame.angles[axis] - (baseline?.[axis] ?? 0)) * sign);
}
export function compareArms(left, right, {axis = 0, now, staleMs = 500, maxSkewMs = 150} = {}) {
  if (!left.active || !right.active || !left.frame || !right.frame) return {valid: false, reason: 'Connect both arms and wait for motion data.'};
  const skewMs = Math.abs(left.frame.monotonicMs - right.frame.monotonicMs);
  if ([left, right].some(arm => now - arm.frame.monotonicMs > staleMs)) return {valid: false, reason: 'Waiting for fresh data from both arms.', skewMs};
  if (skewMs > maxSkewMs) return {valid: false, reason: 'Samples are too far apart in receive time.', skewMs};
  const l = angleFor(left.frame, axis, left.baseline, left.sign);
  const r = angleFor(right.frame, axis, right.baseline, right.sign);
  return {valid: true, left: l, right: r, difference: wrapDegrees(l - r), skewMs};
}
