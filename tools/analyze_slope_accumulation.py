"""Offline only: integrate trailing-10-point Ay slopes, then hysteretic sign excursions.
Run from repository root: python tools/analyze_slope_accumulation.py
"""
from pathlib import Path
import csv,json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def accumulate(t,slope):
    out=np.zeros(len(t))
    for i in range(1,len(t)):
        if t[i]<=t[i-1]:raise ValueError('timestamps must increase')
        out[i]=out[i-1]+.5*(slope[i-1]+slope[i])*(t[i]-t[i-1])
    return out

def excursions(t,x,threshold):
    if threshold<=0:raise ValueError('positive threshold required')
    events=[];direction=0;low=high=x[0];low_time=high_time=t[0]
    for time,value in zip(t,x):
        if direction==0:
            if value<low:low=value;low_time=time
            if value>high:high=value;high_time=time
            if value-low>=threshold:
                direction=1;events.append(dict(time_s=float(time),sign='+',accumulated_mg=float(value),excursion_mg=float(value-low),extremum_time_s=float(low_time)));high=value;high_time=time
            elif high-value>=threshold:
                direction=-1;events.append(dict(time_s=float(time),sign='-',accumulated_mg=float(value),excursion_mg=float(high-value),extremum_time_s=float(high_time)));low=value;low_time=time
        elif direction==1:
            if value>high:high=value;high_time=time
            if high-value>=threshold:
                direction=-1;events.append(dict(time_s=float(time),sign='-',accumulated_mg=float(value),excursion_mg=float(high-value),extremum_time_s=float(high_time)));low=value;low_time=time
        else:
            if value<low:low=value;low_time=time
            if value-low>=threshold:
                direction=1;events.append(dict(time_s=float(time),sign='+',accumulated_mg=float(value),excursion_mg=float(value-low),extremum_time_s=float(low_time)));high=value;high_time=time
    return events

def main():
    # Numeric checks: actual-dt area, no repeated events during a monotone run,
    # no subthreshold chatter, and invariance to a constant accumulated offset.
    assert np.allclose(accumulate(np.array([0,.1,.4,1]),np.ones(4)*2),[0,.2,.8,2])
    assert len(excursions(np.arange(10),np.arange(10),1))==1
    assert not excursions(np.arange(10),np.array([0,.1,-.1,.2,0,.1,-.1,.2,0,0]),1)
    fixture=np.array([0,-.4,-1.2,-2,-1.5,-.5,.5,2,1,-.5,-2])
    a=excursions(np.arange(len(fixture)),fixture,1)
    b=excursions(np.arange(len(fixture)),fixture+100,1)
    assert [e['sign'] for e in a]==['-','+','-']
    assert [(e['time_s'],e['sign']) for e in a]==[(e['time_s'],e['sign']) for e in b]
    out=Path('../algorithm-analysis/capture-2')
    rows=list(csv.DictReader(open(out/'ay-ema-slope-10point.csv',encoding='utf-8')))
    summary=[];all_data=[];all_events=[];series={}
    for tau in [0,50,100,200,300,500]:
        key=('raw' if tau==0 else f'ema_{tau}ms')+'_ay_slope_g_per_s'
        valid=[r for r in rows if r[key]!='']
        t=np.array([float(r['elapsed_s']) for r in valid]);s=np.array([float(r[key])*1000 for r in valid]);x=accumulate(t,s);series[tau]=(t,s,x)
        for i in range(len(t)):all_data.append(dict(ema_ms=tau,time_s=t[i],slope_mg_per_s=s[i],accumulated_mg=x[i]))
        for h in [.5,1,2]:
            events=excursions(t,x,h)
            for e in events:all_events.append(dict(ema_ms=tau,threshold_mg=h,**e))
            summary.append(dict(ema_ms=tau,threshold_mg=h,positive=sum(e['sign']=='+' for e in events),negative=sum(e['sign']=='-' for e in events),total_events=len(events),nonoverlapping_sign_pairs=len(events)//2,sequence=''.join(e['sign'] for e in events),times_s=[round(e['time_s'],3) for e in events]))
    for name,data in [('ay-slope-accumulation.csv',all_data),('ay-slope-events.csv',all_events),('ay-slope-count-summary.csv',summary)]:
        with open(out/name,'w',newline='',encoding='utf-8') as f:
            w=csv.DictWriter(f,fieldnames=list(data[0]));w.writeheader();w.writerows(data)
    (out/'ay-slope-count-summary.json').write_text(json.dumps({'method':'10-point trailing OLS slope, trapezoidal accumulation in mg, 0.5/1/2mg directional-excursion hysteresis','meaning':'+ rising Ay trend, - falling Ay trend; not measured left/right travel or physical reps','prehistory':'first 9 slopes unavailable; accumulation starts at first valid slope','summary':summary},indent=2),encoding='utf-8')
    t,s,x=series[100];events=excursions(t,x,1)
    fig,axes=plt.subplots(2,1,figsize=(12,7),sharex=True,constrained_layout=True)
    axes[0].plot(t,s,color='#444',lw=1.5);axes[0].fill_between(t,0,s,where=s>=0,color='#24975b',alpha=.25);axes[0].fill_between(t,0,s,where=s<0,color='#c74646',alpha=.25)
    axes[0].set_ylabel('Ay slope (mg/s)');axes[0].set_title('EMA 100 ms → trailing 10-point slope → signed accumulation')
    axes[1].plot(t,x,color='#2866a1',lw=2,label='Accumulated slope (mg), starts at first valid window')
    for e in events:
        color='#19834d' if e['sign']=='+' else '#c74646'
        axes[1].scatter(e['time_s'],e['accumulated_mg'],color=color,s=65,zorder=4)
        axes[1].annotate(e['sign']+' @ '+f"{e['time_s']:.2f}s",(e['time_s'],e['accumulated_mg']),xytext=(0,14 if e['sign']=='+' else -23),textcoords='offset points',ha='center',color=color)
    axes[1].set_ylabel('Accumulated Ay slope (mg)');axes[1].set_xlabel('Capture time (s)');axes[1].legend(loc='upper right',fontsize=9)
    for ax in axes:ax.axhline(0,color='#777',lw=.7);ax.grid(alpha=.2)
    fig.suptitle('Excursion threshold 1 mg: 2 positive + 3 negative = 5 signal events (2 complete sign pairs + 1 unmatched)\nSign describes Ay rising/falling, NOT physical travel direction',fontsize=11)
    fig.savefig(out/'ay-slope-accumulation-counts.png',dpi=150);plt.close(fig)
    colors=['#555','#2b71b1','#19834d','#d68916','#9045b4','#ce4848']
    fig,ax=plt.subplots(figsize=(12,5),constrained_layout=True)
    for tau,color in zip([0,50,100,200,300,500],colors):
        tt,ss,xx=series[tau];ax.plot(tt,xx,color=color,label='Raw' if tau==0 else f'EMA {tau} ms')
    ax.set(title='Accumulated 10-point slopes at different EMA levels',xlabel='Capture time (s)',ylabel='Accumulated slope (mg)');ax.grid(alpha=.2);ax.legend(ncol=6)
    fig.savefig(out/'ay-slope-accumulation-overlay.png',dpi=150)
    print(json.dumps(summary,ensure_ascii=False))
if __name__=='__main__':main()
