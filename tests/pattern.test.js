import {test} from 'node:test';
import assert from 'node:assert/strict';
import {learnPattern,inspectMovement,sensitivityCalibration,PatternTracker} from '../docs/lib/pattern.js';
const frame=(t,x=0)=>({monotonicMs:t,acceleration:[x,0,1]});
const training=()=>Array.from({length:241},(_,i)=>frame(i*50,.08*Math.sin(i*50*2*Math.PI/2200+.7)));
test('batched teaching equals distinct receipts and does not restart velocity state',()=>{
  const frames=training(),batched=frames.flatMap(f=>[f,{...f},{...f}]);
  const regular=learnPattern(frames,0),learned=learnPattern(batched,0);
  assert.deepEqual(learned.training,regular.training);
  const cal={...regular,velocityMode:true,axisChoice:'X',directionReliable:true};
  const tracker=new PatternTracker(cal);
  for(const f of frames.slice(0,30)){tracker.update(f);const before=[...tracker.velocity];assert.equal(tracker.update({...f}),null);assert.deepEqual(tracker.velocity,before);}
});
test('stationary noise floor cannot be bypassed by raising sensitivity',()=>{
  const cal={...learnPattern(training(),0),noiseFloor:.1};
  assert.ok(sensitivityCalibration(cal,4).threshold>=.15);
  assert.equal(sensitivityCalibration(cal,4).usable,false);
});
test('unclear axis times magnitude activity without inventing direction changes',()=>{
  const cal={...learnPattern(training(),0),directionReliable:false,threshold:.02,directionThreshold:.02};
  const tracker=new PatternTracker(cal),results=[];
  for(let t=0;t<10000;t+=50){const r=tracker.update(frame(t,t>=1000&&t<2100?.15:0));if(r)results.push(r);}
  assert.equal(results.length,1);assert.equal(results[0].direction_changes,null);
  assert.equal(results[0].measurement,'filtered_magnitude_activity');
  assert.ok(results[0].movement_s>0);
});
test('sensitivity scales both gates and preserves original teaching data',()=>{
  const cal=learnPattern(training(),0),original=cal.threshold;
  const high=sensitivityCalibration(cal,4),low=sensitivityCalibration(cal,.25);
  assert.equal(high.threshold,original/4);assert.equal(high.directionThreshold,original/4);
  assert.equal(low.threshold,original*4);assert.equal(cal.threshold,original);
  assert.equal(high.training,cal.training);
  assert.throws(()=>sensitivityCalibration(cal,0));assert.throws(()=>sensitivityCalibration(cal,NaN));
  const stationary=learnPattern(training().map(f=>frame(f.monotonicMs)),0);
  assert.equal(sensitivityCalibration(stationary,4).usable,false);
});
test('continuous moving capture learns filtered level and principal axis without rest endpoints',()=>{
  const cal=learnPattern(training(),0);
  assert.ok(cal.threshold>.001);assert.ok(Math.abs(cal.axis[0])>.99);
  assert.ok(cal.reversals>=2);assert.equal(cal.training.length,241);
  assert.throws(()=>learnPattern(training().slice(0,30),0));
  assert.throws(()=>learnPattern(training().filter(f=>f.monotonicMs<=8000),0),/12/);
  const still=learnPattern(training().map(f=>frame(f.monotonicMs)),0);
  assert.equal(still.usable,false);assert.equal(still.training.length,241);
  assert.throws(()=>learnPattern(training().filter(f=>f.monotonicMs<3000||f.monotonicMs>4000),0));
});
test('weak Y-axis motion is retained with signed filtered samples and an explicit warning',()=>{
  const frames=training().map(f=>({...f,acceleration:[0,f.acceleration[0]*.02,1]}));
  const analysis=learnPattern(frames,0);
  assert.equal(analysis.training.length,frames.length);
  assert.ok(Math.abs(analysis.axis[1])>.99);
  assert.ok(analysis.amplitude<.003);assert.ok(analysis.warning);
  assert.ok(analysis.training.some(s=>s.filtered[1]>.0002));
  assert.ok(analysis.training.some(s=>s.filtered[1]<-.0002));
  assert.ok(analysis.training.every(s=>Number.isFinite(s.rms)&&Number.isFinite(s.signed)));
  assert.ok(inspectMovement(frames.slice(0,10),0).training.length===10);
});
test('signed filtered reversals follow variable cadence while rest produces no pairs',()=>{
  const cal=learnPattern(training(),0);
  for(const period of [1500,2700,4000]){
    const tracker=new PatternTracker(cal),results=[];
    for(let t=0;t<=12000;t+=50){const result=tracker.update(frame(t,.08*Math.sin(t*2*Math.PI/period)));if(result)results.push(result);}
    assert.ok(results.length>=2,`period ${period}`);
    assert.ok(results.every(r=>r.direction_changes===2&&r.movement_s>0));
  }
  const tracker=new PatternTracker(cal);
  for(let t=0;t<10000;t+=50)assert.equal(tracker.update(frame(t)),null);
});
test('flipped and axis-swapped mounts can relearn; stale data discards partial pair',()=>{
  const rotate=([x,y,z])=>[-z,y,x];
  const flipped=training().map(f=>({...f,acceleration:rotate(f.acceleration)}));
  const tracker=new PatternTracker(learnPattern(flipped,0));let count=0;
  for(const f of flipped)if(tracker.update(f))count++;
  assert.ok(count>=2);
  tracker.update({...flipped[0],monotonicMs:9000});assert.equal(tracker.reversals,0);assert.equal(tracker.started,null);
});
