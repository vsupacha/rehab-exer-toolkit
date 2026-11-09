import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stationaryReference,stationaryProfile} from '../docs/lib/zero.js';
import {PatternTracker,learnPattern} from '../docs/lib/pattern.js';
import {velocityCalibration} from '../docs/lib/velocity.js';
const still=Array.from({length:15},(_,i)=>({monotonicMs:i*100,acceleration:[-.98,.03,.04],angularVelocity:[0,0,0]}));
test('50 Hz batched receipts allow equal times but real gaps and reversal still fail',()=>{
  const batches=Array.from({length:19},(_,i)=>Array.from({length:4},()=>({monotonicMs:i*80,acceleration:[0,0,1]}))).flat();
  assert.deepEqual(stationaryReference(batches),[0,0,1]);
  assert.throws(()=>stationaryReference([...batches,{monotonicMs:2200,acceleration:[0,0,1]}]),/760 ms/);
  assert.throws(()=>stationaryReference([...batches,{monotonicMs:1400,acceleration:[0,0,1]}]),/ย้อน/);
});
test('startup stationary reference uses current gravity/bias and rejects motion or incomplete streams',()=>{
  const ref=stationaryReference(still);
  ref.forEach((v,i)=>assert.ok(Math.abs(v-still[0].acceleration[i])<1e-12));
  assert.throws(()=>stationaryReference(still.slice(0,5)));
  assert.throws(()=>stationaryReference(still.filter((_,i)=>i<3||i>9)));
  assert.throws(()=>stationaryReference(still.map((f,i)=>i===5?{...f,acceleration:[0,0,1]}:f)));
  assert.throws(()=>stationaryReference(still.map(f=>({...f,angularVelocity:[0,8,0]}))));
});
test('new reference and tracker zero accumulated velocity on each start/resume',()=>{
  const cal={velocityMode:true,directionReliable:true,axis:[0,1,0],axisChoice:'Y',threshold:.1,directionThreshold:.1,reference:[0,0,1]};
  const previous=new PatternTracker(cal);
  for(let t=0;t<1000;t+=100)previous.update({monotonicMs:t,acceleration:[0,.1,1]});
  assert.ok(Math.abs(previous.velocity[1])>0);
  const reference=stationaryReference(still),next=new PatternTracker({...cal,reference});
  assert.deepEqual(next.velocity,[0,0,0]);
  for(let t=1500;t<5000;t+=100){assert.equal(next.update({monotonicMs:t,acceleration:[...reference]}),null);assert.ok(next.signal<1e-10);}
  assert.deepEqual(cal.reference,[0,0,1]);
});
test('stationary teaching starts from measured reference and does not integrate sub-noise drift',()=>{
  const prep=Array.from({length:16},(_,i)=>({monotonicMs:i*100,acceleration:[-.98,.03+(i%2?.0002:-.0002),.04]}));
  const profile=stationaryProfile(prep);
  const capture=Array.from({length:121},(_,i)=>({monotonicMs:2000+i*100,acceleration:[-.98,.03+(i%2?.0002:-.0002),.04]}));
  const cal=velocityCalibration(learnPattern(capture,2000,profile),{axis:'Y'});
  assert.ok(cal.training.every(s=>Math.abs(s.velocity[1])<1e-10));
  const moving=capture.map((f,i)=>({...f,acceleration:[-.98,.03+.04*Math.sin(i*.3),.04]}));
  const actual=velocityCalibration(learnPattern(moving,2000,profile),{axis:'Y'});
  assert.ok(actual.training.some(s=>Math.abs(s.velocity[1])>1));
});
