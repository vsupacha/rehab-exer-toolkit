// Diagnostic plot with autoscaled signed XYZ, learned-axis projection and RMS.
import {DEFAULT_HIGH,DEFAULT_LOW} from './slope.js?v=20261109-32';
export function drawTrace(canvas, analysis, {unit='g',onlyY=false,axisName='Y',slope=false}={}) {
  const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  c.clearRect(0,0,w,h);c.fillStyle='#fff';c.fillRect(0,0,w,h);
  if(!analysis?.training.length)return;
  const samples=analysis.training,threshold=analysis.threshold;
  const scale=Math.max(.0005,threshold*1.2,...samples.flatMap(s=>[...s.filtered.map(Math.abs),Math.abs(s.signed),s.rms]))*1.15;
  const left=w>1000?150:80,right=w-20,top=20,bottom=h-45;
  const duration=Math.max(analysis.durationMs||8000,samples.at(-1).elapsedMs);
  const x=t=>left+t/duration*(right-left),y=v=>top+(scale-v)/(2*scale)*(bottom-top);
  c.font=(w>1000?'19':'13')+'px system-ui';c.lineWidth=1;
  if(analysis.low!==undefined){c.fillStyle='#aab5c333';c.fillRect(left,y(analysis.low),right-left,y(-analysis.low)-y(analysis.low));}
  for(const v of [-scale,-scale/2,0,scale/2,scale]){c.strokeStyle='#ddd';c.beginPath();c.moveTo(left,y(v));c.lineTo(right,y(v));c.stroke();c.fillStyle='#334';c.fillText(v.toFixed(5)+' '+unit,2,y(v)+4);}
  for(let t=0;t<=duration;t+=2000){c.fillStyle='#334';c.fillText(t/1000+' s',x(t)-8,bottom+20);}
  c.setLineDash([5,4]);c.strokeStyle='#ad3540';
  for(const v of [threshold,-threshold]){c.beginPath();c.moveTo(left,y(v));c.lineTo(right,y(v));c.stroke();}
  c.setLineDash([]);
  const lines=onlyY?[[slope?`Slope ${axisName} · EMA 50 ms / 10 จุด`:`V${axisName.toLowerCase()} · ความเร็วประมาณแกน ${axisName}`,'#16703e',s=>s.filtered[1]]]:[['X','#c63b3b',s=>s.filtered[0]],['Y','#278244',s=>s.filtered[1]],['Z','#3868c6',s=>s.filtered[2]],['แกนหลัก','#7d3fa3',s=>s.signed],['RMS','#111',s=>s.rms]];
  lines.forEach(([name,color,value],i)=>{
    c.strokeStyle=color;c.lineWidth=onlyY?3:1.6;c.beginPath();
    samples.forEach((s,j)=>{if(!j||s.elapsedMs-samples[j-1].elapsedMs>500)c.moveTo(x(s.elapsedMs),y(value(s)));else c.lineTo(x(s.elapsedMs),y(value(s)));});c.stroke();
    c.fillStyle=color;c.fillText(name,left+i*120,h-5);
  });
}
export function drawSlope(canvas,samples,high=DEFAULT_HIGH,low=DEFAULT_LOW,axis='Y',durationMs=30000){
  const training=samples.filter(s=>Number.isFinite(s.value)).map(s=>({elapsedMs:s.elapsedMs,filtered:[0,s.value,0],signed:s.value,rms:0}));
  drawTrace(canvas,{training,threshold:high,low,durationMs},{unit:'mg/s',onlyY:true,axisName:axis,slope:true});
}
export function drawVelocity(canvas,analysis){
  const data=analysis?{...analysis,training:analysis.training.map(s=>({...s,filtered:s.velocity,signed:s.velocitySigned,rms:Math.hypot(...s.velocity)}))}:null;
  drawTrace(canvas,data,{unit:'cm/s'});
}
export function drawYVelocity(canvas,samples,threshold=0){
  // Exclude X/Z and vector magnitude from autoscale so Vy is always legible.
  const training=samples.map(s=>({elapsedMs:s.elapsedMs,filtered:[0,s.y,0],signed:s.y,rms:0}));
  drawTrace(canvas,{training,threshold},{unit:'cm/s',onlyY:true});
}
export function drawAxisVelocity(canvas,samples,threshold=0,axis='Y',durationMs=12000){
  const training=samples.map(s=>({elapsedMs:s.elapsedMs,filtered:[0,s.value,0],signed:s.value,rms:0}));
  drawTrace(canvas,{training,threshold,durationMs},{unit:'cm/s',onlyY:true,axisName:axis});
}
