// Offline only. No browser, BLE, hardware writes or production algorithm edits.
// node tools/audit_teaching.mjs INPUT.csv OUTPUT_DIRECTORY
import fs from 'node:fs';
import path from 'node:path';
import {VelocityEstimator,velocityAcceleration} from '../docs/lib/velocity.js';
const [input,out]=process.argv.slice(2);
if(!input||!out)throw new Error('Usage: node tools/audit_teaching.mjs INPUT.csv OUTPUT_DIRECTORY');
const lines=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/);
const header=lines.shift().split(',');
const rows=lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[header[i],v])));
const required=['elapsed_ms','ay_g','filtered_y_g','vy_est_cm_s'];
for(const key of required)if(!header.includes(key))throw new Error('Missing column: '+key);
const summaries=[],outputs=[];
for(const arm of [...new Set(rows.map(r=>r.arm))]){
  const data=rows.filter(r=>r.arm===arm);
  const t=data.map(r=>Number(r.elapsed_ms)),a=data.map(r=>Number(r.filtered_y_g));
  if(t.some((v,i)=>!Number.isFinite(v)||(i&&v<=t[i-1])))throw new Error('Audit needs distinct increasing receive times');
  if(data.some(r=>required.some(k=>!Number.isFinite(Number(r[k])))))throw new Error('Non-finite input');
  const max=Math.max(...a.map(Math.abs));
  // This is fitted ONLY to demonstrate the erasure mechanism. It is NOT a
  // reconstructed/measured actual zero-calibration deadband.
  const illustrativeDeadband=max+1e-12;
  const replay=new VelocityEstimator(),erasure=new VelocityEstimator();
  let integral=0,previous=0;
  const samples=data.map((r,i)=>{
    const dt=i?(t[i]-t[i-1])/1000:0;
    if(i)integral+=(previous+a[i])*.5*980.665*dt;
    previous=a[i];
    const velocity=replay.update([0,a[i],0],t[i])[1];
    const erased=erasure.update(velocityAcceleration([0,a[i],0],[0,illustrativeDeadband,0]),t[i])[1];
    const elapsed=(t[i]-t[0])/1000,biasError=16/32768*980.665*elapsed;
    return {arm,t_s:t[i]/1000,raw_ay_g:Number(r.ay_g),filtered_ay_g:a[i],recorded_vy_cm_s:Number(r.vy_est_cm_s),
      replay_no_deadband_cm_s:velocity,illustrative_erasure_cm_s:erased,
      trapezoid_filtered_no_leak_cm_s:integral,plus_one_lsb_bias_cm_s:integral+biasError,minus_one_lsb_bias_cm_s:integral-biasError};
  });
  const stats=values=>({min:Math.min(...values),max:Math.max(...values),rms:Math.sqrt(values.reduce((s,v)=>s+v*v,0)/values.length),nonzero:values.filter(v=>v!==0).length});
  const deltas=t.slice(1).map((v,i)=>v-t[i]);
  summaries.push({arm,samples:data.length,duration_s:(t.at(-1)-t[0])/1000,receipt_hz:(t.length-1)*1000/(t.at(-1)-t[0]),max_gap_ms:Math.max(...deltas),
    filtered_Y_g:stats(a),recorded_velocity:stats(samples.map(s=>s.recorded_vy_cm_s)),
    replay_no_deadband:stats(samples.map(s=>s.replay_no_deadband_cm_s)),
    illustrative_deadband_g:illustrativeDeadband,illustrative_erasure:stats(samples.map(s=>s.illustrative_erasure_cm_s)),
    unconstrained_integral:stats(samples.map(s=>s.trapezoid_filtered_no_leak_cm_s)),one_lsb_bias_final_error_cm_s:samples.at(-1).plus_one_lsb_bias_cm_s-samples.at(-1).trapezoid_filtered_no_leak_cm_s});
  outputs.push(...samples);
}
const summary={inputName:path.basename(input),scope:'offline algorithm audit; no physical velocity ground truth',summaries,
  missingMetadata:['stationary zero reference','actual per-axis deadband','orientation/gyro trace','sensor sample timestamps','processing version/settings'],
  conclusions:['Recorded zero is not due to missing Y acceleration or receipt gaps in this capture.',
    'Replay without the deadband produces nonzero output; a fitted deadband reproduces exact zero but does not establish the actual device-session deadband.',
    'Removing suppression does not establish true velocity; prior filtered acceleration already includes adaptive gravity removal.',
    'One-LSB constant bias sensitivity is a hypothetical error bound comparison, not a measured bias.']};
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
const columns=Object.keys(outputs[0]);fs.writeFileSync(path.join(out,'replay.csv'),[columns.join(','),...outputs.map(row=>columns.map(k=>row[k]).join(','))].join('\n'));
console.log(JSON.stringify(summary,null,2));
