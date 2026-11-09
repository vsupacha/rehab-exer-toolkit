import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VelocityEstimator,velocityCalibration,manualVelocityThreshold} from '../docs/lib/velocity.js';
test('duplicate receipt timestamp neither integrates twice nor zeroes velocity',()=>{
  const estimator=new VelocityEstimator();estimator.update([.01,0,0],0);const before=estimator.update([.01,0,0],100);
  assert.ok(before[0]>0);assert.deepEqual(estimator.update([.02,0,0],100),before);
  assert.ok(estimator.update([.01,0,0],200)[0]>before[0]);
});
test('manual threshold applies exact value to magnitude and signed gates without mutating calibration',()=>{
  const cal={threshold:10,directionThreshold:10,noiseFloor:8};
  const adjusted=manualVelocityThreshold(cal,2.75);
  assert.equal(adjusted.threshold,2.75);assert.equal(adjusted.directionThreshold,2.75);
  assert.equal(adjusted.thresholdMode,'manual');assert.equal(cal.threshold,10);
  for(const invalid of [0,-1,NaN,Infinity,1001])assert.throws(()=>manualVelocityThreshold(cal,invalid));
});
test('signed integration uses actual dt and g to cm/s conversion with bounded drift',()=>{
  for(const step of [10,20,100]){
    const e=new VelocityEstimator({smoothingMs:0});let v;
    for(let t=0;t<=1000;t+=step)v=e.update([.01,-.01,0],t);
    const expected=.01*980.665*3*(1-Math.exp(-1/3));
    assert.ok(Math.abs(v[0]-expected)<.2);assert.equal(v[1],-v[0]);assert.equal(v[2],0);
    assert.deepEqual(e.update([.01,0,0],2000),[0,0,0]);
    assert.deepEqual(e.update([NaN,0,0],2100),[0,0,0]);
  }
});
test('velocity calibration retains signed components and explicit experimental mode',()=>{
  const training=Array.from({length:161},(_,i)=>({elapsedMs:i*50,filtered:[.01*Math.sin(i*.1),0,0]}));
  const cal=velocityCalibration({training,reference:[0,0,1],axis:[1,0,0]});
  assert.equal(cal.velocityMode,true);assert.ok(cal.axisConfidence>.99);
  assert.equal(cal.training.length,161);assert.ok(cal.threshold>=.01);
  assert.ok(cal.training.some(s=>s.velocity[0]>0));
});
test('explicit Y ignores larger orthogonal velocity and reverse only changes sign',()=>{
  const training=Array.from({length:161},(_,i)=>({elapsedMs:i*50,filtered:[0,.02*Math.sin(i*.15),.2*Math.cos(i*.09)]}));
  const source={training,reference:[0,0,1],axis:[1,0,0]};
  const y=velocityCalibration(source,{axis:'Y'}),reversed=velocityCalibration(source,{axis:'Y',reverse:true});
  assert.deepEqual(y.axis,[0,1,0]);assert.equal(y.axisChoice,'Y');
  assert.equal(y.magnitudeAmplitude,y.amplitude);
  y.training.forEach((s,i)=>{assert.equal(s.velocitySigned,s.velocity[1]);assert.ok(Math.abs(reversed.training[i].velocitySigned+s.velocitySigned)<1e-12);});
  assert.equal(y.threshold,reversed.threshold);assert.equal(y.reversals,reversed.reversals);
  assert.throws(()=>velocityCalibration(source,{axis:'Q'}));
});
test('velocity data smoothing attenuates rapid variation while preserving signs and resetting history',()=>{
  const raw=new VelocityEstimator({smoothingMs:0}),smooth=new VelocityEstimator(),a=[],b=[];
  for(let t=0;t<=5000;t+=20){const input=[0,.04*Math.cos(t*2*Math.PI/200),0];const r=raw.update(input,t),s=smooth.update(input,t);if(t>=1000){a.push(r[1]);b.push(s[1]);}}
  const roughness=v=>v.slice(1).reduce((n,x,i)=>n+(x-v[i])**2,0);
  assert.ok(roughness(b)<roughness(a)*.15);
  assert.ok(b.some(v=>v>0));assert.ok(b.some(v=>v<0));
  smooth.reset();assert.deepEqual(smooth.velocity,[0,0,0]);assert.deepEqual(smooth.integratedVelocity,[0,0,0]);
});
