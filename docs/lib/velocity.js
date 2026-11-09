// Experimental sensor-frame velocity proxy. Integrate SIGNED filtered XYZ,
// never acceleration magnitude. A 3 s leak bounds drift but attenuates sustained
// velocity. Missing attitude/time sync prevents claiming physical speed accuracy.
export class VelocityEstimator {
  constructor({smoothingMs=100}={}){this.smoothingMs=smoothingMs;this.reset();}
  reset(){this.last=null;this.previous=null;this.integratedVelocity=[0,0,0];this.velocity=[0,0,0];}
  update(accelerationG,time){
    if(!Number.isFinite(time)||accelerationG?.length!==3||accelerationG.some(v=>!Number.isFinite(v))){this.reset();return [...this.velocity];}
    if(time===this.last)return [...this.velocity];
    if(this.last!==null&&(time<this.last||time-this.last>500))this.reset();
    if(this.last!==null){
      const dt=(time-this.last)/1000,decay=Math.exp(-dt/3);
      // g -> cm/s²; trapezoidal integration with time-based leakage.
      this.integratedVelocity=this.integratedVelocity.map((v,i)=>(v+(this.previous[i]+accelerationG[i])*.5*980.665*dt)*decay);
      // Time-based low-pass on signed velocity itself, shared by live detection,
      // teaching/threshold learning, CSV, charts and animation. Not display-only.
      const alpha=this.smoothingMs>0?1-Math.exp(-dt*1000/this.smoothingMs):1;
      this.velocity=this.velocity.map((v,i)=>v+alpha*(this.integratedVelocity[i]-v));
    }
    this.last=time;this.previous=[...accelerationG];return [...this.velocity];
  }
}
export function velocityAcceleration(vector,deadband=[0,0,0]){
  return vector.map((v,i)=>Math.sign(v)*Math.max(0,Math.abs(v)-(deadband[i]||0)));
}
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
export function manualVelocityThreshold(cal,threshold){
  if(!Number.isFinite(threshold)||threshold<=0||threshold>1000)throw new RangeError('กำหนด threshold มากกว่า 0 ถึง 1000 cm/s');
  return {...cal,threshold,directionThreshold:threshold,thresholdMode:'manual'};
}
export function velocityCalibration(cal,{axis:axisChoice='auto',reverse=false}={}){
  if(!['auto','X','Y','Z'].includes(axisChoice))throw new RangeError('Choose auto, X, Y or Z.');
  const estimator=new VelocityEstimator();
  const training=cal.training.map(s=>({...s,accelerationFiltered:s.filtered,velocity:estimator.update(velocityAcceleration(s.filtered,cal.accelerationDeadbandG),s.elapsedMs)}));
  const vectors=training.filter(s=>s.elapsedMs>=500).map(s=>s.velocity);
  if(!vectors.length)vectors.push([0,0,0]);
  const covariance=[0,1,2].map(i=>[0,1,2].map(j=>vectors.reduce((n,v)=>n+v[i]*v[j],0)/vectors.length));
  const largest=[0,1,2].reduce((a,b)=>covariance[b][b]>covariance[a][a]?b:a,0);
  let axis=[0,0,0];axis[largest]=1;
  for(let i=0;i<25;i++){const next=covariance.map(v=>dot(v,axis)),length=Math.hypot(...next);if(length<1e-12)break;axis=next.map(v=>v/length);}
  if(axisChoice!=='auto')axis=[0,1,2].map(i=>i==='XYZ'.indexOf(axisChoice)?1:0);
  if(reverse)axis=axis.map(v=>-v);
  const total=covariance.reduce((n,v,i)=>n+v[i],0),axisConfidence=total>1e-12?dot(axis,covariance.map(v=>dot(v,axis)))/total:0;
  const p80=values=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*.8)];
  const amplitude=p80(vectors.map(v=>Math.abs(dot(v,axis))));
  const magnitudeAmplitude=axisChoice==='auto'?p80(vectors.map(v=>Math.hypot(...v))):amplitude;
  const threshold=Math.max(.01,amplitude*.25);
  let sign=0,reversals=0;
  training.forEach(s=>{s.velocitySigned=dot(s.velocity,axis);const next=Math.abs(s.velocitySigned)>=threshold?Math.sign(s.velocitySigned):0;if(next){if(sign&&next!==sign)reversals++;sign=next;}});
  return {...cal,velocityMode:true,axisChoice,reverse,accelerationAxis:cal.axis,axis,axisConfidence,amplitude,magnitudeAmplitude,threshold,directionThreshold:threshold,reversals,training,noiseFloor:0,usable:magnitudeAmplitude>=.01,directionReliable:(axisChoice!=='auto'||axisConfidence>=.65)&&reversals>=2};
}
