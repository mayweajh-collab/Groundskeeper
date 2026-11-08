import {planLawnDay,crewSchedule,quoteJob,demoTravel} from './lawn.js';
import {hasCoordinates} from './lawn-geo.js';
import {roadTravelLookup} from './lawn-roads.js';
import {visitsForDate} from './lawn-workspace.js';

export function planningFingerprint(data){
 return JSON.stringify({jobs:data.jobs.map(({id,crew,status,minutes,price,materials,latitude,longitude,x,y,actualStart,actualEnd,windowStart,windowEnd,quoteInputs,serviceDate,routeOrder})=>({id,crew,status,minutes,price,materials,latitude,longitude,x,y,actualStart,actualEnd,windowStart,windowEnd,quoteInputs,serviceDate,routeOrder})),clients:data.clients,date:data.date,crews:data.crews,depot:data.depot,settings:data.settings,now:data.now,roads:data.roadMatrix?.fetchedAt});
}
export function suggestJobPrice(data,job,plan){
 if(!Number.isInteger(job?.minutes)||job.minutes<1)return {ready:false,reason:'Add a service-time estimate'};
 const crew=data.crews.find(c=>c.id===job.crew);if(!crew)return {ready:false,reason:'Choose a crew'};
 const stop=plan.routes.find(route=>route.crewId===job.crew)?.stops.find(point=>point.id===job.id);
 let travelMinutes,basis;
 if(stop){travelMinutes=stop.travelMinutes+stop.returnMinutes+stop.waitingMinutes;basis='Current day route';}
 else{
  const lookup=data.geographic?roadTravelLookup(data):demoTravel;
  if(data.geographic&&!hasCoordinates(job))return {ready:false,reason:'Locate the service address'};
  const outbound=lookup(data.depot,job),back=lookup(job,data.depot);
  if(outbound===null||back===null||!Number.isFinite(outbound)||!Number.isFinite(back))return {ready:false,reason:'Waiting for usable road travel times'};
  travelMinutes=outbound+back;basis='Standalone return trip';
 }
 try{
  return {ready:true,...quoteJob({minutes:stop?.serviceMinutes||job.minutes,travelMinutes,crew,materials:job.materials||'0.00',marginBps:job.quoteInputs?.marginBps??data.settings.marginBps,minimum:job.quoteInputs?.minimum??data.settings.minimumPrice}),travelMinutes,basis};
 }catch(error){return {ready:false,reason:error.message};}
}
function orderedCandidate(data,orders){
 const assignment=new Map(),ids=[];
 for(const crew of data.crews)for(const job of orders.get(crew.id)||[]){assignment.set(job.id,crew.id);ids.push(job.id);}
 const source=new Map(data.jobs.map(job=>[job.id,job])),seen=new Set(ids);
 const jobs=[...ids.map((id,index)=>({...source.get(id),crew:assignment.get(id),routeOrder:index})),...data.jobs.filter(job=>!seen.has(job.id)).map(job=>({...job}))];
 return {jobs,plan:planLawnDay({...data,jobs},false)};
}
const planScore=plan=>[plan.routes.reduce((sum,route)=>sum+route.stops.length,0),Number(plan.budgetCost),plan.travelMinutes+plan.routes.reduce((sum,route)=>sum+route.waitingMinutes,0)];
function betterPlan(candidate,existing){const a=planScore(candidate),b=planScore(existing);return a[0]>b[0]||(a[0]===b[0]&&(a[1]<b[1]||(a[1]===b[1]&&a[2]<b[2])));}
export function recommendLawnDay(data){
 const fingerprint=planningFingerprint(data),current=planLawnDay(data,false),baseline=planLawnDay(data,true),byId=new Map(data.jobs.map(job=>[job.id,job]));
 let best=orderedCandidate(data,new Map(baseline.routes.map(route=>[route.crewId,[...route.stops,...route.unassigned].map(stop=>byId.get(stop.id))])));
 if(data.geographic&&!baseline.roadReady)return {...best,current,fingerprint,changes:[],method:'Waiting for road driving times'};
 const lookup=data.geographic?roadTravelLookup(data):demoTravel,dayJobs=visitsForDate(data);
 const locked=new Map(data.crews.map(crew=>[crew.id,dayJobs.filter(job=>job.crew===crew.id&&['working','completed'].includes(job.status)).sort((a,b)=>(a.actualStart??0)-(b.actualStart??0))]));
 const eligible=dayJobs.filter(job=>job.status==='planned'&&Number.isInteger(job.minutes)&&job.minutes>0&&(data.geographic?hasCoordinates(job):Number.isFinite(job.x)&&Number.isFinite(job.y)));
 const distance=job=>lookup(data.depot,job)??1e6;
 const strategies=[(a,b)=>a.minutes-b.minutes||distance(a)-distance(b),(a,b)=>distance(a)-distance(b)||a.minutes-b.minutes,(a,b)=>(a.windowEnd??1440)-(b.windowEnd??1440)||a.minutes-b.minutes];
 for(const compare of strategies){
  const orders=new Map([...locked].map(([id,jobs])=>[id,[...jobs]]));
  for(const job of eligible.toSorted((a,b)=>compare(a,b)||a.id.localeCompare(b.id))){
   if(Number.isInteger(data.settings.dailyJobLimit)&&[...orders.values()].reduce((sum,jobs)=>sum+jobs.length,0)>=data.settings.dailyJobLimit)break;
   let choice;
   for(const crew of data.crews){
    const existing=orders.get(crew.id),before=crewSchedule(existing,crew,data,lookup);
    if(before.unassigned.length)continue;
    for(let index=locked.get(crew.id).length;index<=existing.length;index++){
     const order=[...existing.slice(0,index),job,...existing.slice(index)],route=crewSchedule(order,crew,data,lookup);
     if(route.unassigned.length||route.stops.length!==order.length)continue;
     const extraMinutes=(route.travelMinutes-before.travelMinutes)+(route.waitingMinutes-before.waitingMinutes)+job.minutes;
     const activation=data.settings.laborBudgetMode==='shift'&&!before.stops.length?(crew.shiftEnd-crew.shiftStart)*crew.members*Number(crew.workerRate)/60:0;
     const score=activation+(data.settings.laborBudgetMode==='shift'?0:extraMinutes*crew.members*Number(crew.workerRate)/60)+(route.travelMinutes-before.travelMinutes)*.001+(crew.id===job.crew?0:.00001);
     if(!choice||score<choice.score)choice={crewId:crew.id,order,score};
    }
   }
   if(choice)orders.set(choice.crewId,choice.order);
  }
  const candidate=orderedCandidate(data,orders);if(betterPlan(candidate.plan,best.plan))best=candidate;
 }
 const changes=best.jobs.filter(job=>job.crew!==byId.get(job.id).crew).map(job=>({id:job.id,from:byId.get(job.id).crew,to:job.crew}));
 return {...best,current,fingerprint,changes,method:'Fits more jobs first, then reduces road travel and waiting; compares saved order with three insertion searches'};
}
