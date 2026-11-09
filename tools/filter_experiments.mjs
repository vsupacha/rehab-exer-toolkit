// Offline filter-isolation experiment. No deadband, adaptive gravity or leakage.
// One fixed acceleration reference is shared by all paths; velocity starts at 0.
export function compareFilters(samples,{referenceY=null,accelerationTauMs=80,velocityTauMs=100}={}){
  if(samples.length<2)throw new Error('Need at least two samples');
  samples.forEach((s,i)=>{if(!Number.isFinite(s.timeMs)||!Number.isFinite(s.ayG)||(i&&s.timeMs<=samples[i-1].timeMs))throw new Error('Need finite data and strictly increasing receipt times');});
  const reference=referenceY??samples.reduce((n,s)=>n+s.ayG,0)/samples.length;
  if(!Number.isFinite(reference))throw new Error('Invalid reference');
  let acceleration=samples[0].ayG-reference,previous=acceleration,previousFiltered=acceleration;
  let unfilteredVelocity=0,accelerationOnly=0,velocityOnly=0,both=0;
  const rows=samples.map((s,i)=>{
    const raw=s.ayG-reference,dt=i?(s.timeMs-samples[i-1].timeMs)/1000:0;
    if(i){
      const aa=accelerationTauMs>0?1-Math.exp(-dt*1000/accelerationTauMs):1;
      acceleration+=aa*(raw-acceleration);
      unfilteredVelocity+=(previous+raw)*.5*980.665*dt;
      accelerationOnly+=(previousFiltered+acceleration)*.5*980.665*dt;
      const va=velocityTauMs>0?1-Math.exp(-dt*1000/velocityTauMs):1;
      velocityOnly+=va*(unfilteredVelocity-velocityOnly);
      both+=va*(accelerationOnly-both);
    }
    previous=raw;previousFiltered=acceleration;
    return {elapsed_s:(s.timeMs-samples[0].timeMs)/1000,ay_raw_g:s.ayG,ay_reference_removed_g:raw,ay_filtered_g:acceleration,
      velocity_acceleration_filter_only_cm_s:accelerationOnly,velocity_velocity_filter_only_cm_s:velocityOnly,
      velocity_no_filter_cm_s:unfilteredVelocity,velocity_both_filters_cm_s:both};
  });
  return {referenceY_g:reference,referenceAssumption:referenceY===null?'whole-capture mean acceleration; assumes zero average linear acceleration, NOT a measured stationary baseline':'explicit fixed acceleration reference',
    accelerationTauMs,velocityTauMs,deadband:false,leak:false,adaptiveGravity:false,rows};
}
