import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawYVelocity} from '../docs/lib/trace.js';
test('dedicated Y plot has signed units and a single Y curve with explicit thresholds',()=>{
  const labels=[],widths=[];
  const c={clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){widths.push(this.lineWidth);},fillText(t){labels.push(t);},setLineDash(){}};
  drawYVelocity({width:1400,height:420,getContext:()=>c},[{elapsedMs:0,y:-2},{elapsedMs:100,y:2}],1);
  assert.ok(labels.some(t=>t.includes('Vy')));assert.ok(labels.some(t=>t.includes('cm/s')));
  assert.equal(labels.filter(t=>t==='X'||t==='Z'||t==='RMS').length,0);
  assert.ok(widths.includes(3));
});
