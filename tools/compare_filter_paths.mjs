// node tools/compare_filter_paths.mjs INPUT.csv OUTPUT_DIRECTORY
import fs from 'node:fs';
import path from 'node:path';
import {compareFilters} from './filter_experiments.mjs';
const [input,out]=process.argv.slice(2);if(!input||!out)throw new Error('Need input CSV and output directory');
const lines=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/),headers=lines.shift().split(',');
const source=lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[headers[i],v])));
const summaries=[],rows=[];
for(const arm of [...new Set(source.map(r=>r.arm))]){
  const data=source.filter(r=>r.arm===arm),samples=data.map(r=>({timeMs:Number(r.elapsed_ms),ayG:Number(r.ay_g)}));
  const experiment=compareFilters(samples);
  // Same two paths using a second common reference, to expose baseline uncertainty.
  // First second might contain motion, so this is NOT a validated rest reference.
  const firstSecond=samples.filter(s=>s.timeMs-samples[0].timeMs<=1000);
  const alternate=compareFilters(samples,{referenceY:firstSecond.reduce((n,s)=>n+s.ayG,0)/firstSecond.length});
  const keys=['velocity_acceleration_filter_only_cm_s','velocity_velocity_filter_only_cm_s','velocity_no_filter_cm_s','velocity_both_filters_cm_s'];
  const stats=values=>({min:Math.min(...values),max:Math.max(...values),final:values.at(-1),roughness_rms_difference:Math.sqrt(values.slice(1).reduce((n,v,i)=>n+(v-values[i])**2,0)/(values.length-1))});
  const paths=Object.fromEntries(keys.map(k=>[k,stats(experiment.rows.map(r=>r[k]))]));
  const rmse=Math.sqrt(experiment.rows.reduce((n,r)=>n+(r[keys[0]]-r[keys[1]])**2,0)/samples.length);
  summaries.push({arm,samples:samples.length,referenceY_g:experiment.referenceY_g,referenceAssumption:experiment.referenceAssumption,paths,primary_paths_rmse_cm_s:rmse,
    alternate_first_second_referenceY_g:alternate.referenceY_g,alternate_finals_cm_s:Object.fromEntries(keys.map(k=>[k,alternate.rows.at(-1)[k]]))});
  experiment.rows.forEach((r,i)=>rows.push({arm,...r,recorded_velocity_cm_s:Number(data[i].vy_est_cm_s),
    first_second_ref_acceleration_filter_only_cm_s:alternate.rows[i][keys[0]],first_second_ref_velocity_filter_only_cm_s:alternate.rows[i][keys[1]]}));
}
const summary={input:path.basename(input),experiment:'filter placement isolation on raw sensor Y acceleration',accelerationFilterMs:80,velocityFilterMs:100,deadband:false,adaptiveGravity:false,leak:false,
  physicalAccuracy:'Not assessed: stationary reference, attitude/gravity compensation and ground-truth velocity missing. Ending near zero after mean removal is not validation.',summaries};
fs.mkdirSync(out,{recursive:true});const keys=Object.keys(rows[0]);
fs.writeFileSync(path.join(out,'filter-comparison.csv'),[keys.join(','),...rows.map(r=>keys.map(k=>r[k]).join(','))].join('\n'));
fs.writeFileSync(path.join(out,'filter-comparison.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
