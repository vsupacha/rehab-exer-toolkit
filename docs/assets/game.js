import {SlopeTracker,inspectSlope,learnSlope,slopeConfig} from '../lib/slope.js?v=20261109-30';
import {ThresholdInputState,applyThresholdPair,defaultVelocityAxis} from '../lib/game-controls.js?v=20261109-30';
import {WateringVisual,PlantRewards} from '../lib/watering.js?v=20261109-31';
import {stationaryProfile} from '../lib/zero.js?v=20261109-21';
import {drawSlope} from '../lib/trace.js?v=20261109-27';
import {WitMotion} from '../lib/witmotion.js?v=20261109-21';
import {meanPose, calibrate, project, RepTracker} from '../lib/exercise.js?v=20261108-3';
import {LocalCamera} from '../lib/camera.js?v=20261108-3';
import {makePostcard} from '../lib/postcard.js?v=20261109-31';
const $ = id => document.getElementById(id);
const modes = {
  spread: {name:'กางมือจับออกข้าง', mission:'เปิดประตูสวน', icon:'🌱', axis:0, span:45},
  lift: {name:'ยกมือจับขึ้นแนวดิ่ง', mission:'ยกหยดน้ำ', icon:'💧', axis:1, span:40},
  twist: {name:'บิดข้อมือไปด้านหน้า', mission:'หมุนรับแสง', icon:'🌻', axis:2, span:35}
};
const activityMode = () => ['spread','lift'].includes($('motion').value);
const activityLabels = {rest:'พัก',moving:'เคลื่อน'};
const phaseLabel = arm => activityMode() ? activityLabels[arm.tracker.state] || 'รอเริ่ม' : labels[arm.tracker.state];
const labels = {await_home:'กลับจุดเริ่ม',ready:'พร้อมออกไป',outbound:'ไปถึงเป้า',target:'กลับจุดเริ่ม',returning:'กลับจุดเริ่ม'};
const arms = {};
let rateChanging=false;
let zeroing = null;
const thresholdSetting = new ThresholdInputState();
const lowThresholdSetting = new ThresholdInputState();
function resetSlopeThresholds(){thresholdSetting.reset();lowThresholdSetting.reset();}
let teaching = null, lastTeaching = null, lastPlot = -Infinity;
let calPreview = null;
let stage = 'idle', demo = false, demoTimer = null, demoPose = 'home';
let records = [], runStart = 0, accumulated = 0, session = null, completeAt = null;
const wateringVisual=new WateringVisual();
let plantRewards=new PlantRewards();
function renderPlants(){
  $('plantBed').replaceChildren();
  for(const plant of plantRewards.plants){
    const slot=document.createElement('span');slot.className='plant-slot'+(plant.collected?' is-collected':'');slot.dataset.plantId=String(plant.id);slot.style.left=(plant.position*100)+'%';slot.title=plant.collected?'เก็บแล้ว':plant.name;
    if(!plant.collected)slot.textContent=plant.emoji;
    $('plantBed').append(slot);
  }
  $('flowers').replaceChildren();
  const label=document.createElement('span');label.className='reward-label';label.textContent='ได้แล้ว '+plantRewards.earned.length+' ต้น';$('flowers').append(label);
  for(const plant of plantRewards.earned){const reward=document.createElement('span');reward.textContent=plant.emoji;reward.title=plant.name;$('flowers').append(reward);}
}
function resetPlants(goal=Number($('goal').value)){
  if(!Number.isInteger(goal)||goal<1||goal>30)return;
  plantRewards=new PlantRewards({goal});wateringVisual.reset();renderPlants();
}
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
  if (!session || (session.motion!=='twist'?plantRewards.earned.length:arms[session.leader].count) < session.goal) return;
  // Freeze the actual game's rendered scene, including its mode, sprite styles
  // and earned flowers. No webcam frames, third-party renderer or upload.
  const scene = document.querySelector('#playPanel .garden').cloneNode(true);
  scene.removeAttribute('id');
  scene.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  scene.classList.add('completed-garden'); scene.setAttribute('aria-hidden','true');
  scene.querySelectorAll('.lane-state').forEach(node => { node.textContent = node.closest('.lane').dataset.side === session.leader ? 'ครบเป้าหมาย' : 'มือจับเคลื่อนตาม'; });
  $('completedBackdrop').replaceChildren(scene);
  $('completedBackdrop').hidden = false; $('completionEmpty').hidden = true;
  completedScene = {motion:session.motion,goal:session.goal,source:session.source,leader:session.leader,at:Date.now(),measurement:session.motion!=='twist'?'acceleration_activity':'angular_cycle',plants:session.motion!=='twist'?plantRewards.earned.map(p=>({...p})):undefined};
  $('completionSummary').textContent = 'ฉากเมื่อครบเป้าหมาย · ' + modes[completedScene.motion].name + ' · ' + completedScene.goal + (session.motion!=='twist' ? ' ต้นที่รดน้ำ · ' : ' รอบ · ') + (completedScene.source === 'demo' ? 'ข้อมูลจำลอง' : 'ข้อมูล IMU') + ' · ' + new Date(completedScene.at).toLocaleTimeString();
  refreshPostcard();
}
const tabs = ['settings','calibration','play','photo'];
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
const inSession = () => ['zeroing','running','paused','finishing'].includes(stage);
const fresh = arm => (demo || arm.sensor.status === 'connected') && arm.frame && now() - arm.frame.monotonicMs <= 500;
const allFresh = () => selected().every(id => fresh(arms[id]));
const sensitivity = () => Number($('sensitivity').value);
const slopeOptions=()=>({axis:$('velocityAxis').value,reverse:$('reverseVelocity').checked,high:thresholdSetting.value??1.5/sensitivity(),low:lowThresholdSetting.value??.5/sensitivity()});
const tuned = cal => slopeConfig(cal,slopeOptions());
const allCalibrated = () => activityMode() || selected().every(id => arms[id].cal);
const say = text => { $('notice').textContent = text; };
function showTab(page, focus = false) {
  if(activityMode()&&page==='calibration')page='play';
  if (page !== 'play') pause('พักการนับขณะเปิดหน้าตั้งค่าหรือภาพ กลับจุดเริ่มก่อนเริ่มต่อ');
  for (const name of tabs) {
    const selected = name === page, tab = $('tab-' + name);
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    $(name + 'Panel').hidden = !selected;
  }
  document.body.dataset.page = page;
  if (focus) $('tab-' + page).focus({preventScroll:true});
  window.scrollTo(0,0);
}
function addLog(arm, text) {
  arm.log.unshift(new Date().toLocaleTimeString() + '  ' + text);
  arm.el.log.textContent = arm.log.slice(0,30).join('\n');
}
function invalidate() {
  if(!activityMode())resetSlopeThresholds();
  teaching=lastTeaching=calPreview=null;
  for (const arm of Object.values(arms)) { arm.home = null; arm.cal = activityMode()?tuned({usable:true}):null; arm.tracker=activityMode()?new SlopeTracker(arm.cal):new RepTracker(); arm.peakPhoto = null; arm.photoPeak = 0; }
  $('calibration').textContent = 'บันทึกท่าเริ่มและท่าปลายสำหรับ baseline ของท่านี้';
  $('calibrationDetails').textContent = '';
}
function pause(reason = 'พักแล้ว กลับจุดเริ่มก่อนเริ่มต่อ') {
  if (!['running','zeroing'].includes(stage)) return;
  if(stage==='running')accumulated += now() - runStart;
  zeroing=null;stage = 'paused';
  Object.values(arms).forEach(arm => arm.tracker.reset());
  say(reason); updateControls();
}
function finish(reason = 'จบรอบฝึกแล้ว ดูสรุปหรือดาวน์โหลดข้อมูลได้') {
  if (stage === 'running') accumulated += now() - runStart;
  zeroing=null;stage = 'finished'; Object.values(arms).forEach(arm => arm.tracker.reset());
  saveCompletedScene();
  say(reason); updateControls();
}
function updateControls() {
  $('tab-calibration').hidden=activityMode();
  $('tab-play').textContent=activityMode()?'② เล่นเกม':'③ เล่นเกม';
  $('tab-photo').textContent=activityMode()?'③ ภาพบนฉากเกม':'④ ภาพบนฉากเกม';
  $('goCalibration').textContent=activityMode()?'ถัดไป · เกม / High–Low →':'ถัดไป · Cal / กราฟ →';
  $('connectionNextHint').textContent=activityMode()?'เชื่อมต่อแล้ว ไปตั้ง High / Low และเริ่มเกมได้เลย':'เชื่อมต่อแล้ว บันทึก baseline ก่อนเริ่ม';
  $('backToSettings').textContent=activityMode()?'การเชื่อมต่อ / เลือกท่า':'กลับไป Cal / กราฟ';
  $('activityStatus').hidden=!activityMode();
  $('goalLabel').textContent=activityMode()?'เป้าหมาย (ต้นไม้ที่รดน้ำ)':'เป้าหมาย (รอบไป–กลับ)';
  $('heroHint').textContent=activityMode()?'หยุดรดต้นไหน เก็บต้นนั้น · เลื่อนฝักบัวไปหาต้นที่ยังเหลือ':'ออกไปถึงเป้าหมาย แล้วกลับจุดเริ่มต้น เพิ่มดอกไม้หนึ่งดอก';
  $('playSignalHint').textContent=activityMode()?'เลื่อนไปหาต้นไม้ แล้วหยุดรดเพื่อเก็บต้นนั้น · ช่องที่เก็บแล้วไม่ได้รางวัลซ้ำ':'ตัวละครแสดงช่วงมุมเทียบ baseline';
  document.querySelector('#playPanel .garden').dataset.measurement=activityMode()?'activity':'angle';
  $('angularRecordHint').hidden=activityMode();
  const locked = inSession() || Boolean(teaching), choosing = Object.values(arms).some(a => ['selecting','connecting'].includes(a.sensor.status));
  for (const [id, arm] of Object.entries(arms)) {
    arm.el.connect.disabled = locked || demo || choosing || arm.sensor.status !== 'disconnected' || !navigator.bluetooth || !isSecureContext;
    arm.el.disconnect.disabled = demo || arm.sensor.status === 'disconnected';
    arm.el.status.textContent = demo ? 'ข้อมูลจำลอง' : arm.sensor.status === 'connected' ? (fresh(arm) ? 'รับข้อมูลแล้ว' : 'รอข้อมูล') : arm.sensor.status;
    arm.metric.hidden = !selected().includes(id);
    arm.el.connect.closest('.connection').hidden=!selected().includes(id);
  }
  for (const id of ['motion','participants','leader','goal','targetPercent','homePercent','sensorPrefix','showAllDevices','velocityAxis','reverseVelocity']) $(id).disabled = locked;
  if ($('participants').value !== 'both') $('leader').disabled = true;
  $('demo').disabled = locked || Object.values(arms).some(a => a.sensor.status !== 'disconnected');
  $('demo').textContent = demo ? 'หยุดข้อมูลจำลอง' : 'ลองข้อมูลจำลอง';
  $('home').disabled = locked || !allFresh();
  $('home').textContent = activityMode() ? 'Cal: พัก → เคลื่อน → พัก · 30 วินาที' : '① บันทึกท่าเริ่ม · 0%';
  $('target').hidden = activityMode();
  $('accelerationSettings').hidden = !activityMode();
  $('velocityControls').hidden=!activityMode();
  const thresholdEditable=activityMode();
  $('accelThreshold').disabled=$('slopeLow').disabled=!thresholdEditable;
  if(activityMode()&&arms[leader()]?.cal?.axis){const text=lowThresholdSetting.display(tuned(arms[leader()].cal).low);if($('slopeLow').value!==text)$('slopeLow').value=text;}
  $('applyThreshold').disabled=$('autoThreshold').disabled=!thresholdEditable;
  $('thresholdHint').textContent=thresholdSetting.draft!==null||lowThresholdSetting.draft!==null?'ค่าที่กรอกยังไม่ใช้ · กดใช้ค่า หรือ Enter':(thresholdSetting.value===null?'ค่าเริ่มต้น ':'ใช้แล้ว: ')+'High '+slopeOptions().high+' / Low '+slopeOptions().low+' mg/s';
  $('recordNoise').disabled=locked || !allFresh();
  $('setRate10').disabled=$('setRate50').disabled=rateChanging || locked || demo || !selected().every(id=>arms[id].sensor.status==='connected'&&arms[id].sensor.writer);
  $('sensitivity').disabled=Boolean(teaching)||inSession()||thresholdSetting.value!==null;
  $('sensitivityValue').textContent=sensitivity().toFixed(2)+'×';
  if(activityMode() && arms[leader()]?.cal?.axis) {const display=thresholdSetting.display(tuned(arms[leader()].cal).threshold.toFixed(6));if($('accelThreshold').value!==display)$('accelThreshold').value=display;}
  $('exportTeaching').disabled=!lastTeaching && !teaching;
  $('angleSettings').hidden = activityMode();
  $('baselineTitle').textContent = activityMode() ? '3 · ตั้งค่าตรวจการเคลื่อนไหว' : '3 · บันทึก baseline ครั้งแรก';
  $('baselineHint').textContent = activityMode() ? 'Cal 30 วินาที เริ่มจากพัก ทำเคลื่อน → พักซ้ำ ระบบใช้ EMA 50 ms และ slope 10 จุด ไม่คำนวณความเร็ว' : 'ค้างจุดเริ่มและจุดปลายนิ่งประมาณ 1 วินาที แล้วบันทึก 0% และ 100%';
  $('target').disabled = locked || !allFresh() || !selected().every(id => arms[id].home);
  $('start').disabled = ['zeroing','running','finishing'].includes(stage) || !allFresh() || !allCalibrated() || Boolean(teaching);
  $('start').textContent = stage === 'paused' ? 'เริ่มต่อ' : stage === 'finished' ? 'เริ่มรอบฝึกใหม่' : 'เริ่มปลูกสวน';
  $('startFromSettings').disabled = $('start').disabled;
  $('startFromSettings').textContent = activityMode() ? 'ไปหน้าเล่น / ปรับ threshold →' : stage === 'paused' ? 'กลับไปเล่นต่อ →' : stage === 'finished' ? 'เริ่มรอบฝึกใหม่ →' : 'เริ่มเกม →';
  $('pause').disabled = !['running','zeroing'].includes(stage); $('finish').disabled = !locked;
  $('export').disabled = records.length === 0;
  $('endFromSettings').hidden = !inSession();
  $('settingsHint').textContent = activityMode() ? 'ตั้ง High / Low ในหน้าเล่นได้เลย ไม่ต้อง Cal' : stage === 'paused' ? 'พักอยู่ กลับไปเล่นต่อหรือจบรอบนี้เพื่อตั้งค่า' : 'เมื่อ baseline พร้อม กดเริ่มเกมเพื่อไปหน้าเล่น';
  $('angularHelp').hidden=activityMode();
  $('cameraOpen').disabled = Boolean(camera.stream) || camera.opening;
  $('cameraStop').disabled = !camera.stream && !camera.opening;
  $('cameraCapture').disabled = $('playCapture').disabled = !camera.ready;
  for (const id of ['settingsPhoto','viewPhoto']) $(id).disabled = !latestPhoto && !completedScene;
  $('clearPhoto').disabled = !latestPhoto;
  $('source').textContent = demo ? 'ข้อมูลจำลอง · ไม่ใช่ค่าจริง' : Object.values(arms).some(a => a.sensor.status === 'connected') ? 'IMU สด' : 'ยังไม่เชื่อมต่อ';
}
function sampleLiveVelocity(arm,frame){arm.liveVelocity.push({time:frame.monotonicMs,slopes:arm.tracker.slopes&&[...arm.tracker.slopes],signed:arm.tracker.ready?arm.tracker.signed:null});arm.liveVelocity=arm.liveVelocity.filter(s=>frame.monotonicMs-s.time<=8000);}
function receive(id, frame) {
  if (frame.type !== 'motion') return;
  const arm = arms[id];arm.timing??={last:null,maxGap:0,duplicates:0};if(arm.timing.last!==null){const gap=frame.monotonicMs-arm.timing.last;arm.timing.maxGap=Math.max(arm.timing.maxGap,gap);if(gap===0)arm.timing.duplicates++;}arm.timing.last=frame.monotonicMs;arm.frame = frame;
  if(teaching && teaching.ids.includes(id)) teaching.frames[id].push(frame);
  arm.samples.push(frame); arm.samples = arm.samples.filter(f => frame.monotonicMs - f.monotonicMs <= 650);
  if(stage==='zeroing'){if(zeroing?.frames[id])zeroing.frames[id].push(frame);return;}
  if(activityMode() && arm.cal && !['running','finishing'].includes(stage)){arm.tracker.update(frame);sampleLiveVelocity(arm,frame);}
  if (!['running','finishing'].includes(stage) || !selected().includes(id) || !arm.cal) return;
  if (stage === 'finishing' && id === session.leader) return;
  // Never score one side while any required stream has stopped.
  if (!allFresh()) { pause('ข้อมูลขาดช่วง พักการนับไว้ กลับจุดเริ่มแล้วกดเริ่มต่อเมื่อสัญญาณพร้อม'); return; }
  if (activityMode()) {
    const result = arm.tracker.update(frame);sampleLiveVelocity(arm,frame);
    if (!result) return;
    const row = {...result,velocity_axis:arm.tracker.cal.axisChoice,velocity_reversed:arm.tracker.cal.reverse,threshold_mode:thresholdSetting.value===null?'auto':'manual',cycle_s:result.movement_s,arm:id,rep:++arm.count,motion:session.motion,
      role:id===session.leader?'driver':'following_handle',source:session.source,timestamp:new Date().toISOString(),measurement:result.measurement||'slope_activity_bout'};
    records.push(row);arm.last=row;renderRow(row);
    if(id===session.leader) {
      publishPhoto(snapshot('สิ้นสุดช่วงการเคลื่อนไหว (ไม่ใช่ภาพปลายทาง)'));
    }
    return;
  }
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
    measurement:'angular_cycle',baseline_deg:Math.abs(arm.cal.span),
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
  $('recordHead').innerHTML=(row.measurement==='slope_activity_bout'?['มือจับ','ช่วงที่','เวลาเคลื่อน (วินาที)','Slope สูงสุด (mg/s)']:['แขน','รอบ','ไป (วินาที)','กลับ (วินาที)','เวลารอบ (วินาที)','ช่วงมุม (°)','เทียบ baseline (%)']).map(label=>'<th>'+label+'</th>').join('');
  const side=row.arm==='left'?'ซ้าย':'ขวา';
  const values=row.measurement==='slope_activity_bout'?[side,row.rep,row.movement_s.toFixed(2),row.peak_slope_mg_s.toFixed(2)]:[side,row.rep,row.outbound_s?.toFixed(2)??'—',row.return_s?.toFixed(2)??'—',row.cycle_s.toFixed(2),row.angle_range_deg?.toFixed(1)??'—',row.baseline_percent?.toFixed(0)??'—'];
  for (const value of values) {
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
  const arm = {sensor:new WitMotion(),el,metric,values,timing:{last:null,maxGap:0,duplicates:0},liveVelocity:[],noise:null,velocityNoise:null,velocityNoiseAxes:null,frame:null,samples:[],home:null,cal:null,count:0,last:null,tracker:new RepTracker(),log:[],photoPeak:0,peakPhoto:null};
  arms[id] = arm;
  arm.sensor.addEventListener('data', ({detail}) => receive(id,detail));
  arm.sensor.addEventListener('status', ({detail}) => {
    addLog(arm,detail.state + (detail.message ? ': ' + detail.message : ''));
    if (detail.state === 'connected') el.device.textContent = detail.deviceName + ' · ID …' + (arm.sensor.device?.id || '').slice(-8);
    if (detail.state === 'disconnected') {
      pause('เซนเซอร์หลุด จบรอบนี้ก่อนเชื่อมต่อและบันทึก baseline ใหม่');
      arm.frame = null; arm.samples = []; arm.cal = activityMode()?tuned({usable:true}):null; arm.tracker=activityMode()?new SlopeTracker(arm.cal):new RepTracker(); arm.home = null; arm.noise=null;arm.velocityNoise=null;arm.velocityNoiseAxes=null;
    }
    updateControls();
  });
  arm.sensor.addEventListener('progress', ({detail}) => { addLog(arm,detail.message); el.status.textContent = detail.message; });
  for (const type of ['error','warning']) arm.sensor.addEventListener(type, ({detail}) => {
    const message = detail.message || String(detail);
    addLog(arm,message); el.device.textContent = message; card.querySelector('details').open = true;
  });
  el.connect.addEventListener('click', async () => {
    invalidate();arm.timing={last:null,maxGap:0,duplicates:0}; arm.frame = null; arm.samples = [];
    try { await arm.sensor.connect({allDevices:$('showAllDevices').checked,namePrefix:$('sensorPrefix').value.trim() || 'WT901',excludedDeviceIds:Object.values(arms).filter(a => a !== arm).map(a => a.sensor.device?.id).filter(Boolean)}); }
    catch (error) { el.device.textContent = error.message; }
    updateControls();
  });
  el.disconnect.addEventListener('click', () => arm.sensor.disconnect());
}
function changeSetup() {
  if ($('participants').value !== 'both') $('leader').value = $('participants').value;
  for(const [id,arm] of Object.entries(arms)) if(!selected().includes(id)&&arm.sensor.status!=='disconnected')arm.sensor.disconnect();
  invalidate(); if (stage === 'finished') stage = 'idle';
  if (demo) { Object.values(arms).forEach(a => { a.samples = []; a.frame = null; }); demoPose = 'home'; }
  $('velocityAxis').value=defaultVelocityAxis($('motion').value);
  if(activityMode())for(const arm of Object.values(arms)){arm.cal=tuned({usable:true});arm.tracker=new SlopeTracker(arm.cal);}
  const mode = modes[$('motion').value];
  for(const arm of Object.values(arms))arm.metric.querySelectorAll('.metric-grid small').forEach((node,i)=>{node.textContent=(activityMode()?['ช่วงที่เสร็จ','เวลาช่วงล่าสุด','Slope สูงสุดช่วงล่าสุด','ขนาด slope ปัจจุบัน']:['รอบที่เสร็จ','เวลารอบล่าสุด','ช่วงเคลื่อนรอบล่าสุด','ระดับปัจจุบัน'])[i];});
  $('mission').textContent = activityMode() ? 'ภารกิจ · รดน้ำให้สวน' : 'ภารกิจ · ' + mode.mission;
  document.querySelector('.garden').dataset.motion = $('motion').value;
  for (const node of document.querySelectorAll('#playPanel .traveller')) node.textContent = mode.icon;
  if(activityMode())resetPlants();
  updateControls();
}
$('motion').addEventListener('change',changeSetup);
$('participants').addEventListener('change',changeSetup);
$('goal').addEventListener('input',()=>{if(activityMode()&&!inSession())resetPlants();});
$('leader').addEventListener('change',updateControls);
async function changeOutputRate(hz){
  if(inSession()||teaching||demo||rateChanging)return;
  rateChanging=true;invalidate();updateControls();
  const errors=[];
  try{
    for(const id of selected()){
      const arm=arms[id];arm.timing={last:null,maxGap:0,duplicates:0};arm.noise=null;arm.velocityNoise=null;arm.velocityNoiseAxes=null;
      try{await arm.sensor.setOutputRate(hz);addLog(arm,'ส่งคำสั่ง '+hz+' Hz แล้ว ตรวจอัตรารับจริงก่อนสอนใหม่');}
      catch(error){addLog(arm,error.message);errors.push(error.message);}
    }
    $('calibration').textContent=errors.length?errors.join(' / '):'ส่งคำสั่ง '+hz+' Hz แล้ว ตรวจ Hz ที่รับจริง จากนั้นตั้งศูนย์และสอนใหม่';
  }finally{rateChanging=false;updateControls();}
}
$('setRate50').addEventListener('click',()=>changeOutputRate(50));
$('setRate10').addEventListener('click',()=>changeOutputRate(10));
$('home').addEventListener('click', () => {
  if(activityMode()){showTab('play',true);return;}
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
  if (!activityMode() && (!Number.isFinite(target) || !Number.isFinite(home) || target < .5 || target > 1 || home < .05 || home > .4 || target <= home + .1)) { say('ตรวจเกณฑ์: เป้า 50–100% และกลับ 5–40% โดยเป้าต้องมากกว่าจุดกลับอย่างน้อย 10%'); return; }
  if (stage !== 'paused') {
    records = []; $('rows').replaceChildren(); $('flowers').textContent = ''; accumulated = 0;
    for (const arm of Object.values(arms)) { arm.count = 0; arm.last = null; }
    session = {motion:$('motion').value,leader:leader(),goal,source:demo ? 'demo' : 'live'};
    if(activityMode())resetPlants(goal);
  }
  Object.values(arms).forEach(arm => { arm.tracker = activityMode() && arm.cal ? new SlopeTracker(tuned(arm.cal)) : new RepTracker({targetThreshold:target,homeThreshold:home,targetDwellMs:0}); arm.peakPhoto=null; arm.photoPeak=0;arm.liveVelocity=[]; });
  runStart = now();stage=activityMode()?'zeroing':'running';
  zeroing=activityMode()?{start:now(),ids:[...selected()],frames:Object.fromEntries(selected().map(id=>[id,[]]))}:null;
  showTab('play', true);
  say('กลับจุดเริ่มก่อน แล้วไปถึงเป้า ≥' + (target * 100).toFixed(0) + '% และกลับ ≤' + (home * 100).toFixed(0) + '% · ไม่ต้องค้างปลายท่า');
  if(activityMode()) say('หยุดรดต้นไม้เพื่อเก็บต้นนั้น · เลื่อนไปหาต้นที่ยังไม่ได้เก็บ');
  if(stage==='zeroing')say('ค้างมือจับนิ่ง 1.5 วินาที กำลังเตรียมสถานะพัก ก่อนเริ่มจับเวลา');
  updateControls();
});
const refreshVelocitySettings=()=>{
  if(teaching||inSession())return;
  for(const arm of Object.values(arms))if(arm.cal?.axis)arm.tracker=new SlopeTracker(tuned(arm.cal));
  lastPlot=-Infinity;updateControls();
};
$('sensitivity').addEventListener('input',refreshVelocitySettings);
$('velocityAxis').addEventListener('change',refreshVelocitySettings);
$('reverseVelocity').addEventListener('change',refreshVelocitySettings);
$('slopeLow').addEventListener('input',()=>{lowThresholdSetting.edit($('slopeLow').value);$('accelThreshold').setCustomValidity('');});
$('accelThreshold').addEventListener('input',()=>{thresholdSetting.edit($('accelThreshold').value);$('accelThreshold').setCustomValidity('');});
$('slopeLow').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('applyThreshold').click();}});
$('accelThreshold').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('applyThreshold').click();}});
$('applyThreshold').addEventListener('click',()=>{
  if(!activityMode())return;
  $('accelThreshold').setCustomValidity('');
  try{applyThresholdPair(thresholdSetting,lowThresholdSetting,$('accelThreshold').value,$('slopeLow').value);applyLiveThresholds();}
  catch(error){$('accelThreshold').setCustomValidity(error.message);$('accelThreshold').reportValidity();}
});
function applyLiveThresholds(){
  for(const arm of Object.values(arms)){
    arm.cal=tuned({usable:true});
    if(arm.tracker instanceof SlopeTracker)arm.tracker.setThresholds(slopeOptions());else arm.tracker=new SlopeTracker(arm.cal);
  }
  lastPlot=-Infinity;updateControls();
  say('ใช้ High '+slopeOptions().high+' / Low '+slopeOptions().low+' mg/s แล้ว · ช่วงที่ยังไม่จบเริ่มนับใหม่ จำนวนที่จบแล้วคงเดิม');
}
$('autoThreshold').addEventListener('click',()=>{if(!activityMode())return;resetSlopeThresholds();$('accelThreshold').setCustomValidity('');applyLiveThresholds();});
$('exportTeaching').addEventListener('click',()=>{
  const capture=teaching||lastTeaching;if(!capture)return;
  const rows=[['capture_kind','source','arm','elapsed_ms','ax_g','ay_g','az_g','ema_x_g','ema_y_g','ema_z_g','slope_x_mg_s','slope_y_mg_s','slope_z_mg_s','signed_slope_mg_s','state','high_mg_s','low_mg_s','axis','reverse']];
  for(const id of capture.ids){const analysis=inspectSlope(capture.frames[id],capture.start,slopeOptions());for(const sample of analysis.training)rows.push([capture.kind||'motion',capture.source,id,sample.elapsedMs,...sample.acceleration,...sample.filtered,...(sample.slopes||['','','']),sample.signed??'',sample.state,analysis.high,analysis.low,analysis.axisChoice,analysis.reverse]);}
  const url=URL.createObjectURL(new Blob([rows.map(row=>row.join(',')).join('\r\n')],{type:'text/csv'}));
  const a=document.createElement('a');a.href=url;a.download='arm-booster-teaching.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('pause').addEventListener('click', () => pause());
$('finish').addEventListener('click', () => finish());
$('startFromSettings').addEventListener('click', () => activityMode() ? showTab('play',true) : $('start').click());
$('backToSettings').addEventListener('click', () => showTab(activityMode()?'settings':'calibration', true));
$('goCalibration').addEventListener('click',()=>showTab(activityMode()?'play':'calibration',true));
$('endFromSettings').addEventListener('click', () => finish());
for (const page of tabs) {
  $('tab-' + page).addEventListener('click', () => showTab(page));
  $('tab-' + page).addEventListener('keydown', event => {
    if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const visibleTabs=tabs.filter(name=>!$('tab-'+name).hidden),index=visibleTabs.indexOf(page),direction=event.key==='ArrowLeft'?-1:1;
      showTab(event.key==='Home'?visibleTabs[0]:event.key==='End'?visibleTabs.at(-1):visibleTabs[(index+direction+visibleTabs.length)%visibleTabs.length],true);
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
  const arm = arms[leader()], percent = !activityMode() && fresh(arm) && arm.cal ? Math.max(0,project(arm.frame,arm.cal) * 100) : null;
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
      receive(id,{type:'motion',angles,acceleration:(()=>{const q=teaching?(t-teaching.start)/1000:(t-runStart)/1000,a=[0,0,1],axis=$('velocityAxis').value==='auto'?1:'XYZ'.indexOf($('velocityAxis').value);a[axis]+=(stage==='zeroing'||teaching?.kind==='noise'?0:(()=>{const p=q%7;return p<1?0:p<2.5?-.015*(p-1):p<3?-.0225:p<4.5?-.0225+.015*(p-3):0;})())*(id==='right'?-1:1);return a;})(),monotonicMs:t,receivedAt:Date.now()});
    }
  },100);
  updateControls();
});
$('export').addEventListener('click', () => {
  const keys = ['timestamp','source','motion','role','arm','rep','outbound_s','return_s','cycle_s','angle_range_deg','baseline_deg','baseline_percent','measurement','movement_s','peak_acceleration_g','threshold_g','peak_velocity_cm_s','threshold_cm_s','peak_slope_mg_s','high_slope_mg_s','low_slope_mg_s','axis','reverse','velocity_axis','velocity_reversed','threshold_mode','pattern_score','direction_changes','sensitivity'];
  const quote = value => '"' + String(value).replaceAll('"','""') + '"';
  const csv = '\ufeff' + [keys,...records.map(row => keys.map(key => row[key] ?? ''))].map(row => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const a = document.createElement('a'); a.href = url; a.download = 'arm-booster-session.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});
setInterval(() => {
  if (stage === 'finishing' && now() - completeAt >= 500) finish(session.motion!=='twist'?'สวนสำเร็จแล้ว! รดน้ำเก็บต้นไม้ครบ '+session.goal+' ต้น':'สวนสำเร็จแล้ว! แขนที่ขับกลไกเคลื่อนครบ '+session.goal+' รอบ');
  if (['running','zeroing'].includes(stage) && !allFresh()) pause('ข้อมูลขาดช่วง พักการนับไว้ กลับจุดเริ่มแล้วกดเริ่มต่อเมื่อสัญญาณพร้อม');
  if(stage==='zeroing'&&zeroing&&now()-zeroing.start>=1500){
    const captured=zeroing;
    try{
      if(document.hidden||!allFresh())throw new Error('ข้อมูลขาดช่วงระหว่างตั้งศูนย์');
      const refs=Object.fromEntries(captured.ids.map(id=>[id,stationaryProfile(captured.frames[id])]));
      for(const id of captured.ids){arms[id].tracker=new SlopeTracker({...tuned(arms[id].cal),...refs[id]});addLog(arms[id],'ตั้งศูนย์ก่อนเริ่มแล้ว: เริ่ม slope ใหม่จากสถานะพัก');}
      zeroing=null;runStart=now();stage='running';say('ตั้งศูนย์แล้ว เริ่มเคลื่อนไหวได้');
    }catch(error){zeroing=null;stage='paused';say(error.message+' · ค้างให้นิ่งแล้วกดเริ่มต่อ');}
  }
  if((teaching||lastTeaching)&&now()-lastPlot>=250){
    lastPlot=now();const capture=teaching||lastTeaching,id=leader();
    const analysis=inspectSlope(capture.frames[id]||[],capture.start,slopeOptions());calPreview=analysis;
    drawSlope($('calVelocityAxis'),analysis.training.filter(s=>s.signed!==null).map(s=>({elapsedMs:s.elapsedMs,value:s.signed})),analysis.high,analysis.low,analysis.axisChoice,30000);
    $('calVelocityAxisLabel').textContent='Slope แกน '+analysis.axisChoice+' · EMA 50 ms / 10 จุด';
    $('trace-summary-left').textContent=analysis.training.length+' ตัวอย่าง · '+analysis.count+' ช่วงเคลื่อนที่จบ · เกณฑ์เข้า ±'+analysis.high.toFixed(2)+' / เกณฑ์พัก ±'+analysis.low.toFixed(2)+' mg/s';
  }
  if(teaching) {
    let elapsed=now()-teaching.start;
    if(teaching && (document.hidden || !allFresh())) {
      lastTeaching=teaching;teaching=null;invalidate();$('calibration').textContent='ยกเลิกการสอน: หน้าไม่แสดงหรือข้อมูลขาดช่วง กรุณาสอนใหม่';
    } else if(teaching && elapsed>=(teaching.duration||30000)) {
      const captured=teaching;lastTeaching=captured;teaching=null;
      try {
        const learned=Object.fromEntries(captured.ids.map(id=>[id,learnSlope(captured.frames[id],captured.start,slopeOptions())]));
        for(const id of captured.ids){arms[id].cal=learned[id];arms[id].tracker=new SlopeTracker(tuned(learned[id]));}
        $('calibration').textContent='Cal ครบ 30 วินาทีแล้ว ตรวจกราฟ ปรับเกณฑ์ แล้วเริ่มเกมได้';
        $('calibrationDetails').textContent='EMA 50 ms · slope 10 จุด · ตรวจขนาดทั้งบวกและลบ · พัก → เคลื่อน → พัก';
      }catch(error){invalidate();$('calibration').textContent=error.message;}
    } else if(teaching) {
      $('calibration').textContent=(teaching.phase==='zeroing'?'ค้างมือจับนิ่งเพื่อตั้งศูนย์ก่อนสอน':teaching.kind==='noise'?'วางอุปกรณ์นิ่ง':'ทำพัก → เคลื่อน → พักซ้ำ')+' · เหลือ '+Math.ceil(((teaching.duration||30000)-elapsed)/1000)+' วินาที';
    }
  }
  const driver = arms[leader()];
  $('liveVelocityPanel').hidden=!activityMode();
  if(activityMode()){const samples=driver.liveVelocity,first=samples[0]?.time||now();drawSlope($('liveVelocityY'),samples.map(s=>({elapsedMs:s.time-first,value:s.signed})),driver.tracker.threshold||1.5,driver.tracker.lowThreshold||.5,$('velocityAxis').value,8000);$('liveAxisLabel').textContent=$('velocityAxis').value;$('liveVelocityYValue').textContent=fresh(driver)&&driver.tracker.ready?driver.tracker.signed.toFixed(2)+' mg/s':'รอครบ 10 จุด';}

  const visual = activityMode() ? .5 : fresh(driver) && driver.cal ? Math.max(0,Math.min(1,project(driver.frame,driver.cal))) : 0;
  for (const [id,arm] of Object.entries(arms)) {
    const valid = fresh(arm), p = !activityMode() && valid && arm.cal ? project(arm.frame,arm.cal) : null;
    arm.values.role.textContent = id === leader() ? '· ขับกลไก / นับรอบหลัก' : '· มือจับที่เคลื่อนตาม';
    arm.values.count.textContent = arm.count;
    arm.values.cycle.textContent = arm.last ? arm.last.cycle_s.toFixed(2) + ' s' : '—';
    arm.values.percent.textContent = arm.last ? arm.last.baseline_percent?.toFixed(0) + '%' : '—';
    arm.values.progress.textContent = p === null ? '—' : Math.max(0,p * 100).toFixed(0) + '%';
    arm.values.signed.textContent = p === null ? '—' : 'ค่าดิบมีทิศทาง ' + (p * 100).toFixed(1) + '% (ค่าลบคือเลยท่าเริ่มไปอีกด้าน)';
    arm.values.phase.textContent = !valid ? 'รอข้อมูล IMU สด' : stage === 'running' ? phaseLabel(arm) + ' · เป้า ' + ((arm.tracker.targetThreshold || 0) * 100).toFixed(0) + '% / กลับไม่เกิน ' + ((arm.tracker.homeThreshold || 0) * 100).toFixed(0) + '%' : '';
    arm.values.range.textContent = arm.cal && !activityMode() ? 'baseline ' + Math.abs(arm.cal.span).toFixed(1) + '° · รอบล่าสุด ' + (arm.last ? arm.last.angle_range_deg.toFixed(1) + '°' : '—') : 'ยังไม่มี baseline';
    if(activityMode()) {
      arm.values.progress.textContent=valid ? arm.tracker.ready?Math.abs(arm.tracker.signed).toFixed(2)+' mg/s':'รอครบ 10 จุด' : '—';
      arm.values.percent.textContent=arm.last ? (arm.last.peak_slope_mg_s||0).toFixed(2)+' mg/s (สูงสุด)' : '—';
      arm.values.signed.textContent=valid ? 'ความเร่ง XYZ (รวมแรงโน้มถ่วง) '+arm.frame.acceleration.map(v=>v.toFixed(3)).join(', ')+' g' : '—';
      arm.values.range.textContent='เคลื่อน ≥'+(arm.tracker.threshold||1.5).toFixed(2)+' / พัก ≤'+(arm.tracker.lowThreshold||.5).toFixed(2)+' mg/s · '+phaseLabel(arm);
      arm.values.phase.textContent=!valid ? 'รอข้อมูล IMU สด' : stage==='running' ? phaseLabel(arm)+(arm.tracker.started===null?'':' · '+((now()-arm.tracker.started)/1000).toFixed(1)+' s') : 'นับหนึ่งช่วงเมื่อเคลื่อนแล้วกลับมาพัก';
    }
    const lane = document.querySelector('.lane[data-side="' + id + '"]');
    const traveller = lane.querySelector('.traveller'), motion = $('motion').value;
    if(!activityMode())traveller.style.left='50%';
    traveller.style.top = motion === 'lift' && !activityMode() ? (100 - visual * 100) + '%' : '50%';
    traveller.style.transform = motion === 'twist' ? 'translate(-50%,-50%) rotate(' + (visual * 100 * (id === 'left' ? -1 : 1)) + 'deg)' : '';
    lane.querySelector('.lane-state').textContent = !selected().includes(id) ? 'ภาพสะท้อน' : !valid ? 'รอข้อมูล' : stage === 'running' ? phaseLabel(arm) : stage === 'paused' ? 'พัก' : arm.cal ? 'พร้อม' : 'สอนท่าก่อน';
  }
  const elapsed = accumulated + (stage === 'running' ? now() - runStart : 0);
  $('elapsed').textContent = 'เวลาฝึก ' + Math.floor(elapsed / 60000) + ':' + String(Math.floor(elapsed / 1000) % 60).padStart(2,'0');
  $('instruction').textContent = stage === 'finished' ? 'จบรอบฝึกแล้ว · ดูผลการเคลื่อนไหวด้านล่าง' : stage === 'paused' ? 'พักได้ แล้วกลับมาเริ่มที่จุดเริ่ม' : stage === 'running' ? phaseLabel(driver) + ' · ' + modes[$('motion').value].name : (activityMode() ? 'บันทึกค่าขณะนิ่ง แล้วเริ่มจับเวลา' : 'บันทึก baseline แล้วเริ่มปลูกสวน');
  const primary = records.filter(row => row.role === 'driver');
  $('sampleRate').textContent=selected().map(id=>{const samples=arms[id].samples,span=samples.length>1?samples.at(-1).monotonicMs-samples[0].monotonicMs:0;return (id==='left'?'ซ้าย':'ขวา')+': '+(span>0?((samples.length-1)*1000/span).toFixed(1):'—')+' Hz เฟรมที่รับ · ช่องว่างสูงสุด '+arms[id].timing.maxGap.toFixed(0)+' ms · เวลารับซ้ำ '+arms[id].timing.duplicates+' เฟรม';}).join(' / ');
  const previewSample=calPreview?.training.at(-1);
  $('movementMonitor').textContent=activityMode()?(teaching||lastTeaching)&&calPreview ? 'Cal: '+activityLabels[calPreview.state]+' · '+(previewSample?.signed!==null&&previewSample?.signed!==undefined?previewSample.signed.toFixed(2)+' mg/s':'รอข้อมูล 10 จุด') : phaseLabel(driver)+' · '+(driver.tracker.ready?driver.tracker.signed.toFixed(2)+' mg/s':'รอข้อมูล 10 จุด'):'';
  $('activityTableHint').hidden=!activityMode();
  $('summary').textContent = primary.length ? (primary[0].source === 'demo' ? '[ข้อมูลจำลอง] ' : '[ข้อมูล IMU] ') + modes[primary[0].motion].name + ' · แขนขับกลไก ' + primary.length + ' รอบ · เวลารอบเฉลี่ย ' + (primary.reduce((sum,row) => sum + row.cycle_s,0) / primary.length).toFixed(2) + ' วินาที · บันทึกทั้งสองฝั่งรวม ' + records.length + ' รายการ' : 'ยังไม่มีรอบที่เสร็จสมบูรณ์';
  if(activityMode()) {
    $('instruction').textContent=stage==='running' ? (driver.tracker.ready?(driver.tracker.state==='moving'?'เลื่อนฝักบัว · หยุดน้ำ':'พักมือจับ · กำลังรดน้ำ'):'ค้างนิ่ง · รอข้อมูล 10 จุด') : stage==='paused'?'หยุดชั่วคราว · กดเริ่มต่อเมื่อพร้อม':stage==='finished'?'จบรอบฝึกแล้ว':stage==='finishing'?'ครบเป้าหมายแล้ว':'พักรดน้ำ → เคลื่อนย้าย → พักรดน้ำ';
    $('summary').textContent='ได้ต้นไม้ '+plantRewards.earned.length+' ต้น · '+primary.length+' ช่วงเคลื่อนไหว · รวม '+primary.reduce((n,r)=>n+r.movement_s,0).toFixed(2)+' วินาที';
  }
  const moving=stage==='running'&&fresh(driver)&&driver.tracker.ready&&driver.tracker.state==='moving';
  $('activityState').textContent=stage==='zeroing'?'เตรียมตัว · ค้างนิ่ง':stage==='paused'?'หยุดชั่วคราว':stage==='finished'?'จบรอบฝึก':stage==='finishing'?'ครบเป้าหมาย':stage==='running'?(driver.tracker.ready?(moving?'เคลื่อน · ไม่รดน้ำ':'พัก · รดน้ำ'):'รอข้อมูล 10 จุด'):'พร้อมเริ่ม';
  $('activityStatus').classList.toggle('is-moving',moving);
  $('movementElapsed').textContent='ช่วงนี้ '+(moving&&driver.tracker.started!==null?((now()-driver.tracker.started)/1000).toFixed(1):'0.0')+' วินาที';
  $('boutGoal').textContent=plantRewards.earned.length+' / '+plantRewards.goal+' ต้น';
  if(stage==='zeroing'){const remaining=Math.max(0,(1500-(now()-zeroing.start))/1000);$('instruction').textContent='ค้างมือจับนิ่ง · ตั้งศูนย์ '+remaining.toFixed(1)+' s';$('notice').textContent='ยังไม่จับเวลาและไม่นับ กำลังเตรียมเริ่มสถานะพัก';for(const id of selected()){arms[id].values.progress.textContent='ตั้งศูนย์…';arms[id].values.phase.textContent='อย่าขยับมือจับจนกว่าจะเริ่ม';}}
  updateControls();
},100);
$('support').textContent = navigator.bluetooth && isSecureContext ? 'ใช้ Chrome / Edge · เลือกทีละเซนเซอร์' : 'เบราว์เซอร์นี้ยังใช้ BLE ไม่ได้ ลองข้อมูลจำลอง หรือเปิด Chrome / Edge ผ่าน HTTPS / localhost';
document.addEventListener('visibilitychange', () => { if (document.hidden) pause('พักการนับเมื่อออกจากหน้า กลับมาจุดเริ่มก่อนเริ่มต่อ'); });
window.addEventListener('pagehide', () => { camera.stop(); clearInterval(demoTimer); Object.values(arms).forEach(a => a.sensor.disconnect()); });
changeSetup();
showTab('settings');

let visualFrame;
function animateVelocity(time){
  if(activityMode()){
    const arm=arms[leader()],tracker=arm.tracker;
    const active=stage==='running'&&fresh(arm)&&Boolean(arm.cal)&&tracker.ready&&!document.hidden;
    const feedback=wateringVisual.update({state:tracker.state,time,active});
    const previousRow=plantRewards.row;
    const reward=plantRewards.update(feedback);
    if(reward||previousRow!==plantRewards.row)renderPlants();
    const target=plantRewards.targetAt(feedback.position);
    for(const slot of $('plantBed').children)slot.classList.toggle('is-target',Boolean(target&&!target.collected&&slot.dataset.plantId===String(target.id)));
    $('wateringScene').dataset.feedback=feedback.feedback;
    $('wateringNozzle').style.left=(feedback.position*100).toFixed(2)+'%';
    const caption=feedback.watering?(reward?'ได้ '+reward.emoji+' '+reward.name:target?.collected?'ช่องนี้เก็บแล้ว · เลื่อนไปต้นอื่น':target?'กำลังรด '+target.name:'ระหว่างต้นไม้ · เลื่อนอีกนิด'):feedback.moving?'เลื่อนฝักบัว · น้ำหยุด':'น้ำหยุด · รอเริ่มฝึก';
    if($('wateringCaption').textContent!==caption)$('wateringCaption').textContent=caption;
    if(reward){
      say('ได้ '+reward.emoji+' '+reward.name+' แล้ว · '+plantRewards.earned.length+' / '+plantRewards.goal+' ต้น');
      if(plantRewards.complete){accumulated+=now()-runStart;completeAt=now();stage='finishing';}
    }
  }
  visualFrame=requestAnimationFrame(animateVelocity);
}
visualFrame=requestAnimationFrame(animateVelocity);
window.addEventListener('pagehide',()=>cancelAnimationFrame(visualFrame));
