// Run from repository root: node tools/reproduce_velocity_failures.mjs
// Reproduces two known algorithm failures without BLE or personal input files.
import assert from 'node:assert/strict';
import {inspectMovement} from '../docs/lib/pattern.js';
import {velocityCalibration} from '../docs/lib/velocity.js';
const frames=Array.from({length:121},(_,i)=>({monotonicMs:i*100,acceleration:[0,.0003*Math.sin(i*.3),1]}));
const small=velocityCalibration(inspectMovement(frames,0,{reference:[0,0,1],accelerationDeadbandG:[.001,.001,.001]}),{axis:'Y'});
const smallAcceleration=Math.max(...small.training.map(s=>Math.abs(s.filtered[1])));
const smallVelocity=Math.max(...small.training.map(s=>Math.abs(s.velocity[1])));
assert.ok(smallAcceleration>0);assert.equal(smallVelocity,0);
const stationary=Array.from({length:121},(_,i)=>({monotonicMs:i*100,acceleration:[0,.006,1]}));
const biased=velocityCalibration(inspectMovement(stationary,0,{reference:[0,0,1],accelerationDeadbandG:[16/32768,16/32768,16/32768]}),{axis:'Y'});
const v=biased.training.map(s=>s.velocity[1]),peak=Math.max(...v);
assert.ok(peak>3);assert.ok(v.at(-1)<peak*.1);
console.log(JSON.stringify({status:'KNOWN FAILURES REPRODUCED; not hardware acceptance',
  erasedSignal:{filteredAccelerationPeak_g:smallAcceleration,estimatedVelocityPeak_cm_s:smallVelocity},
  artificialHump:{constantInput_g:.006,estimatedVelocityPeak_cm_s:peak,peakTime_s:biased.training[v.indexOf(peak)].elapsedMs/1000,endVelocity_cm_s:v.at(-1)}},null,2));
