import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareFilters} from '../tools/filter_experiments.mjs';
test('unfiltered trapezoid has correct units and all disabled filters yield identical paths',()=>{
  const samples=Array.from({length:11},(_,i)=>({timeMs:i*100,ayG:.01}));
  const result=compareFilters(samples,{referenceY:0,accelerationTauMs:0,velocityTauMs:0});
  const end=result.rows.at(-1);assert.ok(Math.abs(end.velocity_no_filter_cm_s-9.80665)<1e-10);
  for(const r of result.rows){assert.equal(r.velocity_acceleration_filter_only_cm_s,r.velocity_no_filter_cm_s);assert.equal(r.velocity_velocity_filter_only_cm_s,r.velocity_no_filter_cm_s);}
});
test('tiny signed input survives both isolated paths without a deadband',()=>{
  const samples=Array.from({length:121},(_,i)=>({timeMs:i*100,ayG:.0001*Math.sin(i*.3)}));
  const result=compareFilters(samples,{referenceY:0});
  assert.equal(result.deadband,false);assert.ok(result.rows.some(r=>Math.abs(r.velocity_acceleration_filter_only_cm_s)>.001));
  assert.ok(result.rows.some(r=>Math.abs(r.velocity_velocity_filter_only_cm_s)>.001));
});
test('reference changes affect both paths and invalid timestamps are rejected',()=>{
  const samples=Array.from({length:30},(_,i)=>({timeMs:i*100,ayG:.02}));
  const zero=compareFilters(samples),biased=compareFilters(samples,{referenceY:0});
  assert.ok(zero.rows.every(r=>Math.abs(r.velocity_no_filter_cm_s)<1e-10));
  assert.ok(biased.rows.at(-1).velocity_no_filter_cm_s>50);
  assert.throws(()=>compareFilters([samples[0],samples[0]]));
});
