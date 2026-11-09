// Keep an unapplied numeric draft separate from the periodic sensor display.
export class ThresholdInputState {
  constructor(){this.value=null;this.draft=null;}
  edit(text){this.draft=text;}
  display(automatic){return this.draft!==null?this.draft:String(this.value??automatic);}
  apply(){
    const value=Number(this.draft);
    if(this.draft===null||this.draft.trim()===''||!Number.isFinite(value)||value<=0||value>1000)throw new RangeError('กำหนด threshold เป็นตัวเลขมากกว่า 0 ถึง 1000');
    this.value=value;this.draft=null;return value;
  }
  reset(){this.value=null;this.draft=null;}
}
// Validate the pair before committing either value; drafts survive failed Apply.
export function applyThresholdPair(highSetting,lowSetting,highText,lowText){
  const highDraft=highSetting.draft??String(highText),lowDraft=lowSetting.draft??String(lowText);
  const high=Number(highDraft),low=Number(lowDraft);
  if(!highDraft.trim()||!lowDraft.trim()||!Number.isFinite(high)||!Number.isFinite(low)||low<=0||high>1000||high<=low)throw new RangeError('กำหนด 0 < Low < High ≤ 1000 mg/s');
  highSetting.edit(highDraft);lowSetting.edit(lowDraft);highSetting.apply();lowSetting.apply();
  return {high,low};
}
export const defaultVelocityAxis=motion=>motion==='lift'?'X':'Y';
// Cursor encodes signed velocity, not integrated displacement. Time-based
// interpolation gives smooth feedback at display refresh rate, even at 10 Hz BLE.
export class VelocityVisual {
  constructor(){this.position=.5;this.time=null;}
  update(velocity,scale,time,active=true){
    const dt=this.time===null?16:Math.max(0,Math.min(100,time-this.time));this.time=time;
    const target=active&&Number.isFinite(velocity)?.5+.45*Math.tanh(velocity/Math.max(.1,scale)):.5;
    this.position+=(1-Math.exp(-dt/120))*(target-this.position);
    return this.position;
  }
}
