import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RepTracker, calibrate, meanPose, project} from '../docs/lib/exercise.js';

test('calibration learns opposite mounted handles independently and normalizes baseline', () => {
  const l = calibrate([5,10,-5],[50,12,-4]);
  const r = calibrate([-5,8,4],[-45,10,5]);
  assert.equal(l.axis,0); assert.equal(r.axis,0);
  assert.equal(project({angles:[50,12,-4]},l),1);
  assert.equal(project({angles:[-25,10,5]},r),.5);
  assert.equal(project({angles:[59,10,-5]},l),1.2);
});
test('circular capture handles boundary and rejects insufficient, moving, or flat calibration', () => {
  const mean = meanPose([179,-179,180].map(v => ({angles:[v,0,0]})));
  assert.equal(Math.abs(mean[0]),180);
  assert.throws(() => meanPose([]));
  assert.throws(() => meanPose([0,10,20].map(v => ({angles:[v,0,0]}))));
  assert.throws(() => calibrate([0,0,0],[1,2,3]));
  const c = calibrate([170,0,0],[-170,0,0]);
  assert.equal(c.span,20); assert.equal(project({angles:[-180,0,0]},c),.5);
});
function feed(tracker, values, start=0) {
  return values.map((p,i) => tracker.update(p,start+i*100)).filter(Boolean);
}
const cycle = [0,0,0,.3,.6,.9,1,1,.6,.3,.1,.05,0];
test('one full cycle yields separate outbound, return, total and baseline excursion', () => {
  const t = new RepTracker(); const [r] = feed(t,cycle);
  assert.equal(r.outbound_s,.2); assert.equal(r.return_s,.2); assert.equal(r.cycle_s,.7);
  assert.equal(r.peakProgress,1);
  assert.equal(feed(t,Array(10).fill(0),1300).length,0);
});
test('held target, short excursion, jitter, and starting at target cannot score', () => {
  assert.equal(feed(new RepTracker(),Array(30).fill(1)).length,0);
  assert.equal(feed(new RepTracker(),[0,0,0,.3,.6,.3,0,0,0]).length,0);
  assert.equal(feed(new RepTracker(),[0,0,0,.1,.19,.16,.1,.05,0]).length,0);
  assert.equal(feed(new RepTracker(),[0,0,0,.3,1,.5,.2,0,0,0]).length,0);
});
test('dropout and explicit pause reset partial cycles; a fresh full cycle can score', () => {
  const t = new RepTracker(); feed(t,cycle.slice(0,9));
  assert.equal(feed(t,[0,0,0],2000).length,0);
  assert.equal(feed(t,cycle,2300).length,1);
  feed(t,cycle.slice(3,9),3700); t.reset();
  assert.equal(feed(t,[0,0,0],5000).length,0);
});
test('two trackers do not inherit counts or complete each other’s partial motion', () => {
  const left=new RepTracker(),right=new RepTracker();
  assert.equal(feed(left,cycle).length,1);
  assert.equal(feed(right,[0,0,0,.3,.5,.4,0,0,0]).length,0);
});

test('continuous game cycle without target hold and with negative home overshoot counts once', () => {
  const tracker = new RepTracker({targetThreshold:.75,homeThreshold:.25,targetDwellMs:0});
  const results = feed(tracker,[0,0,0,.35,.55,.8,.6,.3,-.35,-.4,-.3]);
  assert.equal(results.length,1); assert.equal(results[0].peakProgress,.8);
  assert.equal(feed(tracker,[-.3,-.35,-.4],1100).length,0);
});
test('negative travel alone cannot count as extension; reverse mounted calibration keeps target positive', () => {
  const tracker = new RepTracker({targetThreshold:.75,homeThreshold:.25,targetDwellMs:0});
  assert.equal(feed(tracker,[0,0,0,-.3,-.6,-.9,-.5,0,0,0]).length,0);
  const cal = calibrate([20,0,0],[-20,0,0]);
  assert.equal(project({angles:[-10,0,0]},cal),.75);
});
