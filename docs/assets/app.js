import {WitMotion} from '../lib/witmotion.js?v=20261103-3';
import {angleFor, compareArms} from '../lib/comparison.js';
const $ = id => document.getElementById(id);
const supported = Boolean(navigator.bluetooth) && isSecureContext;
const arms = [];
let demoTimer = null;
const axisNames = ['X · Roll', 'Y · Pitch', 'Z · Yaw'];
function log(arm, message) {
  const lines = arm.el.log.textContent.split('\n').filter(Boolean);
  lines.unshift(new Date().toLocaleTimeString() + '  ' + message);
  arm.el.log.textContent = lines.slice(0, 35).join('\n');
}
function active(arm) { return arm.demo || arm.sensor.status === 'connected'; }
function clearHistory() { arms.forEach(arm => { arm.history = []; }); }
function clearNeutral() {
  arms.forEach(arm => { arm.baseline = null; }); clearHistory();
  $('reference').textContent = 'Raw sensor angles';
}
function reset(arm) {
  arm.frame = null; arm.count = 0; arm.arrivals = []; arm.history = []; arm.extraAt = null;
  arm.el.raw.textContent = '—'; arm.el.extra.textContent = 'No register response yet.';
  for (const group of ['angles', 'acceleration', 'angularVelocity']) arm.el[group].querySelectorAll('strong').forEach(el => { el.textContent = '—'; });
  clearNeutral();
}
function controls() {
  const demo = arms.some(arm => arm.demo);
  const connecting = arms.some(arm => ['selecting', 'connecting'].includes(arm.sensor.status));
  for (const arm of arms) {
    const busy = arm.sensor.status !== 'disconnected';
    arm.buttons.connect.disabled = busy || connecting || demo || !supported;
    arm.buttons.disconnect.disabled = !busy && !arm.demo;
    arm.el.allDevices.disabled = busy || connecting || demo;
    arm.buttons.quaternion.disabled = arm.buttons.magnetic.disabled = !arm.sensor.writer || arm.sensor.status !== 'connected';
  }
  $('demo').disabled = arms.some(arm => arm.sensor.status !== 'disconnected');
  $('demo').textContent = demo ? 'Stop demo' : 'Try two-arm demo';
  $('clearZero').disabled = !arms.some(arm => arm.baseline);
  $('zero').disabled = !arms.every(arm => active(arm) && arm.frame && performance.now() - arm.frame.monotonicMs <= 500);
  const liveCount = arms.filter(arm => arm.sensor.status === 'connected').length;
  $('source').textContent = demo ? 'SIMULATED DATA' : liveCount ? liveCount + ' / 2 SENSORS CONNECTED' : 'NO LIVE SOURCE';
}
function display(arm, frame) {
  if (frame.type === 'motion') {
    arm.frame = frame; arm.count++;
    arm.arrivals.push(frame.monotonicMs);
    arm.arrivals = arm.arrivals.filter(t => frame.monotonicMs - t < 3000);
    arm.history.push({time: frame.monotonicMs, angles: frame.angles});
    arm.history = arm.history.filter(p => frame.monotonicMs - p.time < 15000);
    for (const group of ['angles', 'acceleration', 'angularVelocity']) arm.el[group].querySelectorAll('strong').forEach((el, i) => { el.textContent = frame[group][i].toFixed(group === 'acceleration' ? 3 : 1); });
  } else if (frame.type !== 'unknown') {
    arm.extraAt = frame.monotonicMs;
    arm.el.extra.textContent = JSON.stringify(frame.quaternion ? {quaternion_wxyz: frame.quaternion} : {magneticRaw_xyz: frame.magneticRaw}, null, 2);
    log(arm, 'Received ' + frame.type + ' response.');
  } else log(arm, 'Unknown register: 0x' + frame.register.toString(16));
}
for (const [index, name] of ['Left arm', 'Right arm'].entries()) {
  const fragment = $('armTemplate').content.cloneNode(true);
  const root = fragment.querySelector('article'); root.dataset.side = index === 0 ? 'left' : 'right';
  const el = Object.fromEntries([...root.querySelectorAll('[data-field]')].map(node => [node.dataset.field, node]));
  const buttons = Object.fromEntries([...root.querySelectorAll('[data-action]')].map(node => [node.dataset.action, node]));
  const arm = {name, root, el, buttons, sensor: new WitMotion(), demo: false, sign: 1, baseline: null, frame: null, count: 0, arrivals: [], history: [], extraAt: null};
  el.title.textContent = name;
  buttons.connect.setAttribute('aria-label', 'Connect ' + name.toLowerCase());
  buttons.disconnect.setAttribute('aria-label', 'Disconnect ' + name.toLowerCase());
  for (const group of ['angles', 'acceleration', 'angularVelocity']) {
    for (const axis of ['X', 'Y', 'Z']) {
      const value = document.createElement('div'); value.className = 'value';
      const label = document.createElement('small'); label.textContent = axis;
      const number = document.createElement('strong'); number.textContent = '—';
      value.append(label, number); el[group].append(value);
    }
  }
  arm.sensor.addEventListener('data', ({detail}) => display(arm, detail));
  arm.sensor.addEventListener('raw', ({detail}) => { el.raw.textContent = Array.from(detail, b => b.toString(16).padStart(2, '0')).join(' '); });
  arm.sensor.addEventListener('status', ({detail}) => {
    el.badge.textContent = detail.state; el.badge.dataset.state = detail.state;
    log(arm, detail.state + (detail.message ? ': ' + detail.message : ''));
    if (detail.state === 'connected') {
      const id = arm.sensor.device?.id;
      el.device.textContent = (detail.deviceName || 'Unnamed sensor') + (id ? ' · browser ID …' + id.slice(-8) : '');
      el.message.textContent = 'Connected. Waiting for motion data…';
    } else if (detail.state === 'disconnected') el.message.textContent = 'Disconnected. Last values remain visible; comparison paused.';
    else el.message.textContent = detail.state === 'selecting' ? 'Choose the sensor mounted on your ' + name.toLowerCase() + '.' : 'Opening GATT connection…';
    controls();
  });
  arm.sensor.addEventListener('progress', ({detail}) => { log(arm, detail.message); el.message.textContent = detail.message + '…'; });
  arm.sensor.addEventListener('warning', ({detail}) => { log(arm, detail); el.message.textContent = detail; });
  arm.sensor.addEventListener('error', ({detail}) => { log(arm, detail.name + ': ' + detail.message); root.querySelector('details').open = true; });
  buttons.connect.addEventListener('click', async () => {
    reset(arm);
    try {
      await arm.sensor.connect({allDevices: el.allDevices.checked,
        excludedDeviceIds: arms.filter(other => other !== arm).map(other => other.sensor.device?.id).filter(Boolean)});
    } catch (error) { el.message.textContent = error.message; }
    controls();
  });
  buttons.disconnect.addEventListener('click', () => {
    if (arm.demo) {
      arm.demo = false; el.badge.textContent = 'Demo stopped'; el.badge.dataset.state = '';
      el.message.textContent = 'Demo stopped for this arm.';
      if (!arms.some(a => a.demo)) { clearInterval(demoTimer); demoTimer = null; }
    } else arm.sensor.disconnect();
    controls();
  });
  for (const [action, reg] of [['quaternion', 0x51], ['magnetic', 0x3a]]) buttons[action].addEventListener('click', async () => {
    try { await arm.sensor.readRegister(reg); log(arm, 'Read request sent: 0x' + reg.toString(16)); }
    catch (error) { log(arm, error.message); el.message.textContent = error.message; }
  });
  el.reverse.addEventListener('change', () => { arm.sign = el.reverse.checked ? -1 : 1; clearHistory(); });
  arms.push(arm); $('arms').append(fragment); log(arm, 'Ready. Connect a distinct sensor for this arm.');
}
$('demo').addEventListener('click', () => {
  if (arms.some(arm => arm.demo)) {
    for (const arm of arms) if (arm.demo) arm.buttons.disconnect.click();
    return;
  }
  const start = performance.now();
  for (const arm of arms) {
    reset(arm); arm.demo = true; arm.el.device.textContent = 'Simulated ' + arm.name.toLowerCase() + ' sensor';
    arm.el.badge.textContent = 'Demo · simulated'; arm.el.badge.dataset.state = 'demo';
    arm.el.message.textContent = 'Simulated motion; no hardware measurements.';
  }
  demoTimer = setInterval(() => {
    const now = performance.now();
    arms.forEach((arm, index) => {
      if (!arm.demo) return;
      const t = (now - start) / 1000 - index * .25, scale = index ? .8 : 1;
      display(arm, {type: 'motion', monotonicMs: now,
        angles: [35 * Math.sin(t) * scale, 20 * Math.sin(t * .7) * scale, 50 * Math.sin(t * .4) * scale],
        acceleration: [.12 * Math.sin(t), .08 * Math.cos(t), 1 + .05 * Math.sin(t * 2)],
        angularVelocity: [35 * Math.cos(t) * scale, 14 * Math.cos(t * .7) * scale, 20 * Math.cos(t * .4) * scale]});
    });
  }, 100);
  controls();
});
$('zero').addEventListener('click', () => {
  if (!arms.every(arm => active(arm) && arm.frame && performance.now() - arm.frame.monotonicMs <= 500)) return;
  arms.forEach(arm => { arm.baseline = [...arm.frame.angles]; });
  $('reference').textContent = 'Relative to each arm’s neutral'; clearHistory(); controls();
});
$('clearZero').addEventListener('click', () => { clearNeutral(); controls(); });
const canvas = $('chart'), ctx = canvas.getContext('2d');
function draw(now, axis) {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const left = 42, right = w - 12, top = 12, bottom = h - 25;
  ctx.font = '11px system-ui'; ctx.setLineDash([]);
  for (const angle of [-180, -90, 0, 90, 180]) {
    const y = top + (180 - angle) / 360 * (bottom - top);
    ctx.strokeStyle = '#e6ece7'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#647776'; ctx.fillText(angle + '°', 0, y + 4);
  }
  ctx.fillText('−15 s', left, h - 3); ctx.fillText('now', right - 23, h - 3);
  arms.forEach((arm, index) => {
    ctx.strokeStyle = index ? '#4c72bd' : '#126b50'; ctx.lineWidth = 2; ctx.setLineDash(index ? [7, 4] : []); ctx.beginPath();
    let previous = null;
    for (const p of arm.history) {
      if (now - p.time > 15000) continue;
      const value = angleFor(p, axis, arm.baseline, arm.sign);
      const x = right - (now - p.time) / 15000 * (right - left), y = top + (180 - value) / 360 * (bottom - top);
      if (!previous || Math.abs(previous.value - value) > 180 || p.time - previous.time > 500) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      previous = {time: p.time, value};
    }
    ctx.stroke();
  }); ctx.setLineDash([]);
}
setInterval(() => {
  const now = performance.now(), axis = Number($('axis').value);
  for (const arm of arms) {
    const age = arm.frame ? now - arm.frame.monotonicMs : null;
    const current = arm.arrivals.filter(t => now - t < 3000);
    arm.el.count.textContent = arm.count.toLocaleString();
    arm.el.rate.textContent = current.length > 1 ? ((current.length - 1) * 1000 / (current.at(-1) - current[0])).toFixed(1) + ' Hz' : '—';
    arm.el.age.textContent = age === null ? '—' : (age / 1000).toFixed(1) + ' s';
    arm.el.health.textContent = !active(arm) ? 'Idle' : age === null ? 'Waiting' : age > 500 ? 'Stale' : 'Receiving';
    arm.el.extraAge.textContent = arm.extraAt === null ? 'No additional register sample.' : 'Register sample age: ' + ((now - arm.extraAt) / 1000).toFixed(1) + ' s';
    if (arm.sensor.status === 'connected' && age !== null) arm.el.message.textContent = age > 500 ? 'Motion data is stale; comparison paused.' : 'Receiving live motion data.';
  }
  const result = compareArms(...arms.map(arm => ({...arm, active: active(arm)})), {axis, now});
  for (const [id, key] of [['leftAngle', 'left'], ['rightAngle', 'right'], ['difference', 'difference']]) $(id).textContent = result.valid ? result[key].toFixed(1) + '°' : '—';
  $('comparisonStatus').textContent = result.valid ? 'Receive-time difference: ' + result.skewMs.toFixed(0) + ' ms · ' + (arms.some(arm => arm.demo) ? 'simulated data' : 'live data') : result.reason;
  $('plotLabel').textContent = axisNames[axis] + ' · last 15 seconds · ' + $('reference').textContent.toLowerCase();
  controls(); draw(now, axis);
}, 100);
$('support').textContent = supported ? 'Connect left, then right. Choose two different devices; disconnecting either arm leaves the other connected.' : 'Web Bluetooth unavailable here. Use Chrome / Edge over HTTPS or localhost; demo remains available.';
controls(); draw(performance.now(), 0);
window.addEventListener('pagehide', () => { clearInterval(demoTimer); arms.forEach(arm => arm.sensor.disconnect()); });
