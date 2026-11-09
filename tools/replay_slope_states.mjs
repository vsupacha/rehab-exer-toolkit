import fs from 'node:fs';
import path from 'node:path';
import {SlopeStateMachine} from './slope_state_machine.mjs';
const folder=process.argv[2]||'../algorithm-analysis/capture-2';
const lines=fs.readFileSync(path.join(folder,'ay-ema-slope-10point.csv'),'utf8').trim().split(/\r?\n/),head=lines.shift().split(',');
const rows=lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[head[i],v])));
const summaries=[],trace=[],events=[],sweep=[];
for(const tau of [0,50,100,200,300,500]){
  const key=(tau===0?'raw':`ema_${tau}ms`)+'_ay_slope_g_per_s';
  const data=rows.filter(r=>r[key]!=='').map(r=>({time:Number(r.elapsed_s)*1000,value:Number(r[key])*1000}));
  const fsm=new SlopeStateMachine();const detected=[];
  for(const r of data){const event=fsm.update(r.value,r.time);if(event){detected.push(event);events.push({ema_ms:tau,...event});}trace.push({ema_ms:tau,time_s:r.time/1000,slope_mg_per_s:r.value,state:fsm.state,count:fsm.count});}
  summaries.push({ema_ms:tau,completed_signal_cycles:fsm.count,last_state:fsm.state,partial_unscored:fsm.state!=='rest',transitions:detected});
  for(const high of [1,1.5,2])for(const low of [.3,.5,.8]){
    const machine=new SlopeStateMachine({high,low});for(const r of data)machine.update(r.value,r.time);
    sweep.push({ema_ms:tau,high_mg_per_s:high,low_mg_per_s:low,count:machine.count,last_state:machine.state});
  }
}
for(const [file,data] of [['slope-fsm-trace.csv',trace],['slope-fsm-events.csv',events],['slope-fsm-threshold-sweep.csv',sweep]]){
  const keys=Object.keys(data[0]);fs.writeFileSync(path.join(folder,file),[keys.join(','),...data.map(r=>keys.map(k=>r[k]).join(','))].join('\n'));
}
const result={method:'rest -> moving -> rest (absolute slope)',unit:'mg/s',high:1.5,low:.5,transition_hold_ms:150,rest_hold_ms:200,
  initial_rest:'assumed, not observed; slope unavailable for first9 samples',
  limitation:'Low slope is not proof of physical rest/home; a bout does not require a return to the original handle position.',summaries};
fs.writeFileSync(path.join(folder,'slope-fsm-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
