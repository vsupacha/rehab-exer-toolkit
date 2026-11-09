// The player must hold the handle still. These checks reject obvious motion;
// they cannot prove zero velocity from acceleration alone.
export function stationaryReference(frames){
  if(frames.length<8||frames.at(-1).monotonicMs-frames[0].monotonicMs<1000)throw new Error('ข้อมูลนิ่งยังไม่พอ ค้างมือจับแล้วเริ่มอีกครั้ง');
  frames.forEach((f,i)=>{
    if(!Number.isFinite(f.monotonicMs)||f.acceleration?.length!==3||f.acceleration.some(v=>!Number.isFinite(v)))throw new Error('ข้อมูลตั้งศูนย์ไม่สมบูรณ์ กรุณาเริ่มอีกครั้ง');
    const gap=i?f.monotonicMs-frames[i-1].monotonicMs:0;
    if(gap<0)throw new Error('เวลารับข้อมูลย้อนระหว่างตั้งศูนย์ กรุณาเริ่มอีกครั้ง');
    if(gap>500)throw new Error('ข้อมูลขาดช่วง '+gap.toFixed(0)+' ms ระหว่างตั้งศูนย์ (เกิน 500 ms) กรุณาเริ่มอีกครั้ง');
    // Coalesced BLE frames share a receipt timestamp; equality is not dropout.
    if(f.angularVelocity&&Math.hypot(...f.angularVelocity)>5)throw new Error('มือจับยังหมุนอยู่ ค้างให้นิ่งแล้วเริ่มอีกครั้ง');
  });
  const reference=[0,1,2].map(i=>frames.reduce((n,f)=>n+f.acceleration[i],0)/frames.length);
  if(frames.some(f=>Math.hypot(...f.acceleration.map((v,i)=>v-reference[i]))>.02))throw new Error('มือจับยังเคลื่อนอยู่ ค้างให้นิ่งแล้วเริ่มอีกครั้ง');
  return reference;
}
export function stationaryProfile(frames){
  const reference=stationaryReference(frames);
  const accelerationDeadbandG=[0,1,2].map(i=>{
    const residuals=frames.map(f=>Math.abs(f.acceleration[i]-reference[i])).sort((a,b)=>a-b);
    return Math.max(16/32768,residuals[Math.floor((residuals.length-1)*.95)]*2);
  });
  return {reference,accelerationDeadbandG};
}
