/** Local PNG composition: one flattened image containing scene and photograph. */
export function photoRect(width, height, photoWidth, photoHeight) {
  if (![width,height,photoWidth,photoHeight].every(n => Number.isFinite(n) && n > 0)) throw new Error('ขนาดภาพไม่ถูกต้อง');
  const w = Math.min(width * .25, height * .6 * photoWidth / photoHeight);
  const h = w * photoHeight / photoWidth;
  return {x:(width-w)/2,y:height-h-45,width:w,height:h};
}
function loadPhoto(url) {
  return new Promise((resolve,reject) => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('อ่านภาพถ่ายไม่ได้ กรุณาถ่ายภาพใหม่'));
    image.src = url;
  });
}
export async function makePostcard(scene, photo, {canvasFactory=()=>document.createElement('canvas'),imageLoader=loadPhoto}={}) {
  if (!scene || !photo?.url) throw new Error('ต้องมีภาพถ่ายและเล่นครบเป้าหมายก่อน');
  const image = await imageLoader(photo.url);
  const canvas = canvasFactory(); canvas.width=1600; canvas.height=900;
  const c=canvas.getContext('2d'), w=canvas.width,h=canvas.height;
  const gradient=c.createLinearGradient(0,0,0,h); gradient.addColorStop(0,'#e2eff1'); gradient.addColorStop(1,'#edf4e7');
  c.fillStyle=gradient;c.fillRect(0,0,w,h);
  c.fillStyle='#ffffffb3';for(const [x,y] of [[180,150],[1010,200]]) { c.beginPath();c.ellipse(x,y,90,25,0,0,Math.PI*2);c.fill();c.beginPath();c.arc(x-15,y-25,36,0,Math.PI*2);c.fill(); }
  c.fillStyle='#e5b541';c.font='80px system-ui';c.fillText('☀',1400,155);
  c.fillStyle='#226e51';c.font='600 40px system-ui';c.textAlign='center';c.fillText('สวนพลังแขน · ครบเป้าหมายแล้ว!',w/2,70);
  const mode={spread:['เปิดประตูสวน','🌱'],lift:['ยกหยดน้ำ','💧'],twist:['หมุนรับแสง','🌻']}[scene.motion];
  if (!mode) throw new Error('ไม่พบรูปแบบเกม');
  c.fillStyle='#506c61';c.font='26px system-ui';c.fillText((scene.plants?'รดน้ำให้สวน':mode[0])+' · '+scene.goal+(scene.plants?' ต้นที่รดน้ำ':scene.measurement==='acceleration_activity'?' ช่วงการเคลื่อนไหว':' รอบ'),w/2,115);
  c.font='24px system-ui';
  for(const [index,name] of ['ซ้าย','ขวา'].entries()) {
    const color=index ? '#497ba6':'#226e51',y=300+index*105;
    c.textAlign='left';c.fillStyle=color;c.fillText(name,100,y+8);
    c.strokeStyle=index?'#c9d9e2':'#c3d8c7';c.lineWidth=15;c.lineCap='round';c.beginPath();
    if(scene.motion==='lift') {const x=440+index*720;c.moveTo(x,255);c.lineTo(x,420);c.stroke();c.font='58px system-ui';c.fillText(mode[1],x-30,300);}
    else {c.moveTo(240,y);c.lineTo(1350,y);c.stroke();c.font='58px system-ui';c.fillText(mode[1],index?260:1280,y+18);}
    c.font='22px system-ui';c.textAlign='right';c.fillStyle=color;c.fillText((index ? 'right':'left') === scene.leader ? 'ครบเป้าหมาย' : 'เคลื่อนตาม',1500,y+8);
  }
  c.fillStyle='#b4cda1';c.beginPath();c.ellipse(w/2,h+10,w*.65,110,0,0,Math.PI*2);c.fill();
  c.font='38px system-ui';c.textAlign='left';for(let i=0;i<Math.min(scene.plants?scene.plants.length:scene.goal,30);i++) c.fillText(scene.plants?scene.plants[i].emoji:'🌷',55+i*49,h-35);
  const r=photoRect(w,h,image.naturalWidth||image.width,image.naturalHeight||image.height);
  c.save();c.shadowColor='#32583d44';c.shadowBlur=24;c.shadowOffsetY=8;c.fillStyle='white';c.fillRect(r.x-8,r.y-8,r.width+16,r.height+16);c.restore();
  c.drawImage(image,r.x,r.y,r.width,r.height);
  c.fillStyle='#ffffffdd';c.fillRect(w/2-110,r.y-40,220,30);c.fillStyle='#226e51';c.textAlign='center';c.font='18px system-ui';c.fillText(scene.measurement==='acceleration_activity'?'ภาพการเคลื่อนไหว':'ท่ายืดสุดของฉัน',w/2,r.y-18);
  c.textAlign='left';c.font='18px system-ui';c.fillStyle='#466356';
  c.fillText(scene.source==='demo'?'ภาพจากเกมข้อมูลจำลอง':'Arm Booster · ภาพความสำเร็จ',30,h-12);
  c.textAlign='right';c.fillText(new Date(scene.at).toLocaleString('th-TH'),w-30,h-12);
  return canvas.toDataURL('image/png');
}
