// Decorative motion only: nozzle position is not an IMU displacement estimate.
export const NOZZLE_PERIOD_MS=4400;
export class WateringVisual {
  constructor(){this.reset();}
  reset(){this.time=null;this.phase=0;this.position=.5;}
  update({time,active,state}){
    const dt=this.time===null?0:Math.max(0,Math.min(100,time-this.time));this.time=time;
    const moving=Boolean(active)&&state==='moving',watering=Boolean(active)&&state==='rest';
    if(moving){this.phase+=dt;this.position=.5+.32*Math.sin(this.phase*2*Math.PI/NOZZLE_PERIOD_MS);}
    return {position:this.position,moving,watering,feedback:moving?'moving':watering?'watering':'idle'};
  }
}
const plantKinds=[['🌱','ต้นอ่อน'],['🌷','ทิวลิป'],['🌼','เดซี่'],['🌻','ทานตะวัน'],['🌹','กุหลาบ'],['🌺','ชบา'],['🌵','กระบองเพชร']];
export class PlantRewards {
  constructor({goal=5}={}){
    if(!Number.isInteger(goal)||goal<1||goal>30)throw new RangeError('ตั้งเป้าต้นไม้ 1–30 ต้น');
    this.goal=goal;this.earned=[];this.row=0;this.awardedThisStop=false;this.spawnRow();
  }
  get complete(){return this.earned.length>=this.goal;}
  spawnRow(){
    const count=Math.min(7,this.goal-this.earned.length),offset=this.earned.length;this.row++;
    this.radius=count===1?.08:Math.min(.06,.45*.6/(count-1));
    this.plants=Array.from({length:count},(_,i)=>({id:offset+i,emoji:plantKinds[(offset+i)%plantKinds.length][0],name:plantKinds[(offset+i)%plantKinds.length][1],position:count===1?.5:.2+.6*i/(count-1),collected:false}));
  }
  targetAt(position){
    if(!Number.isFinite(position)||!this.plants.length)return null;
    // Include collected slots so an empty space cannot select its neighbour.
    const target=this.plants.reduce((a,b)=>Math.abs(a.position-position)<=Math.abs(b.position-position)?a:b);
    return Math.abs(target.position-position)<=this.radius?target:null;
  }
  update({position,moving,watering}){
    if(this.complete)return null;
    if(moving){
      this.awardedThisStop=false;
      if(this.plants.every(p=>p.collected))this.spawnRow();
      return null;
    }
    if(!watering||this.awardedThisStop)return null;
    const plant=this.targetAt(position);
    if(!plant||plant.collected)return null;
    plant.collected=true;this.awardedThisStop=true;
    const reward={...plant,row:this.row};this.earned.push(reward);return reward;
  }
}
