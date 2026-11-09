import {WitMotion} from '../lib/witmotion.js?v=20261103-3';
import {meanPose, calibrate, project, RepTracker} from '../lib/exercise.js?v=20261108-3';
import {LocalCamera} from '../lib/camera.js?v=20261108-3';
import {makePostcard} from '../lib/postcard.js?v=20261109-3';
const $ = id => document.getElementById(id);
const modes = {
  spread: {name:'กางมือจับออกข้าง', mission:'เปิดประตูสวน', icon:'🌱', axis:0, span:45},
  lift: {name:'ยกมือจับขึ้นแนวดิ่ง', mission:'ยกหยดน้ำ', icon:'💧', axis:1, span:40},
  twist: {name:'บิดข้อมือไปด้านหน้า', mission:'หมุนรับแสง', icon:'🌻', axis:2, span:35}
};
const labels = {await_home:'กลับจุดเริ่ม',ready:'พร้อมออกไป',outbound:'ไปถึงเป้า',target:'กลับจุดเริ่ม',returning:'กลับจุดเริ่ม'};
const arms = {};
let stage = 'idle', demo = false, demoTimer = null, demoPose = 'home';
let records = [], runStart = 0, accumulated = 0, session = null, completeAt = null;
const camera = new LocalCamera($('cameraPreview'));
let latestPhoto = null;
let completedScene = null;
let mergedImage = null, mergeGeneration = 0;
async function refreshPostcard() {
  const generation=++mergeGeneration; mergedImage=null;
  $('mergedPreview').hidden=true; $('downloadPostcard').disabled=true;
  document.querySelector('.photo-scene').classList.remove('has-merged');
  if(!completedScene || !latestPhoto) { $('mergeStatus').textContent='เล่นให้ครบเป้าหมายและถ่ายรูปก่อน จึงจะรวมเป็นภาพเดียวได้'; return; }
  $('mergeStatus').textContent='กำลังรวมภาพ…';
  try {
    if(document.fonts?.ready) await document.fonts.ready;
    const url=await makePostcard(completedScene,latestPhoto);
    if(generation!==mergeGeneration) return;
    mergedImage=url; $('mergedPreview').src=url; $('mergedPreview').hidden=false;
    document.querySelector('.photo-scene').classList.add('has-merged');
    $('downloadPostcard').disabled=false; $('mergeStatus').textContent='รวมเป็น PNG ภาพเดียวแล้ว พร้อมดาวน์โหลดและส่งต่อ';
  } catch(error) { if(generation===mergeGeneration) $('mergeStatus').textContent='รวมภาพไม่ได้: '+error.message; }
}
function saveCompletedScene() {
  if (!session || arms[session.leader].count < session.goal) return;
  // Freeze the actual game's rendered scene, including its mode, sprite styles
  // and earned flowers. No webcam frames, third-party renderer or upload.
  const scene = document.querySelector('#playPanel .garden').cloneNode(true);
  scene.removeAttribute('id');
  scene.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  scene.classList.add('completed-garden'); scene.setAttribute('aria-hidden','true');
  scene.querySelectorAll('.lane-state').forEach(node => { node.textContent = node.closest('.lane').dataset.side === session.leader ? 'ครบเป้าหมาย' : 'มือจับเคลื่อนตาม'; });
  $('completedBackdrop').replaceChildren(scene);
  $('completedBackdrop').hidden = false; $('completionEmpty').hidden = true;
  completedScene = {motion:session.motion,goal:session.goal,source:session.source,leader:session.leader,at:Date.now()};
  $('completionSummary').textContent = 'ฉากเมื่อครบเป้าหมาย · ' + modes[completedScene.motion].name + ' · ' + completedScene.goal + ' รอบ · ' + (completedScene.source === 'demo' ? 'ข้อมูลจำลอง' : 'ข้อมูล IMU') + ' · ' + new Date(completedScene.at).toLocaleTimeString();
  refreshPostcard();
}
const tabs = ['settings','play','photo'];
function snapshot(label, percent = null) {
  const photo = camera.snapshot();
  return photo ? {...photo,label,percent,mode:$('motion').value} : null;
}
function publishPhoto(photo) {
  if (!photo) return;
  latestPhoto = photo; $('poseImage').src = photo.url; $('poseImage').hidden = false; $('photoEmpty').hidden = true;
  $('photoCaption').textContent = photo.label + ' · ' + modes[photo.mode].name + ' · ' + new Date(photo.at).toLocaleTimeString() + (photo.percent === null ? '' : ' · ' + photo.percent.toFixed(0) + '% baseline');
  $('cameraStatus').textContent = 'เก็บภาพล่าสุดแล้ว กดดูภาพบนฉากเกมได้';
  refreshPostcard();
}
const selected = () => $('participants').value === 'both' ? ['left','right'] : [$('participants').value];
const leader = () => $('leader').value;
const now = () => performance.now();
const inSession = () => ['running','paused','finishing'].includes(stage);
const fresh = arm => (demo || arm.sensor.status === 'connected') && arm.frame && now() - arm.frame.monotonicMs <= 500;
const allFresh = () => selected().every(id => fresh(arms[id]));
const allCalibrated = () => selected().every(id => arms[id].cal);
const say = text => { $('notice').textContent = text; };
function showTab(page, focus = false) {
  if (page !== 'play') pause('พักการนับขณะเปิดหน้าตั้งค่าหรือภาพ กลับจุดเริ่มก่อนเริ่มต่อ');
  for (const name of tabs) {
    const selected = name === page, tab = $('tab-' + name);
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    $(name + 'Panel').hidden = !selected;
  }
  document.body.dataset.page = page;
  if (focus) $('tab-' + page).focus();
}
function addLog(arm, text) {
  arm.log.unshift(new Date().toLocaleTimeString() + '  ' + text);
  arm.el.log.textContent = arm.log.slice(0,30).join('\n');
}
function invalidate() {
  for (const arm of Object.values(arms)) { arm.home = null; arm.cal = null; arm.tracker.reset(); arm.peakPhoto = null; arm.photoPeak = 0; }
  $('calibration').textContent = 'บันทึกท่าเริ่มและท่าปลายสำหรับ baseline ของท่านี้';
  $('calibrationDetails').textContent = '';
}
function pause(reason = 'พักแล้ว กลับจุดเริ่มก่อนเริ่มต่อ') {
  if (stage !== 'running') return;
  accumulated += now() - runStart; stage = 'paused';
  Object.values(arms).forEach(arm => arm.tracker.reset());
  say(reason); updateControls();
}
function finish(reason = 'จบรอบฝึกแล้ว ดูสรุปหรือดาวน์โหลดข้อมูลได้') {
  if (stage === 'running') accumulated += now() - runStart;
  stage = 'finished'; Object.values(arms).forEach(arm => arm.tracker.reset());
  saveCompletedScene();
  say(reason); updateControls();
}
function updateControls() {
  const locked = inSession(), choosing = Object.values(arms).some(a => ['selecting','connecting'].includes(a.sensor.status));
  for (const [id, arm] of Object.entries(arms)) {
    arm.el.connect.disabled = locked || demo || choosing || arm.sensor.status !== 'disconnected' || !navigator.bluetooth || !isSecureContext;
    arm.el.disconnect.disabled = demo || arm.sensor.status === 'disconnected';
    arm.el.status.textContent = demo ? 'ข้อมูลจำลอง' : arm.sensor.status === 'connected' ? (fresh(arm) ? 'รับข้อมูลแล้ว' : 'รอข้อมูล') : arm.sensor.status;
    arm.metric.hidden = !selected().includes(id);
  }
  for (const id of ['motion','participants','leader','goal','targetPercent','homePercent']) $(id).disabled = locked;
  if ($('participants').value !== 'both') $('leader').disabled = true;
  $('demo').disabled = locked || Object.values(arms).some(a => a.sensor.status !== 'disconnected');
  $('demo').textContent = demo ? 'หยุดข้อมูลจำลอง' : 'ลองข้อมูลจำลอง';
  $('home').disabled = locked || !allFresh();
  $('target').disabled = locked || !allFresh() || !selected().every(id => arms[id].home);
  $('start').disabled = ['running','finishing'].includes(stage) || !allFresh() || !allCalibrated();
  $('start').textContent = stage === 'paused' ? 'เริ่มต่อ' : stage === 'finished' ? 'เริ่มรอบฝึกใหม่' : 'เริ่มปลูกสวน';
  $('startFromSettings').disabled = $('start').disabled;
  $('startFromSettings').textContent = stage === 'paused' ? 'กลับไปเล่นต่อ →' : stage === 'finished' ? 'เริ่มรอบฝึกใหม่ →' : 'เริ่มเกม →';
  $('pause').disabled = stage !== 'running'; $('finish').disabled = !locked;
  $('export').disabled = records.length === 0;
  $('endFromSettings').hidden = !locked;
  $('settingsHint').textContent = stage === 'paused' ? 'พักอยู่ กดกลับไปเล่นต่อ หรือจบรอบนี้เพื่อเปลี่ยนการตั้งค่าและ baseline' : 'เมื่อ baseline พร้อม กดเริ่มเกมเพื่อไปหน้าเล่น การเชื่อมต่อ IMU จะคงอยู่';
  $('cameraOpen').disabled = Boolean(camera.stream) || camera.opening;
  $('cameraStop').disabled = !camera.stream && !camera.opening;
  $('cameraCapture').disabled = $('playCapture').disabled = !camera.ready;
  for (const id of ['settingsPhoto','viewPhoto']) $(id).disabled = !latestPhoto && !completedScene;
  $('clearPhoto').disabled = !latestPhoto;
  $('source').textContent = demo ? 'ข้อมูลจำลอง · ไม่ใช่ค่าจริง' : Object.values(arms).some(a => a.sensor.status === 'connected') ? 'IMU สด' : 'ยังไม่เชื่อมต่อ';
}
function receive(id, frame) {
  if (frame.type !== 'motion') return;
  const arm = arms[id]; arm.frame = frame;
  arm.samples.push(frame); arm.samples = arm.samples.filter(f => frame.monotonicMs - f.monotonicMs <= 650);
  if (!['running','finishing'].includes(stage) || !selected().includes(id) || !arm.cal) return;
  if (stage === 'finishing' && id === session.leader) return;
  // Never score one side while any required stream has stopped.
  if (!allFresh()) { pause('ข้อมูลขาดช่วง พักการนับไว้ กลับจุดเริ่มแล้วกดเริ่มต่อเมื่อสัญญาณพร้อม'); return; }
  const progress = project(frame, arm.cal);
  const before = arm.tracker.state;
  const result = arm.tracker.update(progress, frame.monotonicMs);
  if (arm.tracker.state === 'await_home') { arm.peakPhoto = null; arm.photoPeak = 0; }
  if (id === session.leader && camera.ready) {
    if (progress >= arm.tracker.targetThreshold && progress > arm.photoPeak && ['outbound','target'].includes(arm.tracker.state)) {
      arm.peakPhoto = snapshot('จุดยืดสูงสุดที่กล้องเก็บได้ในรอบนี้',progress * 100); arm.photoPeak = progress;
    }
    if (before === 'target' && arm.tracker.state === 'returning') { publishPhoto(arm.peakPhoto); }
  }
  if (!result) return;
  arm.peakPhoto = null; arm.photoPeak = 0;
  const row = {...result, arm:id, rep:++arm.count, motion:session.motion,
    role:id === session.leader ? 'driver' : 'following_handle',
    source:session.source, timestamp:new Date().toISOString(),
    baseline_deg:Math.abs(arm.cal.span),
    angle_range_deg:result.peakProgress * Math.abs(arm.cal.span),
    baseline_percent:result.peakProgress * 100};
  records.push(row); arm.last = row; renderRow(row);
  if (id === session.leader) {
    $('flowers').textContent = '🌷'.repeat(Math.min(arm.count,30));
    if (arm.count >= session.goal) {
      // Allow the following handle's asynchronous final home confirmation to
      // arrive; never fabricate a matching count from the driver's event.
      accumulated += now() - runStart; completeAt = now(); stage = 'finishing';
    }
  }
}
function renderRow(row) {
  const tr = document.createElement('tr');
  for (const value of [row.arm === 'left' ? 'ซ้าย' : 'ขวา',row.rep,row.outbound_s.toFixed(2),row.return_s.toFixed(2),row.cycle_s.toFixed(2),row.angle_range_deg.toFixed(1),row.baseline_percent.toFixed(0)]) {
    const td = document.createElement('td'); td.textContent = value; tr.append(td);
  }
  $('rows').append(tr);
}
for (const [id, name] of [['left','ซ้าย'],['right','ขวา']]) {
  const card = document.createElement('div'); card.className = 'connection';
  card.innerHTML = '<h3>มือจับ' + name + '</h3><small data-el="status">ยังไม่เชื่อมต่อ</small><small data-el="device">เลือกเซนเซอร์ของฝั่งนี้</small><button data-el="connect">เชื่อมต่อ' + name + '</button><button data-el="disconnect" disabled>ตัดการเชื่อมต่อ</button><details><summary>บันทึกการเชื่อมต่อ</summary><pre data-el="log"></pre></details>';
  $('connections').append(card);
  const el = Object.fromEntries([...card.querySelectorAll('[data-el]')].map(node => [node.dataset.el,node]));
  const metric = document.createElement('article'); metric.className = 'panel metric ' + id;
  metric.innerHTML = '<h2>มือจับ' + name + ' <small data-metric="role"></small></h2><div class="metric-grid"><div><small>รอบที่เสร็จ</small><strong data-metric="count">0</strong></div><div><small>เวลารอบล่าสุด</small><strong data-metric="cycle">—</strong></div><div><small>ช่วงเคลื่อนรอบล่าสุด</small><strong data-metric="percent">—</strong></div><div><small>ระดับปัจจุบัน</small><strong data-metric="progress">—</strong></div></div><p class="range" data-metric="range">ยังไม่มี baseline</p><p class="hint" data-metric="phase"></p><details><summary>ค่าทิศทาง IMU ดิบ</summary><p data-metric="signed"></p></details>';
  $('metrics').append(metric);
  const values = Object.fromEntries([...metric.querySelectorAll('[data-metric]')].map(node => [node.dataset.metric,node]));
  const arm = {sensor:new WitMotion(),el,metric,values,frame:null,samples:[],home:null,cal:null,count:0,last:null,tracker:new RepTracker(),log:[],photoPeak:0,peakPhoto:null};
  arms[id] = arm;
  arm.sensor.addEventListener('data', ({detail}) => receive(id,detail));
  arm.sensor.addEventListener('status', ({detail}) => {
    addLog(arm,detail.state + (detail.message ? ': ' + detail.message : ''));
    if (detail.state === 'connected') el.device.textContent = detail.deviceName + ' · ID …' + (arm.sensor.device?.id || '').slice(-8);
    if (detail.state === 'disconnected') {
      pause('เซนเซอร์หลุด จบรอบนี้ก่อนเชื่อมต่อและบันทึก baseline ใหม่');
      arm.frame = null; arm.samples = []; arm.cal = null; arm.home = null;
    }
    updateControls();
  });
  arm.sensor.addEventListener('progress', ({detail}) => { addLog(arm,detail.message); el.status.textContent = detail.message; });
  for (const type of ['error','warning']) arm.sensor.addEventListener(type, ({detail}) => {
    const message = detail.message || String(detail);
    addLog(arm,message); el.device.textContent = message; card.querySelector('details').open = true;
  });
  el.connect.addEventListener('click', async () => {
    invalidate(); arm.frame = null; arm.samples = [];
    try { await arm.sensor.connect({allDevices:true,excludedDeviceIds:Object.values(arms).filter(a => a !== arm).map(a => a.sensor.device?.id).filter(Boolean)}); }
    catch (error) { el.device.textContent = error.message; }
    updateControls();
  });
  el.disconnect.addEventListener('click', () => arm.sensor.disconnect());
}
function changeSetup() {
  if ($('participants').value !== 'both') $('leader').value = $('participants').value;
  invalidate(); if (stage === 'finished') stage = 'idle';
  if (demo) { Object.values(arms).forEach(a => { a.samples = []; a.frame = null; }); demoPose = 'home'; }
  const mode = modes[$('motion').value];
  $('mission').textContent = 'ภารกิจ · ' + mode.mission;
  document.querySelector('.garden').dataset.motion = $('motion').value;
  for (const node of document.querySelectorAll('#playPanel .traveller')) node.textContent = mode.icon;
  updateControls();
}
$('motion').addEventListener('change',changeSetup);
$('participants').addEventListener('change',changeSetup);
$('leader').addEventListener('change',updateControls);
$('home').addEventListener('click', () => {
  if (!allFresh()) return;
  try {
    const poses = Object.fromEntries(selected().map(id => [id,meanPose(arms[id].samples.filter(f => now() - f.monotonicMs <= 600))]));
    invalidate(); selected().forEach(id => { arms[id].home = poses[id]; arms[id].samples = []; });
    $('calibration').textContent = 'บันทึก 0% แล้ว ขยับไปจุดปลายและค้างให้นิ่ง จากนั้นบันทึก 100%';
    if (demo) demoPose = 'target';
  } catch (error) { $('calibration').textContent = error.message; }
  updateControls();
});
$('target').addEventListener('click', () => {
  if (!allFresh()) return;
  try {
    const fitted = Object.fromEntries(selected().map(id => [id,calibrate(arms[id].home,meanPose(arms[id].samples.filter(f => now() - f.monotonicMs <= 600)))]));
    selected().forEach(id => { arms[id].cal = fitted[id]; });
    $('calibration').textContent = 'baseline พร้อมแล้ว กลับจุดเริ่ม แล้วกดเริ่มปลูกสวน';
    $('calibrationDetails').textContent = selected().map(id => (id === 'left' ? 'ซ้าย' : 'ขวา') + ': แกน ' + 'XYZ'[arms[id].cal.axis] + ' · baseline ' + Math.abs(arms[id].cal.span).toFixed(1) + '° = 100%').join(' / ');
    if (demo) demoPose = 'home';
    publishPhoto(snapshot('baseline ปลายท่า',100));
  } catch (error) { selected().forEach(id => { arms[id].cal = null; }); $('calibration').textContent = error.message; }
  updateControls();
});
$('start').addEventListener('click', () => {
  if (!allFresh() || !allCalibrated()) return;
  const goal = Number($('goal').value);
  if (!Number.isInteger(goal) || goal < 1 || goal > 30) { say('กำหนดจำนวนรอบเป็นจำนวนเต็ม 1–30'); return; }
  const target = Number($('targetPercent').value) / 100, home = Number($('homePercent').value) / 100;
  if (!Number.isFinite(target) || !Number.isFinite(home) || target < .5 || target > 1 || home < .05 || home > .4 || target <= home + .1) { say('ตรวจเกณฑ์: เป้า 50–100% และกลับ 5–40% โดยเป้าต้องมากกว่าจุดกลับอย่างน้อย 10%'); return; }
  if (stage !== 'paused') {
    records = []; $('rows').replaceChildren(); $('flowers').textContent = ''; accumulated = 0;
    for (const arm of Object.values(arms)) { arm.count = 0; arm.last = null; }
    session = {motion:$('motion').value,leader:leader(),goal,source:demo ? 'demo' : 'live'};
  }
  Object.values(arms).forEach(arm => { arm.tracker = new RepTracker({targetThreshold:target,homeThreshold:home,targetDwellMs:0}); arm.peakPhoto=null; arm.photoPeak=0; });
  runStart = now(); stage = 'running';
  showTab('play', true);
  say('กลับจุดเริ่มก่อน แล้วไปถึงเป้า ≥' + (target * 100).toFixed(0) + '% และกลับ ≤' + (home * 100).toFixed(0) + '% · ไม่ต้องค้างปลายท่า');
  updateControls();
});
$('pause').addEventListener('click', () => pause());
$('finish').addEventListener('click', () => finish());
$('startFromSettings').addEventListener('click', () => $('start').click());
$('backToSettings').addEventListener('click', () => showTab('settings', true));
$('endFromSettings').addEventListener('click', () => finish());
for (const page of tabs) {
  $('tab-' + page).addEventListener('click', () => showTab(page));
  $('tab-' + page).addEventListener('keydown', event => {
    if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const index = tabs.indexOf(page), direction = event.key === 'ArrowLeft' ? -1 : 1;
      showTab(event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + direction + tabs.length) % tabs.length], true);
    }
  });
}
$('cameraOpen').addEventListener('click', async () => {
  $('cameraStatus').textContent = 'กำลังขอเปิดกล้อง โปรดเลือกอนุญาตในเบราว์เซอร์';
  try { await camera.start(); $('cameraStatus').textContent = camera.stream ? 'กล้องเปิดแล้ว จัดภาพให้เห็นมือจับ แล้วถ่ายที่จุดยืดสุดได้' : 'ยกเลิกการเปิดกล้องแล้ว'; }
  catch (error) { $('cameraStatus').textContent = 'เปิดกล้องไม่ได้: ' + error.message; }
  updateControls();
});
$('cameraStop').addEventListener('click', () => { camera.stop(); $('cameraStatus').textContent = 'ปิดกล้องแล้ว ภาพล่าสุดยังอยู่ในหน้านี้'; updateControls(); });
for (const id of ['cameraCapture','playCapture']) $(id).addEventListener('click', () => {
  const arm = arms[leader()], percent = fresh(arm) && arm.cal ? Math.max(0,project(arm.frame,arm.cal) * 100) : null;
  publishPhoto(snapshot('ถ่ายด้วยปุ่ม',percent)); updateControls();
});
for (const id of ['settingsPhoto','viewPhoto']) $(id).addEventListener('click', () => showTab('photo',true));
$('photoBack').addEventListener('click', () => showTab('play',true));
$('clearPhoto').addEventListener('click', () => {
  latestPhoto = null; $('poseImage').removeAttribute('src'); $('poseImage').hidden = true; $('photoEmpty').hidden = false;
  $('photoCaption').textContent = 'นำภาพออกแล้ว ถ่ายภาพใหม่ได้จากตั้งค่าหรือหน้าเกม'; refreshPostcard(); updateControls();
});
$('downloadPostcard').addEventListener('click', () => {
  if(!mergedImage) return;
  const a=document.createElement('a');a.href=mergedImage;a.download='arm-booster-achievement.png';a.click();
});
$('demo').addEventListener('click', () => {
  if (demo) {
    clearInterval(demoTimer); demoTimer = null; demo = false;
    Object.values(arms).forEach(a => { a.frame = null; a.samples = []; a.el.device.textContent = 'เลือกเซนเซอร์ของฝั่งนี้'; });
    invalidate(); updateControls(); return;
  }
  demo = true; demoPose = 'home'; invalidate();
  Object.values(arms).forEach(a => { a.samples = []; a.frame = null; a.el.device.textContent = 'ข้อมูลจำลอง ไม่ใช่ข้อมูลเซนเซอร์จริง'; });
  $('calibration').textContent = 'ข้อมูลจำลองพร้อม บันทึกท่าเริ่มก่อน เกมจะเลื่อนไปท่าปลายให้บันทึก baseline';
  demoTimer = setInterval(() => {
    const t = now(), phase = ((t - runStart) / 1000) % 3.6;
    let p = demoPose === 'target' ? 1 : 0;
    if (stage === 'running') p = phase < .5 ? 0 : phase < 1.5 ? phase - .5 : phase < 2 ? 1 : phase < 3 ? 3 - phase : 0;
    const mode = modes[$('motion').value];
    for (const [id,arm] of Object.entries(arms)) {
      const span = mode.span * (id === 'right' ? -.9 : 1);
      const angles = id === 'left' ? [5,10,-5] : [-5,8,4]; angles[mode.axis] += span * p;
      receive(id,{type:'motion',angles,monotonicMs:t,receivedAt:Date.now()});
    }
  },100);
  updateControls();
});
$('export').addEventListener('click', () => {
  const keys = ['timestamp','source','motion','role','arm','rep','outbound_s','return_s','cycle_s','angle_range_deg','baseline_deg','baseline_percent'];
  const quote = value => '"' + String(value).replaceAll('"','""') + '"';
  const csv = '\ufeff' + [keys,...records.map(row => keys.map(key => row[key]))].map(row => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const a = document.createElement('a'); a.href = url; a.download = 'arm-booster-session.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});
setInterval(() => {
  if (stage === 'finishing' && now() - completeAt >= 500) finish('สวนสำเร็จแล้ว! แขนที่ขับกลไกเคลื่อนครบ ' + session.goal + ' รอบ');
  if (stage === 'running' && !allFresh()) pause('ข้อมูลขาดช่วง พักการนับไว้ กลับจุดเริ่มแล้วกดเริ่มต่อเมื่อสัญญาณพร้อม');
  const driver = arms[leader()];
  const visual = fresh(driver) && driver.cal ? Math.max(0,Math.min(1,project(driver.frame,driver.cal))) : 0;
  for (const [id,arm] of Object.entries(arms)) {
    const valid = fresh(arm), p = valid && arm.cal ? project(arm.frame,arm.cal) : null;
    arm.values.role.textContent = id === leader() ? '· ขับกลไก / นับรอบหลัก' : '· มือจับที่เคลื่อนตาม';
    arm.values.count.textContent = arm.count;
    arm.values.cycle.textContent = arm.last ? arm.last.cycle_s.toFixed(2) + ' s' : '—';
    arm.values.percent.textContent = arm.last ? arm.last.baseline_percent.toFixed(0) + '%' : '—';
    arm.values.progress.textContent = p === null ? '—' : Math.max(0,p * 100).toFixed(0) + '%';
    arm.values.signed.textContent = p === null ? '—' : 'ค่าดิบมีทิศทาง ' + (p * 100).toFixed(1) + '% (ค่าลบคือเลยท่าเริ่มไปอีกด้าน)';
    arm.values.phase.textContent = !valid ? 'รอข้อมูล IMU สด' : stage === 'running' ? labels[arm.tracker.state] + ' · เป้า ' + (arm.tracker.targetThreshold * 100).toFixed(0) + '% / กลับไม่เกิน ' + (arm.tracker.homeThreshold * 100).toFixed(0) + '%' : '';
    arm.values.range.textContent = arm.cal ? 'baseline ' + Math.abs(arm.cal.span).toFixed(1) + '° · รอบล่าสุด ' + (arm.last ? arm.last.angle_range_deg.toFixed(1) + '°' : '—') : 'ยังไม่มี baseline';
    const lane = document.querySelector('.lane[data-side="' + id + '"]');
    const traveller = lane.querySelector('.traveller'), motion = $('motion').value;
    traveller.style.left = motion === 'lift' || motion === 'twist' ? '50%' : (visual * 100) + '%';
    traveller.style.top = motion === 'lift' ? (100 - visual * 100) + '%' : '50%';
    traveller.style.transform = motion === 'twist' ? 'translate(-50%,-50%) rotate(' + (visual * 100 * (id === 'left' ? -1 : 1)) + 'deg)' : '';
    lane.querySelector('.lane-state').textContent = !selected().includes(id) ? 'ภาพสะท้อน' : !valid ? 'รอข้อมูล' : stage === 'running' ? labels[arm.tracker.state] : stage === 'paused' ? 'พัก' : arm.cal ? 'พร้อม' : 'สอนท่าก่อน';
  }
  const elapsed = accumulated + (stage === 'running' ? now() - runStart : 0);
  $('elapsed').textContent = 'เวลาฝึก ' + Math.floor(elapsed / 60000) + ':' + String(Math.floor(elapsed / 1000) % 60).padStart(2,'0');
  $('instruction').textContent = stage === 'finished' ? 'จบรอบฝึกแล้ว · ดูผลการเคลื่อนไหวด้านล่าง' : stage === 'paused' ? 'พักได้ แล้วกลับมาเริ่มที่จุดเริ่ม' : stage === 'running' ? labels[driver.tracker.state] + ' · ' + modes[$('motion').value].name : 'บันทึก baseline แล้วเริ่มปลูกสวน';
  const primary = records.filter(row => row.role === 'driver');
  $('summary').textContent = primary.length ? (primary[0].source === 'demo' ? '[ข้อมูลจำลอง] ' : '[ข้อมูล IMU] ') + modes[primary[0].motion].name + ' · แขนขับกลไก ' + primary.length + ' รอบ · เวลารอบเฉลี่ย ' + (primary.reduce((sum,row) => sum + row.cycle_s,0) / primary.length).toFixed(2) + ' วินาที · บันทึกทั้งสองฝั่งรวม ' + records.length + ' รายการ' : 'ยังไม่มีรอบที่เสร็จสมบูรณ์';
  updateControls();
},100);
$('support').textContent = navigator.bluetooth && isSecureContext ? 'ใช้ Chrome / Edge · เลือกทีละเซนเซอร์' : 'เบราว์เซอร์นี้ยังใช้ BLE ไม่ได้ ลองข้อมูลจำลอง หรือเปิด Chrome / Edge ผ่าน HTTPS / localhost';
document.addEventListener('visibilitychange', () => { if (document.hidden) pause('พักการนับเมื่อออกจากหน้า กลับมาจุดเริ่มก่อนเริ่มต่อ'); });
window.addEventListener('pagehide', () => { camera.stop(); clearInterval(demoTimer); Object.values(arms).forEach(a => a.sensor.disconnect()); });
changeSetup();
showTab('settings');
