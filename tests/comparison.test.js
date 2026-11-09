import {test} from 'node:test';
import assert from 'node:assert/strict';
import {angleFor, compareArms, wrapDegrees} from '../docs/lib/comparison.js';
const arm = (angles, time = 1000) => ({active: true, frame: {angles, monotonicMs: time}, baseline: null, sign: 1});
test('neutral offsets and reversed mounting apply only to comparison', () => {
  const frame = {angles: [-175, 30, 40]};
  assert.equal(angleFor(frame, 0, [175, 0, 0]), 10);
  assert.equal(angleFor(frame, 0, [175, 0, 0], -1), -10);
  assert.deepEqual(frame.angles, [-175, 30, 40]);
});
test('wrap-around gives shortest signed left-minus-right angle', () => {
  const result = compareArms(arm([179, 20, 30]), arm([-179, 10, 15]), {axis: 0, now: 1100});
  assert.equal(result.difference, -2); assert.equal(wrapDegrees(720), 0);
});
test('comparison pauses for missing, disconnected, stale or distant samples', () => {
  const left = arm([10, 20, 30]), right = arm([5, 10, 15]);
  assert.equal(compareArms(left, right, {axis: 1, now: 1100}).difference, 10);
  assert.equal(compareArms(left, {...right, active: false}, {now: 1100}).valid, false);
  assert.equal(compareArms(left, {...right, frame: null}, {now: 1100}).valid, false);
  assert.equal(compareArms(left, right, {now: 1501}).valid, false);
  assert.equal(compareArms(left, arm([0, 0, 0], 800), {now: 1100}).valid, false);
});
