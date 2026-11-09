import {test} from 'node:test';
import assert from 'node:assert/strict';
import {photoRect,makePostcard} from '../docs/lib/postcard.js';
test('landscape photo is 25% of scene width, centered with preserved ratio',()=>{
  const r=photoRect(1600,900,960,540);
  assert.equal(r.width,400);assert.equal(r.height,225);assert.equal(r.x,600);
});
test('portrait composition stays within scene and invalid sizes reject',()=>{
  const r=photoRect(1600,900,100,1000);assert.ok(r.height<=540);assert.ok(r.y>=0);
  assert.throws(()=>photoRect(1600,900,0,0));
});
test('compositor draws photo into scene and exports flattened PNG, with demo provenance',async()=>{
  const texts=[],draws=[];
  const c=new Proxy({createLinearGradient:()=>({addColorStop(){}}),fillText:t=>texts.push(t),drawImage:(...args)=>draws.push(args)}, {get:(target,key)=>target[key] ?? (()=>{})});
  const canvas={getContext:()=>c,toDataURL:type=>{assert.equal(type,'image/png');return 'data:image/png;base64,test';}};
  const result=await makePostcard({motion:'spread',goal:5,source:'demo',leader:'left',at:0},{url:'fixture'}, {canvasFactory:()=>canvas,imageLoader:async()=>({naturalWidth:960,naturalHeight:540})});
  assert.ok(result.startsWith('data:image/png'));assert.equal(draws.length,1);
  assert.ok(texts.some(text=>text.includes('ข้อมูลจำลอง')));assert.deepEqual([canvas.width,canvas.height],[1600,900]);
  await assert.rejects(makePostcard(null,null));
});
test('watering achievement image uses the actual plants collected as rewards',async()=>{
  const texts=[];
  const c=new Proxy({createLinearGradient:()=>({addColorStop(){}}),fillText:t=>texts.push(t)}, {get:(target,key)=>target[key]??(()=>{})});
  const canvas={getContext:()=>c,toDataURL:()=> 'data:image/png;base64,test'};
  await makePostcard({motion:'spread',goal:2,source:'live',leader:'left',at:0,plants:[{emoji:'🌵'},{emoji:'🌺'}]},{url:'fixture'},{canvasFactory:()=>canvas,imageLoader:async()=>({width:960,height:540})});
  assert.ok(texts.includes('🌵'));assert.ok(texts.includes('🌺'));assert.ok(!texts.includes('🌷'));assert.ok(texts.some(t=>t.includes('2 ต้นที่รดน้ำ')));
});
