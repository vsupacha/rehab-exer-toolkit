import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ThresholdInputState,applyThresholdPair,VelocityVisual,defaultVelocityAxis} from '../docs/lib/game-controls.js';
test('sideways velocity defaults Y and lifting defaults X',()=>{
  assert.equal(defaultVelocityAxis('spread'),'Y');assert.equal(defaultVelocityAxis('lift'),'X');
});
test('numeric draft survives sensor refresh and blur before Apply then remains manual',()=>{
  const setting=new ThresholdInputState();assert.equal(setting.display(12),'12');
  setting.edit('2.75');
  // Focus is deliberately irrelevant: a refresh between blur and click cannot
  // replace the pending input with an automatic sensor-derived threshold.
  for(const automatic of [11,12,18])assert.equal(setting.display(automatic),'2.75');
  assert.equal(setting.apply(),2.75);assert.equal(setting.display(25),'2.75');
  setting.edit('');assert.throws(()=>setting.apply());assert.equal(setting.value,2.75);
  setting.reset();assert.equal(setting.display(25),'25');
});
test('velocity visuals respond smoothly in both signs below scoring threshold and return neutral',()=>{
  const visual=new VelocityVisual();let p;
  for(let t=0;t<=500;t+=16)p=visual.update(.2,1,t,true);
  assert.ok(p>.5&&p<.95);
  for(let t=516;t<=1200;t+=16)p=visual.update(-.2,1,t,true);
  assert.ok(p<.5&&p>.05);
  for(let t=1216;t<=3000;t+=16)p=visual.update(10,1,t,false);
  assert.ok(Math.abs(p-.5)<.0001);
});
test('manual High/Low pair applies together without calibration and failed edit preserves both applied values',()=>{
  const high=new ThresholdInputState(),low=new ThresholdInputState();high.edit('3.25');low.edit('0.75');
  assert.deepEqual(applyThresholdPair(high,low,'1.5','0.5'),{high:3.25,low:.75});
  high.edit('0.4');low.edit('0.8');
  assert.throws(()=>applyThresholdPair(high,low,'3.25','.75'));
  assert.equal(high.value,3.25);assert.equal(low.value,.75);assert.equal(high.draft,'0.4');assert.equal(low.draft,'0.8');
  high.edit('2');assert.deepEqual(applyThresholdPair(high,low,'3.25','.75'),{high:2,low:.8});
});
test('manual pair rejects blank, non-finite and out-of-range numbers before committing',()=>{
  for(const [h,l] of [['','0.5'],['2',''],['Infinity','.5'],['2','NaN'],['1001','.5'],['2','0']]){
    const high=new ThresholdInputState(),low=new ThresholdInputState();
    assert.throws(()=>applyThresholdPair(high,low,h,l));assert.equal(high.value,null);assert.equal(low.value,null);
  }
});
