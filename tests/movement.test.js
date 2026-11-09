import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restingAcceleration,MovementTracker} from '../docs/lib/movement.js';
const frame=(t,x=0)=>({monotonicMs:t,acceleration:[x,0,1]});
test('stationary reference requires enough valid stable acceleration samples',()=>{
  assert.deepEqual(restingAcceleration(Array.from({length:6},(_,i)=>frame(i*100))),[0,0,1]);
  assert.throws(()=>restingAcceleration([frame(0)]));
  assert.throws(()=>restingAcceleration([frame(0,.3),...Array.from({length:5},(_,i)=>frame(i*100))]));
});
test('unchanged angles do not prevent acceleration activity timing; rest and spikes do not count',()=>{
  const tracker=new MovementTracker([0,0,1],.05), results=[];
  for(let t=0;t<=3000;t+=50) {
    const result=tracker.update(frame(t,t>=800 && t<1800 ? .15 : 0));
    if(result) results.push(result);
  }
  assert.equal(results.length,1);assert.ok(results[0].movement_s>=.9 && results[0].movement_s<=1.3);
  assert.ok(results[0].peak_acceleration_g>.14);
  for(let t=3050;t<=4000;t+=50) assert.equal(tracker.update(frame(t,t===3100?.06:0)),null);
});
test('stale stream, pause reset and invalid samples discard partial timing',()=>{
  const tracker=new MovementTracker([0,0,1]);
  for(let t=0;t<=1400;t+=100) tracker.update(frame(t,t>700?.2:0));
  assert.equal(tracker.state,'moving');
  assert.equal(tracker.update(frame(2100)),null);assert.equal(tracker.state,'await_still');
  tracker.reset();assert.equal(tracker.started,null);
  assert.equal(tracker.update({monotonicMs:2200,acceleration:[NaN,0,1]}),null);
});
test('brief acceleration and braking pulses survive filtering at multiple sample rates',()=>{
  for(const step of [20,50,100]) {
    const tracker=new MovementTracker([0,0,1],.05), results=[];
    for(let t=0;t<=3000;t+=step) {
      // 200 ms pulses separated by a short low-acceleration interval.
      const x=t>=800&&t<1000 ? .12 : t>=1300&&t<1500 ? -.12 : 0;
      const result=tracker.update(frame(t,x));if(result) results.push(result);
    }
    assert.equal(results.length,1,`sample interval ${step}`);
    assert.ok(results[0].peak_acceleration_g>.05);
  }
});
test('one large spike and stationary noise do not become movement',()=>{
  const tracker=new MovementTracker([0,0,1],.05);
  for(let t=0;t<=3500;t+=50) {
    assert.equal(tracker.update(frame(t,t===900?.8:.005*Math.sin(t))),null);
  }
  assert.equal(tracker.state,'ready');
});
test('resultant acceleration is invariant to flipped, swapped and rotated mounts',()=>{
  const mounts=[v=>v,([x,y,z])=>[-x,y,-z],([x,y,z])=>[z,x,y],
    ([x,y,z])=>[(x-y)/Math.sqrt(2),(x+y)/Math.sqrt(2),z]];
  const runs=mounts.map(rotate=>{
    const tracker=new MovementTracker(rotate([0,0,1]),.05), signals=[],results=[];
    for(let t=0;t<=3000;t+=50) {
      const result=tracker.update({monotonicMs:t,acceleration:rotate([t>=800&&t<1600?.12:0,0,1])});
      signals.push(tracker.signal);if(result) results.push(result);
    }
    return {signals,results};
  });
  for(const run of runs) {
    assert.equal(run.results.length,1);
    assert.equal(run.results[0].movement_s,runs[0].results[0].movement_s);
    run.signals.forEach((value,i)=>assert.ok(Math.abs(value-runs[0].signals[i])<1e-12));
  }
});
