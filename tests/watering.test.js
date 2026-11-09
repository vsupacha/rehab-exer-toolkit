import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WateringVisual,PlantRewards,NOZZLE_PERIOD_MS} from '../docs/lib/watering.js';
test('nozzle moves dry, freezes to water at rest, and stops water when feedback is inactive',()=>{
  const visual=new WateringVisual();
  assert.equal(visual.update({time:0,active:false,state:'rest'}).watering,false);
  const moving=visual.update({time:100,active:true,state:'moving'});
  assert.equal(moving.watering,false);assert.equal(moving.moving,true);assert.notEqual(moving.position,.5);
  const rest=visual.update({time:200,active:true,state:'rest'});
  assert.equal(rest.position,moving.position);assert.equal(rest.watering,true);
  assert.equal(visual.update({time:300,active:true,state:'rest'}).position,rest.position);
  for(const state of ['rest','moving','unknown']){
    const stopped=visual.update({time:400,active:false,state});
    assert.equal(stopped.watering,false);assert.equal(stopped.moving,false);assert.equal(stopped.position,rest.position);
  }
});
test('nozzle sweep takes twice as long with unchanged range and resets for a new game',()=>{
  const visual=new WateringVisual();assert.equal(NOZZLE_PERIOD_MS,4400);
  let frame;for(let t=0;t<=1100;t+=100)frame=visual.update({time:t,active:true,state:'moving'});
  assert.ok(Math.abs(frame.position-.82)<1e-12);
  for(let t=1200;t<=3300;t+=100)frame=visual.update({time:t,active:true,state:'moving'});
  assert.ok(Math.abs(frame.position-.18)<1e-12);
  visual.reset();assert.equal(visual.position,.5);assert.equal(visual.phase,0);
});
test('watering earns the exact target once and leaves its fixed slot empty without shifting other plants',()=>{
  const rewards=new PlantRewards(),positions=rewards.plants.map(p=>p.position),plant=rewards.plants[1];
  const earned=rewards.update({position:plant.position,watering:true,moving:false});
  assert.equal(earned.id,plant.id);assert.equal(earned.emoji,plant.emoji);assert.equal(plant.collected,true);
  assert.deepEqual(rewards.plants.map(p=>p.position),positions);
  assert.equal(rewards.update({position:rewards.plants[2].position,watering:true,moving:false}),null);
  rewards.update({position:plant.position,moving:true,watering:false});
  assert.equal(rewards.update({position:plant.position,watering:true,moving:false}),null);
  assert.equal(rewards.earned.length,1);
  const next=rewards.update({position:rewards.plants[2].position,watering:true,moving:false});assert.equal(next.id,rewards.plants[2].id);
});
test('dry movement, inactive feedback and watering between plants earn nothing',()=>{
  const rewards=new PlantRewards();
  for(const feedback of [{position:.5,moving:true,watering:false},{position:.5,moving:false,watering:false},{position:0,moving:false,watering:true},{position:NaN,moving:false,watering:true}])assert.equal(rewards.update(feedback),null);
  assert.equal(rewards.earned.length,0);
});
test('cleared row stays empty until moving; next row supports larger goals without duplicate plant IDs',()=>{
  const rewards=new PlantRewards({goal:8});
  for(const plant of [...rewards.plants]){rewards.update({position:plant.position,moving:true,watering:false});rewards.update({position:plant.position,moving:false,watering:true});}
  assert.equal(rewards.row,1);assert.equal(rewards.earned.length,7);assert.ok(rewards.plants.every(p=>p.collected));
  rewards.update({position:.5,moving:false,watering:true});assert.equal(rewards.row,1);
  rewards.update({position:.5,moving:true,watering:false});assert.equal(rewards.row,2);
  const final=rewards.update({position:.5,moving:false,watering:true});assert.equal(final.id,7);assert.equal(rewards.complete,true);
  assert.equal(new Set(rewards.earned.map(p=>p.id)).size,8);
  rewards.update({position:.5,moving:true,watering:false});assert.equal(rewards.update({position:.5,moving:false,watering:true}),null);
});
