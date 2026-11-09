export const SLOPE_POINTS = 10;
export const EMA_TAU_MS = 50;

export class SlopeStateMachine {
  constructor({high=1.5,low=.5,transitionMs=150,restMs=200,maxGapMs=500}={}){
    if(!Number.isFinite(high)||!Number.isFinite(low)||!(high>low&&low>=0))throw new RangeError('เกณฑ์เข้า ต้องมากกว่าเกณฑ์พัก และเกณฑ์พักต้องไม่ติดลบ');
    Object.assign(this,{high,low,transitionMs,restMs,maxGapMs});this.count=0;this.reset();
  }
  reset(){this.state='rest';this.last=null;this.pending=null;this.since=null;}
  update(slope,time){
    if(!Number.isFinite(slope)||!Number.isFinite(time)){this.reset();return null;}
    if(time===this.last)return null;
    if(this.last!==null&&(time<this.last||time-this.last>this.maxGapMs))this.reset();
    this.last=time;const magnitude=Math.abs(slope);
    const next=this.state==='rest'&&magnitude>=this.high?'moving':this.state==='moving'&&magnitude<=this.low?'rest':null;
    if(!next){this.pending=null;this.since=null;return null;}
    if(next!==this.pending){this.pending=next;this.since=time;return null;}
    if(time-this.since<(next==='rest'?this.restMs:this.transitionMs))return null;
    const event={time_ms:time,confirmed_from_ms:this.since,from:this.state,to:next,slope_mg_per_s:slope,completed:next==='rest'};
    if(event.completed)this.count++;
    this.state=next;this.pending=null;this.since=null;return {...event,count:this.count};
  }
}
export function slopeConfig(cal,{axis='Y',reverse=false,high=1.5,low=.5}={}){
  if(!['X','Y','Z'].includes(axis))throw new RangeError('เลือกแกน X, Y หรือ Z');
  new SlopeStateMachine({high,low});
  return {...cal,axisChoice:axis,axis:[0,1,2].map(i=>i==='XYZ'.indexOf(axis)?1:0),reverse,high,low,threshold:high,reference:[0,0,0],usable:Boolean(cal?.usable)};
}
export class SlopeTracker {
  constructor(cal){this.cal=cal;this.threshold=cal.high;this.lowThreshold=cal.low;this.reset();}
  setThresholds({high,low}){
    const cal=slopeConfig(this.cal,{axis:this.cal.axisChoice,reverse:this.cal.reverse,high,low});
    const count=this.fsm.count;
    this.cal=cal;this.threshold=high;this.lowThreshold=low;
    this.fsm=new SlopeStateMachine({high,low});this.fsm.count=count;
    this.started=null;this.peak=0;
  }
  reset(){this.fsm=new SlopeStateMachine({high:this.cal.high,low:this.cal.low});this.filtered=null;this.slopes=null;this.window=[];this.last=null;this.signed=0;this.started=null;this.peak=0;this.ready=false;}
  get state(){return this.fsm.state;}
  get signal(){return Math.abs(this.signed);}
  update(frame){
    const time=frame.monotonicMs,a=frame.acceleration;
    if(!Number.isFinite(time)||a?.length!==3||a.some(v=>!Number.isFinite(v))){this.reset();return null;}
    if(time===this.last)return null;
    if(this.last!==null&&(time<this.last||time-this.last>500))this.reset();
    const dt=this.last===null?0:time-this.last;this.last=time;
    this.filtered=this.filtered?this.filtered.map((v,i)=>v+(1-Math.exp(-dt/EMA_TAU_MS))*(a[i]-v)):[...a];
    this.window.push({time,a:[...this.filtered]});if(this.window.length>SLOPE_POINTS)this.window.shift();
    if(this.window.length<SLOPE_POINTS)return null;
    const origin=this.window[0].time,times=this.window.map(s=>(s.time-origin)/1000),mean=times.reduce((n,v)=>n+v,0)/this.window.length;
    const centered=times.map(v=>v-mean),denom=centered.reduce((n,v)=>n+v*v,0);
    if(denom<=0)return null;
    this.slopes=[0,1,2].map(axis=>{const avg=this.window.reduce((n,s)=>n+s.a[axis],0)/this.window.length;return this.window.reduce((n,s,i)=>n+centered[i]*(s.a[axis]-avg),0)/denom*1000;});
    this.ready=true;this.signed=this.slopes['XYZ'.indexOf(this.cal.axisChoice)]*(this.cal.reverse?-1:1);
    const event=this.fsm.update(this.signed,time);this.peak=Math.max(this.peak,Math.abs(this.signed));
    if(event?.to==='moving'){this.started=event.confirmed_from_ms;this.peak=Math.abs(this.signed);}
    if(!event?.completed)return null;
    const result={measurement:'slope_activity_bout',cycle_s:(time-this.started)/1000,movement_s:(time-this.started)/1000,peak_slope_mg_s:this.peak,
      high_slope_mg_s:this.cal.high,low_slope_mg_s:this.cal.low,axis:this.cal.axisChoice,reverse:this.cal.reverse};
    this.started=null;this.peak=0;return result;
  }
}
export function inspectSlope(frames,start,options={}){
  const cal=slopeConfig({usable:true},options),tracker=new SlopeTracker(cal),training=[];
  for(const f of frames){if(f.monotonicMs===tracker.last)continue;tracker.update(f);if(!tracker.filtered)continue;training.push({elapsedMs:f.monotonicMs-start,acceleration:[...f.acceleration],filtered:[...tracker.filtered],slopes:tracker.slopes&&[...tracker.slopes],signed:tracker.ready?tracker.signed:null,state:tracker.state});}
  return {...cal,training,state:tracker.state,count:tracker.fsm.count,usable:training.filter(s=>s.slopes).length>=10,amplitude:Math.max(1.5,...training.map(s=>Math.abs(s.signed||0)))};
}
export function learnSlope(frames,start,options={}){
  if(frames.length<20||frames[0].monotonicMs>start+500||frames.at(-1).monotonicMs<start+29500)throw new Error('ต้องเก็บข้อมูลครบ 30 วินาที');
  frames.forEach((f,i)=>{const dt=i?f.monotonicMs-frames[i-1].monotonicMs:0;if(!Number.isFinite(f.monotonicMs)||f.acceleration?.length!==3||f.acceleration.some(v=>!Number.isFinite(v))||dt<0||dt>500)throw new Error('ข้อมูลขาดช่วงระหว่าง Cal กรุณาทำใหม่');});
  return inspectSlope(frames,start,options);
}
