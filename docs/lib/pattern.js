import {VelocityEstimator,velocityAcceleration} from './velocity.js?v=20261109-21';
// Continuous teaching: filtered magnitude plus signed principal acceleration.
// Sign denotes acceleration along the learned sensor axis, NOT travel direction.
const norm=v=>Math.hypot(...v);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const quantile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)];
function valid(f){return Number.isFinite(f.monotonicMs)&&f.acceleration?.length===3&&f.acceleration.every(Number.isFinite);}
class Filter {
  constructor(reference=null){this.gravity=reference&&[...reference];this.vector=[0,0,0];this.last=null;this.energy=0;this.raw=0;}
  update(f){
    const dt=this.last===null?50:f.monotonicMs-this.last;this.last=f.monotonicMs;
    this.gravity??=[...f.acceleration];
    const slow=1-Math.exp(-dt/1500),fast=1-Math.exp(-dt/80);
    const delta=f.acceleration.map((v,i)=>v-this.gravity[i]);this.raw=norm(delta);
    this.gravity=this.gravity.map((v,i)=>v+slow*(f.acceleration[i]-v));
    this.vector=this.vector.map((v,i)=>v+fast*(delta[i]-v));
    const envelope=1-Math.exp(-dt/250);
    this.energy+=envelope*(dot(this.vector,this.vector)-this.energy);
    return [...this.vector];
  }
}
export function learnPattern(frames,start,options={}){
  if(frames.length<20||frames[0].monotonicMs>start+500||frames.at(-1).monotonicMs<start+11500)throw new Error('ข้อมูลไม่ครบ 12 วินาที ลองสอนใหม่');
  frames.forEach((f,i)=>{if(!valid(f))throw new Error('ข้อมูลระหว่างสอนไม่สมบูรณ์');const gap=i?f.monotonicMs-frames[i-1].monotonicMs:0;if(gap<0||gap>500)throw new Error('เวลารับข้อมูลต่าง '+gap.toFixed(0)+' ms ระหว่างสอน กรุณาเชื่อมต่อแล้วลองใหม่');});
  return inspectMovement(frames,start,options);
}
export function inspectMovement(frames,start,options={}){
  frames=frames.filter(valid).filter((f,i,list)=>!i||f.monotonicMs!==list[i-1].monotonicMs);
  if(!frames.length)return null;
  const filter=new Filter(options.reference),vectors=[],training=[];
  for(const f of frames){if(filter.last!==null && (f.monotonicMs<=filter.last || f.monotonicMs-filter.last>500)){filter.gravity=null;filter.last=null;filter.vector=[0,0,0];filter.energy=0;}const v=filter.update(f);training.push({elapsedMs:f.monotonicMs-start,acceleration:[...f.acceleration],filtered:v,rms:Math.sqrt(Math.max(0,filter.energy))});if(f.monotonicMs>=start+500)vectors.push(v);}
  if(!vectors.length)vectors.push(...training.map(s=>s.filtered));
  const covariance=Array.from({length:3},(_,i)=>[0,1,2].map(j=>vectors.reduce((s,v)=>s+v[i]*v[j],0)/vectors.length));
  const largest=[0,1,2].reduce((a,b)=>covariance[b][b]>covariance[a][a]?b:a,0);
  let axis=[0,0,0];axis[largest]=1;
  for(let n=0;n<25;n++){const next=covariance.map(row=>dot(row,axis)),length=norm(next);if(length<1e-12)break;axis=next.map(v=>v/length);}
  const signed=vectors.map(v=>dot(v,axis)),amplitude=quantile(signed.map(Math.abs),.8);
  const totalEnergy=covariance.reduce((s,row,i)=>s+row[i],0);
  const axisConfidence=totalEnergy>1e-12?dot(axis,covariance.map(row=>dot(row,axis)))/totalEnergy:0;
  const magnitudeAmplitude=quantile(training.filter(s=>s.elapsedMs>=500).map(s=>s.rms),.8)||0;

  const directionThreshold=Math.max(.0002,amplitude*.25);
  const signs=signed.filter(v=>Math.abs(v)>=directionThreshold).map(v=>Math.sign(v));
  const reversals=signs.reduce((n,v,i)=>n+(i>0&&v!==signs[i-1]?1:0),0);
  const directionReliable=axisConfidence>=.65&&amplitude>=.0004&&reversals>=2;
  const usable=magnitudeAmplitude>=.0004;
  const warning=amplitude<.0004?'สัญญาณใกล้ระดับความละเอียดเซนเซอร์ ยังยืนยันทิศทางไม่ได้':reversals<2?'ยังไม่พบการสลับเครื่องหมายเพียงพอ':amplitude<.003?'สัญญาณเบา เก็บข้อมูลแล้ว โปรดตรวจกราฟก่อนใช้งาน':'';
  const reference=options.reference||[0,1,2].map(i=>frames.reduce((s,f)=>s+f.acceleration[i],0)/frames.length);
  training.forEach(s=>{s.signed=dot(s.filtered,axis);});
  return {reference,accelerationDeadbandG:options.accelerationDeadbandG,axis,axisConfidence,directionReliable,magnitudeAmplitude,usable,warning,threshold:directionThreshold,directionThreshold,amplitude,reversals,
    training};
}
export function sensitivityCalibration(cal, sensitivity=1) {
  if(!Number.isFinite(sensitivity)||sensitivity<.25||sensitivity>4)throw new RangeError('Sensitivity must be 0.25–4');
  // Sensitivity cannot turn signals below measured stationary noise into evidence.
  const threshold=Math.max(cal.threshold/sensitivity,(cal.noiseFloor||0)*1.5);
  const signed=s=>cal.velocityMode?s.velocitySigned:s.signed;
  const signs=cal.training.filter(s=>s.elapsedMs>=500 && Math.abs(signed(s))>=threshold).map(s=>Math.sign(signed(s)));
  const reversals=signs.reduce((n,v,i)=>n+(i>0&&v!==signs[i-1]?1:0),0);
  const usable=cal.magnitudeAmplitude>=Math.max((cal.velocityMode?.01:.0004)/sensitivity,(cal.noiseFloor||0)*1.5);
  return {...cal,threshold,directionThreshold:threshold,usable,reversals,sensitivity};
}
export class PatternTracker {
  constructor(cal){this.cal=cal;this.threshold=cal.threshold;this.reset();}
  reset(){this.filter=new Filter(this.cal.reference);this.velocityEstimator=new VelocityEstimator();this.velocity=[0,0,0];this.lastTime=null;this.firstTime=null;this.state='ready';this.started=null;this.sign=0;this.pendingSign=0;this.pendingSince=null;this.reversals=0;this.peak=0;this.quietSince=null;this.signed=0;}
  get signal(){return this.cal.velocityMode?(this.cal.axisChoice&&this.cal.axisChoice!=='auto'?Math.abs(this.signed):Math.hypot(...this.velocity)):Math.sqrt(Math.max(0,this.filter.energy));}
  get rawSignal(){return this.filter.raw;}
  update(frame){
    const t=frame.monotonicMs;
    if(!valid(frame)){this.reset();return null;}
    // No sensor timestamp in this packet. Do not invent spacing within batches
    // or reset the integrator when multiple frames have equal host receipt time.
    if(t===this.lastTime)return null;
    if(this.lastTime!==null&&(t<this.lastTime||t-this.lastTime>500))this.reset();
    this.lastTime=t;this.firstTime??=t;
    const acceleration=this.filter.update(frame);
    this.velocity=this.velocityEstimator.update(velocityAcceleration(acceleration,this.cal.accelerationDeadbandG),t);
    this.signed=dot(this.cal.velocityMode?this.velocity:acceleration,this.cal.axis);
    if(t-this.firstTime<500)return null;
    // When no clear axis emerges, time magnitude activity without fabricating
    // directional reversals or claiming full physical repetitions.
    if(!this.cal.directionReliable) {
      if(this.signal>=this.threshold) {
        this.started??=t;this.quietSince=null;this.peak=Math.max(this.peak,this.signal);
        if(t-this.started>=150)this.state='moving';
      } else if(this.signal<this.threshold*.6 && this.started!==null) {
        this.quietSince??=t;
        if(t-this.quietSince>=700) {
          const result=this.state==='moving'?{movement_s:(this.quietSince-this.started)/1000,peak_acceleration_g:this.peak,threshold_g:this.threshold,direction_changes:null,sensitivity:this.cal.sensitivity||1,measurement:'filtered_magnitude_activity'}:null;
          if(result&&this.cal.velocityMode){result.peak_velocity_cm_s=result.peak_acceleration_g;delete result.peak_acceleration_g;result.threshold_cm_s=this.threshold;delete result.threshold_g;result.measurement='estimated_velocity_activity';}
          this.started=null;this.quietSince=null;this.peak=0;this.state='ready';return result;
        }
      } else this.quietSince=null;
      return null;
    }
    const direction=this.signal>=this.threshold&&Math.abs(this.signed)>=this.cal.directionThreshold?Math.sign(this.signed):0;
    if(!direction){
      this.pendingSign=0;this.pendingSince=null;
      if(this.signal<this.threshold*.6){this.quietSince??=t;if(t-this.quietSince>=1500){this.sign=0;this.reversals=0;this.started=null;this.state='ready';}}
      return null;
    }
    this.quietSince=null;this.peak=Math.max(this.peak,this.signal);
    if(direction!==this.pendingSign){this.pendingSign=direction;this.pendingSince=t;return null;}
    if(t-this.pendingSince<80||direction===this.sign)return null;
    this.state='moving';
    if(!this.sign){this.sign=direction;this.started=this.pendingSince;this.peak=this.signal;return null;}
    this.sign=direction;this.reversals++;
    if(this.reversals<2)return null;
    const result={movement_s:(this.pendingSince-this.started)/1000,peak_acceleration_g:this.peak,threshold_g:this.threshold,direction_changes:2,sensitivity:this.cal.sensitivity||1};
    if(this.cal.velocityMode){result.peak_velocity_cm_s=result.peak_acceleration_g;delete result.peak_acceleration_g;result.threshold_cm_s=this.threshold;delete result.threshold_g;result.measurement='estimated_velocity_reversals';}
    this.reversals=0;this.started=this.pendingSince;this.peak=this.signal;return result;
  }
}
