// Resultant acceleration |a - a_rest|, in g. Subtract the stationary gravity/bias
// vector BEFORE taking the norm. Any fixed orthogonal mounting rotation or axis
// sign/permutation leaves this norm unchanged. Re-reference after remounting.
// Rotation during a task changes gravity in sensor coordinates and can still
// register as activity; this is not world-frame gravity compensation.
// This detects activity,
// not displacement, direction or a complete out-and-back repetition.
export function restingAcceleration(frames) {
  if (frames.length < 5) throw new Error('ค้างมือจับนิ่ง รอข้อมูลอย่างน้อย 5 ตัวอย่าง');
  const vectors = frames.map(f => f.acceleration);
  if (vectors.some(v => !v || v.length !== 3 || v.some(x => !Number.isFinite(x)))) throw new Error('ยังไม่มีข้อมูลความเร่ง');
  const mean = [0,1,2].map(i => vectors.reduce((s,v) => s+v[i],0)/vectors.length);
  if (vectors.some(v => Math.hypot(...v.map((x,i) => x-mean[i])) > .03)) throw new Error('มือจับยังไม่นิ่ง กรุณาค้างแล้วบันทึกอีกครั้ง');
  return mean;
}
export class MovementTracker {
  constructor(reference, threshold = .05) {
    this.reference = reference; this.threshold = threshold; this.reset();
  }
  reset() {
    this.state='await_still'; this.lastTime=null; this.quietSince=null;
    this.started=null; this.lastActive=null; this.peak=0; this.signal=0;
    this.rawSignal=0; this.window=[];
  }
  update(frame) {
    const t=frame.monotonicMs, a=frame.acceleration;
    if (!Number.isFinite(t) || !a || a.length!==3 || a.some(x=>!Number.isFinite(x))) { this.reset(); return null; }
    if (this.lastTime!==null && (t<=this.lastTime || t-this.lastTime>500)) this.reset();
    const raw=Math.hypot(...a.map((x,i)=>x-this.reference[i]));
    // Trailing 300 ms RMS retains short acceleration/braking pulses. Weight
    // each sample by elapsed time so notification rate does not set sensitivity.
    const previous=this.lastTime; this.lastTime=t; this.rawSignal=raw;
    if(previous!==null) this.window.push({start:previous,end:t,value:raw});
    this.window=this.window.filter(sample=>sample.end>t-300);
    this.signal=Math.sqrt(this.window.reduce((sum,sample)=>sum+
      sample.value**2*(sample.end-Math.max(sample.start,t-300)),0)/300);
    // Require two supporting samples, rather than 200 ms continuously high.
    // A single isolated notification spike cannot start an activity segment.
    const evidence=this.window.filter(sample=>sample.value>=this.threshold*.6);
    const high=this.signal>=this.threshold, low=this.signal<=this.threshold*.6;
    if (this.state==='await_still') {
      if (!low) this.quietSince=null;
      else { this.quietSince ??= t; if(t-this.quietSince>=500) {this.state='ready';this.quietSince=null;} }
      return null;
    }
    if(this.state==='ready') {
      if(high && evidence.length>=2) {
        this.started=Math.max(t-300,evidence[0].start);this.lastActive=t;
        this.peak=this.signal;this.state='moving';
      }
      return null;
    }
    this.peak=Math.max(this.peak,this.signal);
    if(!low) {this.lastActive=t;this.quietSince=null;return null;}
    this.quietSince ??= t;
    if(t-this.quietSince<700) return null;
    const result={movement_s:(this.lastActive-this.started)/1000,peak_acceleration_g:this.peak,threshold_g:this.threshold};
    this.state='ready';this.started=null;this.quietSince=null;return result;
  }
}
