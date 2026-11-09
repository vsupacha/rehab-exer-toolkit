import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalCamera} from '../docs/lib/camera.js';

function fixture(getUserMedia) {
  let stopped=0, drawn=0;
  const track={readyState:'live',stop:()=>{stopped++;track.readyState='ended';}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const video={readyState:2,videoWidth:1920,videoHeight:1080,play:async()=>{},srcObject:null};
  const canvas={getContext:()=>({drawImage:()=>drawn++}),toDataURL:()=>'data:image/jpeg;base64,fixture'};
  const camera=new LocalCamera(video,{mediaDevices:{getUserMedia:getUserMedia || (async options=>{assert.equal(options.audio,false);return stream;})},canvasFactory:()=>canvas});
  return {camera,stream,video,canvas,stopped:()=>stopped,drawn:()=>drawn};
}
test('camera opens only on explicit start, captures proportional full frame, then stops tracks',async()=>{
  const f=fixture(); assert.equal(f.camera.snapshot(),null); assert.equal(f.video.srcObject,null);
  await f.camera.start(); assert.equal(f.video.srcObject,f.stream);
  const shot=f.camera.snapshot(); assert.ok(shot.url.startsWith('data:image/jpeg'));
  assert.deepEqual([shot.width,shot.height],[960,540]); assert.equal(f.drawn(),1);
  f.camera.stop(); assert.equal(f.stopped(),1); assert.equal(f.video.srcObject,null); assert.equal(f.camera.snapshot(),null);
});
test('permission rejection clears opening state and never attaches a stream',async()=>{
  const f=fixture(async()=>{throw new Error('Permission denied');});
  await assert.rejects(f.camera.start(),/Permission denied/);
  assert.equal(f.camera.opening,false); assert.equal(f.camera.ready,false);
});
test('stopping while permission is pending closes a late-arriving stream',async()=>{
  let resolve; const f=fixture(()=>new Promise(r=>{resolve=r;}));
  const pending=f.camera.start(); f.camera.stop(); resolve(f.stream); await pending;
  assert.equal(f.stopped(),1); assert.equal(f.video.srcObject,null); assert.equal(f.camera.ready,false);
});
