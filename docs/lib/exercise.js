import {wrapDegrees} from './comparison.js';

export function meanPose(frames) {
  if (frames.length < 3) throw new Error('รอข้อมูลนิ่งอย่างน้อย 3 ตัวอย่างก่อนบันทึก');
  return [0, 1, 2].map(axis => {
    const first = frames[0].angles[axis];
    const values = frames.map(frame => wrapDegrees(frame.angles[axis] - first));
    if (Math.max(...values) - Math.min(...values) > 8) throw new Error('มือจับยังเคลื่อนไหวอยู่ กรุณาค้างท่าให้นิ่งแล้วบันทึกอีกครั้ง');
    return wrapDegrees(first + values.reduce((a, b) => a + b, 0) / values.length);
  });
}
export function calibrate(home, target) {
  const delta = target.map((value, axis) => wrapDegrees(value - home[axis]));
  const axis = delta.reduce((best, value, i) => Math.abs(value) > Math.abs(delta[best]) ? i : best, 0);
  if (Math.abs(delta[axis]) < 8) throw new Error('มุมเปลี่ยนน้อยกว่า 8° จึงแยกท่านี้จาก IMU ไม่ได้ ลองตรวจตำแหน่งติดตั้ง หรือใช้ vision/เซนเซอร์ตำแหน่งร่วมสำหรับท่าเลื่อนตรง');
  return {home: [...home], axis, span: delta[axis]};
}
export function project(frame, calibration) {
  return wrapDegrees(frame.angles[calibration.axis] - calibration.home[calibration.axis]) / calibration.span;
}
/** Complete home → target → home cycles. Times use browser receive timestamps.
 * Thresholds/dwells are prototype noise rejection, not prescribed exercise loads.
 */
export class RepTracker {
  constructor({targetThreshold = .85, homeThreshold = .15, targetDwellMs = 200} = {}) {
    this.targetThreshold = targetThreshold; this.homeThreshold = homeThreshold;
    this.targetDwellMs = targetDwellMs; this.reset();
  }
  reset() {
    this.state = 'await_home'; this.lastTime = null; this.homeSince = null;
    this.targetSince = null; this.started = null; this.targetAt = null;
    this.returnAt = null; this.homeAt = null; this.peak = 0;
  }
  update(progress, time) {
    if (!Number.isFinite(progress) || !Number.isFinite(time)) { this.reset(); return null; }
    if (this.lastTime !== null && (time <= this.lastTime || time - this.lastTime > 500)) this.reset();
    this.lastTime = time;
    // Returning past the starting baseline is still a return, not a blocked rep.
    const home = progress <= this.homeThreshold;
    if (this.state === 'await_home') {
      if (!home) this.homeSince = null;
      else if (this.homeSince === null) this.homeSince = time;
      else if (time - this.homeSince >= 200) { this.state = 'ready'; this.homeSince = null; }
      return null;
    }
    if (this.state === 'ready') {
      if (progress > this.homeThreshold + .05) { this.state = 'outbound'; this.started = time; this.peak = progress; }
      return null;
    }
    this.peak = Math.max(this.peak, progress);
    if (this.state === 'outbound') {
      if (home) { this.reset(); this.lastTime = time; return null; }
      if (progress >= this.targetThreshold && time - this.started >= 200) {
        this.targetSince ??= time;
        if (time - this.targetSince >= this.targetDwellMs) { this.targetAt = this.targetSince; this.state = 'target'; }
      } else this.targetSince = null;
    } else if (this.state === 'target') {
      if (progress < this.targetThreshold - .1) { this.returnAt = time; this.state = 'returning'; }
    }
    if (this.state === 'returning') {
      if (home) {
        this.homeAt ??= time;
        if (time - this.homeAt >= 200) {
          if (this.homeAt - this.started < 400) { this.reset(); this.lastTime = time; return null; }
          const result = {outbound_s: (this.targetAt - this.started) / 1000,
            return_s: (this.homeAt - this.returnAt) / 1000,
            cycle_s: (this.homeAt - this.started) / 1000, peakProgress: this.peak};
          this.reset(); this.state = 'ready'; this.lastTime = time;
          return result;
        }
      } else this.homeAt = null;
    }
    return null;
  }
}
