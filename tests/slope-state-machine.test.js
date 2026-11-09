import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlopeStateMachine} from '../tools/slope_state_machine.mjs';
function hold(machine,value,start,duration){const events=[];for(let t=start;t<=start+duration;t+=50){const event=machine.update(value,t);if(event)events.push(event);}return events;}
test('new defaults use High200 and Low50 for motion and stop confirmation',()=>{
  const m=new SlopeStateMachine();assert.equal(m.high,200);assert.equal(m.low,50);
  hold(m,100,0,300);assert.equal(m.state,'rest');
  hold(m,-250,350,300);assert.equal(m.state,'moving');
  hold(m,80,700,300);assert.equal(m.state,'moving');
  hold(m,40,1050,300);assert.equal(m.state,'rest');assert.equal(m.count,1);
});
test('rest -> moving -> rest counts either sign without requiring a reversal',()=>{
  for(const sign of [-1,1]){
    const m=new SlopeStateMachine({high:1.5,low:.5});hold(m,0,0,200);hold(m,2*sign,250,250);assert.equal(m.state,'moving');
    hold(m,.9*sign,550,300);assert.equal(m.state,'moving');assert.equal(m.count,0);
    const events=hold(m,0,900,300);assert.equal(m.state,'rest');assert.equal(m.count,1);
    assert.equal(events[0].time_ms,1100);assert.equal(events[0].completed,true);
    hold(m,0,1250,1000);assert.equal(m.count,1);
  }
});
test('brief High spikes and interrupted Low holds do not complete a bout; dropout discards it',()=>{
  const m=new SlopeStateMachine({high:1.5,low:.5});hold(m,2,0,100);hold(m,0,150,200);assert.equal(m.state,'rest');assert.equal(m.count,0);
  hold(m,-2,400,250);assert.equal(m.state,'moving');
  hold(m,0,700,150);hold(m,.8,900,50);assert.equal(m.state,'moving');assert.equal(m.count,0);
  m.update(0,1600);assert.equal(m.state,'rest');assert.equal(m.count,0);
  hold(m,0,1650,300);assert.equal(m.count,0);
});
test('sign changes and short zero crossing remain a single bout until sustained Low',()=>{
  const m=new SlopeStateMachine({high:1.5,low:.5});hold(m,2,0,300);hold(m,0,350,100);hold(m,-2,500,300);
  assert.equal(m.state,'moving');assert.equal(m.count,0);
  hold(m,0,850,300);assert.equal(m.count,1);
  assert.throws(()=>new SlopeStateMachine({high:.5,low:1}));
});
