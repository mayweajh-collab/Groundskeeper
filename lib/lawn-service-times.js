import {isClientArchived} from './lawn-workspace.js';

const timeDefaultServices=[
 {flag:'mow',key:'defaultMowMinutes',label:'Mowing'},
 {flag:'edge',key:'defaultEdgeMinutes',label:'Edging'},
 {flag:'mulch',key:'defaultMulchMinutes',label:'Mulching'},
 {flag:'hedge',key:'defaultHedgeMinutes',label:'Hedge maintenance'}
];

export function validateServiceTimeDefaults(settings){
 for(const {key,label}of [...timeDefaultServices,{key:'setupMinutes',label:'Setup'}]){
  const value=settings[key],min=key==='setupMinutes'?0:1,max=key==='setupMinutes'?60:300;
  if(value!==null&&value!==undefined&&(!Number.isInteger(value)||value<min||value>max))throw Error(`${label} default must be ${min}–${max} whole crew minutes, or blank.`);
 }
}

export function defaultServiceTime(job,settings){
 validateServiceTimeDefaults(settings);
 const selected=timeDefaultServices.filter(service=>job[service.flag]);
 if(job.customService||!selected.length)return {ready:false,minutes:null,reason:'Enter a job-specific estimate for the requested service.'};
 const missing=selected.filter(service=>settings[service.key]===null||settings[service.key]===undefined).map(service=>service.label);
 if(settings.setupMinutes===null||settings.setupMinutes===undefined)missing.push('Setup');
 if(missing.length)return {ready:false,minutes:null,reason:`Set time defaults for ${missing.join(', ')}, or enter a job-specific estimate covering all requested services.`};
 const components=[{label:'Setup',minutes:settings.setupMinutes},...selected.map(service=>({label:service.label,minutes:settings[service.key]}))];
 const minutes=components.reduce((sum,item)=>sum+item.minutes,0);
 if(minutes>600)return {ready:false,minutes:null,reason:'Combined service defaults exceed 600 crew minutes. Enter a job-specific estimate.'};
 return {ready:true,minutes,components,source:'Owner service-time defaults · '+components.map(item=>`${item.label} ${item.minutes}`).join(' + ')+` = ${minutes} crew min`};
}

export function reviewMissingServiceTimes(data,settings=data.settings){
 validateServiceTimeDefaults(settings);
 const candidates=data.jobs.filter(job=>job.status==='planned'&&!isClientArchived(data,job)&&(job.minutes===null||job.minutes===undefined));
 const updates=[],unresolved=[];
 for(const job of candidates){const estimate=defaultServiceTime(job,settings);(estimate.ready?updates:unresolved).push({id:job.id,...estimate});}
 return {count:candidates.length,updates,unresolved};
}

export function fillMissingServiceTimes(data){
 const review=reviewMissingServiceTimes(data);
 for(const estimate of review.updates){const job=data.jobs.find(job=>job.id===estimate.id);job.minutes=estimate.minutes;job.estimateSource=estimate.source;}
 return review;
}
