import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlopeTracker,slopeConfig,inspectSlope,learnSlope} from '../docs/lib/slope.js';
import {WateringVisual,PlantRewards} from '../docs/lib/watering.js';
const cal=()=>slopeConfig({usable:true},{high:1.5,low:.5});
test('Start and Resume move immediately without stationary calibration and water only after valid Low hold',()=>{
  const tracker=new SlopeTracker(slopeConfig({usable:true}));
  assert.equal(tracker.threshold,200);assert.equal(tracker.lowThreshold,50);
  for(const start of [0,3000]){
    tracker.startMoving(start);const visual=new WateringVisual(),rewards=new PlantRewards();
    assert.equal(tracker.state,'moving');assert.equal(tracker.ready,false);
    let result;
    for(let i=0;i<=11;i++){
      const time=start+i*100;result=tracker.update({monotonicMs:time,acceleration:[0,.04,1]});
      const feedback=visual.update({time,active:tracker.ready||tracker.state==='moving',state:tracker.state});
      rewards.update(feedback);
      if(i<11){assert.equal(tracker.state,'moving');assert.equal(feedback.watering,false);assert.equal(rewards.earned.length,0);}
    }
    assert.equal(tracker.state,'rest');assert.equal(rewards.earned.length,1);
    assert.equal(result.initial_movement_assumed,true);assert.equal(result.movement_s,1.1);
  }
});
test('EMA+10point slope rejects constant offset without deadband or velocity integration',()=>{
  const tracker=new SlopeTracker(cal());
  for(let t=0;t<=30000;t+=100){assert.equal(tracker.update({monotonicMs:t,acceleration:[-.2,.04,1]}),null);if(t>=900)assert.ok(Math.abs(tracker.signed)<1e-10);}
  assert.equal(tracker.state,'rest');assert.equal(tracker.fsm.count,0);
});
test('first9 samples unavailable, duplicate receipts ignored, gap clears partial slope',()=>{
  const tracker=new SlopeTracker(cal());
  for(let i=0;i<9;i++)tracker.update({monotonicMs:i*100,acceleration:[0,.01*i,1]});
  assert.equal(tracker.ready,false);tracker.update({monotonicMs:900,acceleration:[0,.09,1]});assert.equal(tracker.ready,true);
  assert.equal(tracker.window.length,10);
  const before=tracker.signed;tracker.update({monotonicMs:900,acceleration:[0,5,1]});assert.equal(tracker.signed,before);
  tracker.update({monotonicMs:1000,acceleration:[0,.1,1]});assert.equal(tracker.window.length,10);assert.equal(tracker.window[0].time,100);
  tracker.update({monotonicMs:1700,acceleration:[0,.1,1]});assert.equal(tracker.ready,false);assert.equal(tracker.state,'rest');
});
test('EMA50ms follows a step faster than EMA100ms using actual receipt intervals',()=>{
  const tracker=new SlopeTracker(cal());
  tracker.update({monotonicMs:0,acceleration:[0,0,1]});
  tracker.update({monotonicMs:100,acceleration:[0,1,1]});
  assert.ok(Math.abs(tracker.filtered[1]-(1-Math.exp(-2)))<1e-12);
  assert.ok(tracker.filtered[1]>1-Math.exp(-1));
  tracker.update({monotonicMs:125,acceleration:[0,1,1]});
  assert.ok(Math.abs(tracker.filtered[1]-(1-Math.exp(-2.5)))<1e-12);
  assert.equal(tracker.ready,false);
});
test('fixed X and reversed Y use correct slope; Cal requires full30s',()=>{
  const frames=Array.from({length:301},(_,i)=>({monotonicMs:i*100,acceleration:[.003*i/10,.001*i/10,1]}));
  const x=inspectSlope(frames,0,{axis:'X'}),y=inspectSlope(frames,0,{axis:'Y',reverse:true});
  assert.ok(Math.abs(x.training.at(-1).signed-3)<1e-6);assert.ok(Math.abs(y.training.at(-1).signed+1)<1e-6);
  assert.throws(()=>learnSlope(frames.slice(0,121),0),/30/);assert.equal(learnSlope(frames,0).usable,true);
});
test('Cal preview reports FSM state and count; invalid thresholds cannot enter tracker',()=>{
  const frames=Array.from({length:301},(_,i)=>{const p=(i/10)%7;return {monotonicMs:i*100,acceleration:[0,.04+(p<1?0:p<2.5?-.015*(p-1):p<3?-.0225:p<4.5?-.0225+.015*(p-3):0),1]};});
  const result=learnSlope(frames,0,{high:1.5,low:.5});
  assert.equal(result.count,4);assert.equal(result.state,'moving');
  for(const options of [{high:Infinity},{low:NaN},{high:.3,low:.5}])assert.throws(()=>slopeConfig({usable:true},options));
});
test('streaming one-way acceleration trend followed by rest records one timed bout for either mount sign',()=>{
  for(const reverse of [false,true]){
    const tracker=new SlopeTracker(slopeConfig({usable:true},{reverse,high:1.5,low:.5})),records=[];
    for(let i=0;i<80;i++){
      const result=tracker.update({monotonicMs:i*100,acceleration:[0,.04+.002*Math.max(0,Math.min(10,i-20)),1]});
      if(result)records.push(result);
    }
    assert.equal(records.length,1);assert.equal(tracker.state,'rest');
    assert.equal(records[0].measurement,'slope_activity_bout');assert.ok(records[0].movement_s>1);
    assert.equal(records[0].outbound_s,undefined);assert.equal(records[0].return_s,undefined);
    assert.ok(records[0].peak_slope_mg_s>1.5);
  }
});
test('live threshold edit takes effect, cancels only the open bout and retains EMA/window/completed count',()=>{
  const tracker=new SlopeTracker(cal()),records=[];
  for(let i=0;i<80;i++){
    const result=tracker.update({monotonicMs:i*100,acceleration:[0,.04+.002*Math.max(0,Math.min(10,i-20)),1]});if(result)records.push(result);
  }
  assert.equal(records.length,1);
  for(let i=80;i<=100;i++)tracker.update({monotonicMs:i*100,acceleration:[0,.06+.002*(i-80),1]});
  assert.equal(tracker.state,'moving');
  const window=tracker.window,filtered=tracker.filtered,signed=tracker.signed;
  tracker.setThresholds({high:100,low:2});
  assert.equal(tracker.window,window);assert.equal(tracker.filtered,filtered);assert.equal(tracker.signed,signed);assert.equal(tracker.ready,true);
  assert.equal(tracker.started,null);assert.equal(tracker.state,'rest');assert.equal(tracker.fsm.count,1);
  const fsm=tracker.fsm;assert.throws(()=>tracker.setThresholds({high:.2,low:1}));assert.equal(tracker.fsm,fsm);
  for(let i=101;i<150;i++){const result=tracker.update({monotonicMs:i*100,acceleration:[0,.1,1]});if(result)records.push(result);}
  assert.equal(records.length,1);assert.equal(tracker.fsm.count,1);assert.equal(tracker.threshold,100);assert.equal(tracker.lowThreshold,2);
});
