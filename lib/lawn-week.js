import {planLawnDay,crewSchedule,demoTravel} from './lawn.js';
import {minor,amount,divideRound} from './finance.js';
import {hasCoordinates} from './lawn-geo.js';
import {roadTravelLookup,roadAccessIssue} from './lawn-roads.js';
import {weekDates,isClientArchived,isReportedVisit,validateTeam} from './lawn-workspace.js';
import {planningFingerprint} from './lawn-planner.js';

export function workspaceForDay(data,date){return {...data,date,now:date===(data.clockDate||data.date)?data.now:Math.min(...data.crews.map(crew=>crew.shiftStart))};}
function routeLaborBudget(route,crew,settings){
 if(!route.stops.length)return 0n;
 const allocated=route.serviceMinutes+route.travelMinutes+route.waitingMinutes,minutes=settings.laborBudgetMode==='shift'?Math.max(crew.shiftEnd-crew.shiftStart,allocated):allocated;
 return divideRound(minor(crew.workerRate)*BigInt(crew.members)*BigInt(minutes),60n);
}
function tupleLess(a,b){for(let index=0;index<a.length;index++){if(a[index]!==b[index])return a[index]<b[index];}return false;}
export function recommendWeeklyPlan(data,start,{estimateExtra=true}={}){
 data={...data,schedulingEnabled:true};
 validateTeam(data);
 const dates=weekDates(start),dateSet=new Set(dates),fingerprint=planningFingerprint(data),lookup=data.geographic?roadTravelLookup(data):demoTravel;
 const included=data.jobs.filter(job=>job.status!=='skipped'&&(!isClientArchived(data,job)||isReportedVisit(job))&&(job.serviceDate===null||job.serviceDate===undefined||dateSet.has(job.serviceDate))),reported=included.filter(isReportedVisit),pending=included.filter(job=>job.status==='planned'),issues=[];
 const eligible=pending.filter(job=>{
  let reason;
  if(!Number.isInteger(job.minutes)||job.minutes<1)reason='Needs a service-time estimate';
  else if(data.geographic?!hasCoordinates(job):!Number.isFinite(job.x)||!Number.isFinite(job.y))reason='Locate the service address';
  else if(lookup(data.depot,job)===null||lookup(job,data.depot)===null)reason=roadAccessIssue(data,job);
  else if(job.dateLocked&&!dateSet.has(job.serviceDate))reason='Review the locked service date';
  if(reason)issues.push({id:job.id,reason});return !reason;
 });
 const distance=job=>lookup(data.depot,job)??1e6;
 const strategies=[(a,b)=>a.minutes-b.minutes||distance(a)-distance(b),(a,b)=>distance(a)-distance(b)||a.minutes-b.minutes,(a,b)=>(a.latitude??a.y)-(b.latitude??b.y)||(a.longitude??a.x)-(b.longitude??b.x)];
 let best;
 for(const compare of strategies){
  const orders=new Map(dates.map(date=>[date,new Map(data.crews.map(crew=>[crew.id,reported.filter(job=>job.serviceDate===date&&job.crew===crew.id).toSorted((a,b)=>(a.actualStart??0)-(b.actualStart??0))]))])),assigned=new Map(),left=[];
  for(const job of eligible.toSorted((a,b)=>Number(!!b.dateLocked)-Number(!!a.dateLocked)||compare(a,b)||a.id.localeCompare(b.id))){
   let choice;
   for(const date of dates){
    if(job.dateLocked&&job.serviceDate!==date)continue;
    const dayOrders=orders.get(date),dayCount=[...dayOrders.values()].reduce((sum,items)=>sum+items.length,0);
    if(Number.isInteger(data.settings.dailyJobLimit)&&dayCount>=data.settings.dailyJobLimit)continue;
    const day=workspaceForDay(data,date);
    for(const crew of data.crews){
     const existing=dayOrders.get(crew.id),locked=existing.filter(isReportedVisit).length,before=crewSchedule(existing,crew,day,lookup);if(before.unassigned.length)continue;
     for(let index=locked;index<=existing.length;index++){
      const order=[...existing.slice(0,index),job,...existing.slice(index)],route=crewSchedule(order,crew,day,lookup);
      if(route.unassigned.length||route.stops.length!==order.length)continue;
      const laborDelta=Number(routeLaborBudget(route,crew,data.settings)-routeLaborBudget(before,crew,data.settings)+divideRound(minor(crew.equipmentRate)*BigInt(job.minutes),60n)+minor(crew.overhead));
      const score=[dayCount,laborDelta,route.travelMinutes-before.travelMinutes,crew.id===job.crew?0:1,dates.indexOf(date)];
      if(!choice||tupleLess(score,choice.score))choice={date,crewId:crew.id,order,score};
     }
    }
   }
   if(choice){orders.get(choice.date).set(choice.crewId,choice.order);assigned.set(job.id,{date:choice.date,crew:choice.crewId});}
   else left.push({id:job.id,reason:job.dateLocked?'Does not fit the locked day’s limits, shift or window':'Weekly daily/crew limits, shifts or customer windows are full'});
  }
  const assignments=new Map();
  for(const date of dates)for(const [crewId,jobs]of orders.get(date))jobs.forEach((job,index)=>assignments.set(job.id,{serviceDate:date,crew:crewId,routeOrder:index}));
  let jobs=data.jobs.map(job=>assignments.has(job.id)?{...job,...assignments.get(job.id)}:pending.some(item=>item.id===job.id)?{...job,serviceDate:null}:({...job}));
  for(const date of dates){const dayPlan=planLawnDay(workspaceForDay({...data,jobs},date),true),ranks=new Map(dayPlan.routes.flatMap(route=>route.stops.map((stop,index)=>[stop.id,index])));jobs=jobs.map(job=>ranks.has(job.id)?{...job,routeOrder:ranks.get(job.id)}:job);}
  const days=dates.map(date=>({date,plan:planLawnDay(workspaceForDay({...data,jobs},date),false)})),count=days.reduce((sum,day)=>sum+day.plan.routes.reduce((subtotal,route)=>subtotal+route.stops.length,0),0),budget=days.reduce((sum,day)=>sum+minor(day.plan.budgetCost),0n),loads=days.map(day=>day.plan.routes.reduce((sum,route)=>sum+route.stops.length,0)),score=[-count,Math.max(...loads)-Math.min(...loads),Number(budget),days.reduce((sum,day)=>sum+day.plan.travelMinutes,0)];
  const candidate={jobs,days,issues:[...issues,...left],score,count,laborBudget:amount(days.reduce((sum,day)=>sum+minor(day.plan.laborBudget),0n)),budgetCost:amount(budget)};
  if(!best||tupleLess(score,best.score))best=candidate;
 }
 const original=new Map(data.jobs.map(job=>[job.id,job]));
 let staffingScenario=null;
 const capacityLeft=best.issues.filter(issue=>!issues.some(input=>input.id===issue.id)).length,knownCount=reported.length+eligible.length,capAllowsAll=!Number.isInteger(data.settings.dailyJobLimit)||data.settings.dailyJobLimit*dates.length>=knownCount;
 if(estimateExtra&&capacityLeft&&capAllowsAll){
  const size=data.settings.defaultCrewMembers||2,template=data.crews.toSorted((a,b)=>Number(a.workerRate)-Number(b.workerRate))[0];
  for(let extra=1;extra<=3&&data.crews.length+extra<=12;extra++){
   const crews=[...data.crews,...Array.from({length:extra},(_,index)=>({...template,id:'SCENARIO-'+index,name:'Additional crew '+(index+1),members:size,maxJobsPerDay:data.settings.defaultCrewJobLimit}))],total=crews.reduce((sum,crew)=>sum+crew.members,0);
   if(total>60)break;
   const scenario=recommendWeeklyPlan({...data,crews,settings:{...data.settings,totalMembers:Math.max(total,data.settings.totalMembers)}},start,{estimateExtra:false});
   if(scenario.count===knownCount){staffingScenario={additionalCrews:extra,membersPerExtraCrew:size,additionalPeople:extra*size,crewsUsed:scenario.peakCrews,peopleUsed:scenario.peakPeople,knownJobs:knownCount};break;}
  }
 }
 return {...best,dates,fingerprint,included:included.length,staffingScenario,changes:best.jobs.filter(job=>{const before=original.get(job.id);return job.serviceDate!==before.serviceDate||job.crew!==before.crew;}),peakCrews:Math.max(...best.days.map(day=>day.plan.crewsUsed)),peakPeople:Math.max(...best.days.map(day=>day.plan.peopleUsed)),method:'Balances jobs across weekdays, then compares labor budget and road travel; heuristic estimates, not a global optimum'};
}
