import {minor,amount,divideRound} from './finance.js';
import {hasCoordinates,parseCoordinates,estimatedGeoTravel} from './lawn-geo.js';
import {roadTravelLookup,roadAccessIssue,roadMatrixMatches} from './lawn-roads.js';
import {visitsForDate,isReportedVisit,isClientArchived} from './lawn-workspace.js';

export function clockLabel(minutes){const h=Math.floor(minutes/60),m=minutes%60;return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'pm':'am'}`;}
export function clockInput(minutes){return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
export function parseClock(text){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(text))throw Error('Enter a valid time');const [h,m]=text.split(':').map(Number);return h*60+m;}
export function services(job){return [job.mow?'Mowing':null,job.edge?'Edging':null,job.mulch?'Mulching':null,job.hedge?'Hedge maintenance':null].filter(Boolean);}
export function hasPin(job){return hasCoordinates(job)||(Number.isFinite(job.x)&&Number.isFinite(job.y)&&job.x>=0&&job.x<=1000&&job.y>=0&&job.y<=600);}
export function demoTravel(a,b){if(hasCoordinates(a)&&hasCoordinates(b))return estimatedGeoTravel(a,b);return a.x===b.x&&a.y===b.y?0:Math.ceil((Math.abs(a.x-b.x)+Math.abs(a.y-b.y))/35)+2;}
export function validateCrew(crew){
 if(!Number.isInteger(crew.members)||crew.members<1||crew.members>10)throw Error('Crew size must be 1–10');
 for(const name of ['workerRate','equipmentRate','overhead'])minor(crew[name]);
 if(!Number.isInteger(crew.shiftStart)||!Number.isInteger(crew.shiftEnd)||crew.shiftStart<0||crew.shiftEnd>1439||crew.shiftEnd<=crew.shiftStart)throw Error('Check the crew shift times');
}
export function quoteJob({minutes,travelMinutes=0,crew,materials='0.00',marginBps=3000,minimum='0.00'}){
 validateCrew(crew);
 if(!Number.isInteger(minutes)||minutes<1||minutes>600||!Number.isInteger(travelMinutes)||travelMinutes<0||travelMinutes>1000)throw Error('Check service and travel minutes');
 if(!Number.isInteger(marginBps)||marginBps<0||marginBps>=10000)throw Error('Margin must be from 0% to below 100%');
 const wage=minor(crew.workerRate)*BigInt(crew.members);
 const labor=divideRound(wage*BigInt(minutes),60n),travel=divideRound(wage*BigInt(travelMinutes),60n),equipment=divideRound(minor(crew.equipmentRate)*BigInt(minutes),60n),supplies=minor(materials),overhead=minor(crew.overhead);
 const cost=labor+travel+equipment+supplies+overhead;
 const calculated=divideRound(cost*10000n,BigInt(10000-marginBps));
 const suggested=calculated>minor(minimum)?calculated:minor(minimum);
 return {labor:amount(labor),travel:amount(travel),equipment:amount(equipment),materials:amount(supplies),overhead:amount(overhead),cost:amount(cost),suggested:amount(suggested),workerMinutes:minutes*crew.members,modeledMargin: Number(suggested)===0?null:Number((suggested-cost)*10000n/suggested)/100};
}

export function crewSchedule(order,crew,data,travelBetween){
 let cursor=crew.shiftStart,last=data.depot,travelMinutes=0,serviceMinutes=0,waitingMinutes=0,breakTaken=false;
 const stops=[],unassigned=[];
 for(const job of order){
  const reported=isReportedVisit(job);
  if(!reported&&Number.isInteger(crew.maxJobsPerDay)&&stops.length>=crew.maxJobsPerDay){unassigned.push({id:job.id,reason:'Crew daily job limit reached'});continue;}
  if(data.geographic&&!hasCoordinates(job)){unassigned.push({id:job.id,reason:'Add latitude and longitude'});continue;}
  if(!hasPin(job)){unassigned.push({id:job.id,reason:'Needs a map pin'});continue;}
  if(!Number.isInteger(job.minutes)||job.minutes<1){unassigned.push({id:job.id,reason:'Needs a service-time estimate'});continue;}
  const travel=travelBetween(last,job),returnTrip=travelBetween(job,data.depot),locked=job.status==='completed'||job.status==='working';
  if(travel===null||returnTrip===null){unassigned.push({id:job.id,reason:roadAccessIssue(data,job)});continue;}
  let depart=locked?cursor:Math.max(cursor,data.now),start=depart+travel,wait=0;
  const actualMinutes=job.status==='completed'?job.actualEnd-job.actualStart:job.minutes;
  if(locked&&Number.isInteger(job.actualStart))start=job.actualStart;
  else{
   if(!breakTaken&&start+actualMinutes>crew.breakStart&&depart<crew.breakStart+crew.breakMinutes){start=Math.max(start,crew.breakStart+crew.breakMinutes);breakTaken=true;}
   if(Number.isInteger(job.windowStart)&&start<job.windowStart){wait=job.windowStart-start;start=job.windowStart;}
  }
  let end=job.status==='completed'?job.actualEnd:start+actualMinutes;
  if(job.status==='working')end=Math.max(end,data.now+1);
  if(!locked&&(end>Math.min(crew.shiftEnd,job.windowEnd??crew.shiftEnd)||end+returnTrip>crew.shiftEnd)){
   unassigned.push({id:job.id,reason:'Does not fit this shift or customer window'});continue;
  }
  stops.push({id:job.id,start,end,travelMinutes:travel,waitingMinutes:wait,serviceMinutes:actualMinutes,returnMinutes:0});
  travelMinutes+=travel;waitingMinutes+=wait;serviceMinutes+=actualMinutes;cursor=end;last=job;
 }
 const back=stops.length?travelBetween(last,data.depot):0;
 if(stops.length)stops.at(-1).returnMinutes=back;
 travelMinutes+=back;
 const travelCost=divideRound(minor(crew.workerRate)*BigInt(crew.members)*BigInt(travelMinutes),60n);
 return {crewId:crew.id,stops,unassigned,travelMinutes,waitingMinutes,serviceMinutes,finish:cursor+back,travelCost:amount(travelCost)};
}
function permutations(items){if(items.length<2)return [items];return items.flatMap((item,i)=>permutations(items.filter((_,j)=>j!==i)).map(tail=>[item,...tail]));}
function optimizeCrew(jobs,crew,data,travelBetween){
 const locked=jobs.filter(j=>['completed','working'].includes(j.status)).sort((a,b)=>(a.actualStart??0)-(b.actualStart??0));
 const pending=jobs.filter(j=>!['completed','working'].includes(j.status)&&Number.isInteger(j.minutes)&&j.minutes>0&&hasPin(j));
 const deferred=jobs.filter(j=>!['completed','working'].includes(j.status)&&!pending.includes(j));
 let orders;
 if(pending.length<=7)orders=permutations(pending);
 else{
  const remaining=[...pending],greedy=[];let point=locked.at(-1)||data.depot;
  while(remaining.length){remaining.sort((a,b)=>(travelBetween(point,a)??1e6)-(travelBetween(point,b)??1e6)||a.id.localeCompare(b.id));point=remaining.shift();greedy.push(point);}
  orders=[pending,greedy];
 }
 let best;
 for(const order of orders){const plan=crewSchedule([...locked,...order,...deferred],crew,data,travelBetween);const score=plan.unassigned.length*1000000+plan.travelMinutes+plan.waitingMinutes;if(!best||score<best.score)best={score,plan};}
 return best.plan;
}
export function planLawnDay(data,optimize=false){
 if(!Array.isArray(data.jobs)||data.jobs.length>150)throw Error('Use up to 150 jobs in this prototype');
 const ids=new Set();for(const job of data.jobs){if(!job.id||ids.has(job.id))throw Error('Every visit needs a unique ID');ids.add(job.id);if(job.price!==null&&job.price!==undefined)minor(job.price);}
 const travelBetween=data.geographic?roadTravelLookup(data):demoTravel;
 const dayJobs=visitsForDate(data),byId=new Map(dayJobs.map(job=>[job.id,job]));
 let routes=data.crews.map(crew=>{validateCrew(crew);const jobs=dayJobs.filter(j=>j.crew===crew.id).toSorted((a,b)=>(a.routeOrder??1e6)-(b.routeOrder??1e6));return optimize?optimizeCrew(jobs,crew,data,travelBetween):crewSchedule(jobs,crew,data,travelBetween);});
 const reported=routes.flatMap(route=>route.stops).filter(stop=>isReportedVisit(byId.get(stop.id))).length,limit=data.settings.dailyJobLimit;
 if(Number.isInteger(limit)){
  const pending=routes.flatMap(route=>route.stops).filter(stop=>!isReportedVisit(byId.get(stop.id))).sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id)),overflow=new Set(pending.slice(Math.max(0,limit-reported)).map(stop=>stop.id));
  if(overflow.size)routes=routes.map(route=>{
   const crew=data.crews.find(crew=>crew.id===route.crewId),kept=crewSchedule(route.stops.filter(stop=>!overflow.has(stop.id)).map(stop=>byId.get(stop.id)),crew,data,travelBetween);
   return {...kept,unassigned:[...route.unassigned,...route.stops.filter(stop=>overflow.has(stop.id)).map(stop=>({id:stop.id,reason:'Business daily job limit reached'}))]};
  });
 }
 const unassigned=[...routes.flatMap(route=>route.unassigned),...dayJobs.filter(j=>!data.crews.some(c=>c.id===j.crew)).map(j=>({id:j.id,reason:'Choose a crew'}))];
 let cost=0n,revenue=0n,quoted=0;
 const costs={};
 for(const route of routes){const crew=data.crews.find(c=>c.id===route.crewId);for(const stop of route.stops){const job=data.jobs.find(j=>j.id===stop.id);const calculation=quoteJob({minutes:stop.serviceMinutes,travelMinutes:stop.travelMinutes+stop.returnMinutes+stop.waitingMinutes,crew,materials:job.materials||'0.00',marginBps:data.settings.marginBps,minimum:data.settings.minimumPrice});cost+=minor(calculation.cost);costs[job.id]=calculation;}}
 for(const job of dayJobs)if(job.price!==null&&job.price!==undefined){revenue+=minor(job.price);quoted++;}
 const labor=Object.values(costs).reduce((sum,item)=>sum+minor(item.labor)+minor(item.travel),0n),shiftLabor=routes.filter(route=>route.stops.length).reduce((sum,route)=>{const crew=data.crews.find(crew=>crew.id===route.crewId),paidMinutes=Math.max(crew.shiftEnd-crew.shiftStart,route.serviceMinutes+route.travelMinutes+route.waitingMinutes);return sum+divideRound(minor(crew.workerRate)*BigInt(crew.members)*BigInt(paidMinutes),60n);},0n),laborBudget=data.settings.laborBudgetMode==='shift'?(shiftLabor>labor?shiftLabor:labor):labor;
 const stopCount=routes.reduce((sum,route)=>sum+route.stops.length,0),overCapacity=(Number.isInteger(limit)&&stopCount>limit)||routes.some(route=>{const crew=data.crews.find(crew=>crew.id===route.crewId);return Number.isInteger(crew.maxJobsPerDay)&&route.stops.length>crew.maxJobsPerDay;});
 return {jobs:dayJobs,routes,unassigned,costs,cost:amount(cost),revenue:amount(revenue),quoted,overCapacity,laborCost:amount(labor),shiftLaborCost:amount(shiftLabor>labor?shiftLabor:labor),laborBudget:amount(laborBudget),budgetCost:amount(cost-labor+laborBudget),crewsUsed:routes.filter(route=>route.stops.length).length,peopleUsed:routes.filter(route=>route.stops.length).reduce((sum,route)=>sum+data.crews.find(crew=>crew.id===route.crewId).members,0),travelMinutes:routes.reduce((sum,r)=>sum+r.travelMinutes,0),travelCost:amount(routes.reduce((sum,r)=>sum+minor(r.travelCost),0n)),roadReady:data.geographic&&roadMatrixMatches(data),completed:dayJobs.filter(j=>j.status==='completed').length,working:dayJobs.filter(j=>j.status==='working').length};
}

export function startLawnJob(data,id){
 const job=data.jobs.find(j=>j.id===id);if(!job||job.status!=='planned')throw Error('Choose a planned job');
 if(isClientArchived(data,job))throw Error('Restore this client before starting work.');
 if(data.schedulingEnabled&&job.serviceDate!==(data.clockDate||data.date))throw Error('Choose a visit scheduled for the demo workday.');
 if(!data.crews.some(c=>c.id===job.crew))throw Error('Choose a crew first');
 if(data.jobs.some(j=>j.crew===job.crew&&j.status==='working'))throw Error('Finish the crew’s current job before starting another');
 if(!hasPin(job))throw Error('Place the job on the demo map first');
 if(!Number.isInteger(job.minutes)||job.minutes<1)throw Error('Enter a service-time estimate before starting this job');
 job.status='working';job.actualStart=data.now;
}
export function finishLawnJob(data,id,{start,end,completedServices}){
 const job=data.jobs.find(j=>j.id===id);if(!job||job.status!=='working')throw Error('Start the job before recording completion');
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>1439||end<=start||end-start>600)throw Error('Finish time must follow the start, within 10 hours');
 if(!Array.isArray(completedServices)||!completedServices.length||completedServices.some(name=>!services(job).includes(name)))throw Error('Confirm the services actually completed');
 if(data.jobs.some(j=>j.id!==id&&j.crew===job.crew&&j.status==='completed'&&start<j.actualEnd&&end>j.actualStart))throw Error('This time overlaps another completed job for the crew');
 Object.assign(job,{status:'completed',actualStart:start,actualEnd:end,completedServices:[...new Set(completedServices)],completionPriceReviewed:services(job).every(name=>completedServices.includes(name))});data.now=Math.max(data.now,end);
}
export function completionDraft(job,date){
 if(job.status!=='completed')throw Error('Only completed work can have a completion message');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.email||''))throw Error('Add a valid customer email');
 if(job.price===null||job.price===undefined)throw Error('Review the job price first');minor(job.price);
 if(!job.completedServices?.length)throw Error('Confirm completed services');
 if(services(job).some(name=>!job.completedServices.includes(name))&&!job.completionPriceReviewed)throw Error('Review the price for partially completed services');
 return {to:job.email,subject:`Your lawn care is complete — ${date}`,body:`Hi ${job.name},\n\nWe completed your lawn care at ${job.address} on ${date}.\n\nServices completed: ${job.completedServices.join(' and ')}.\nReviewed job price: $${job.price}.\n\nThank you for choosing Greenside Lawn Co.\n\nDemo draft only — no email has been sent.`};
}

export function importLawnRows(rows,data){
 if(rows.length>100)throw Error('Import up to 100 rows at a time');
 const jobs=[],issues=[],existing=new Set(data.jobs.map(j=>j.clientId));
 const bool=value=>{const text=String(value??'').trim().toLowerCase();if(['true','yes','1','x'].includes(text))return true;if(['false','no','0',''].includes(text))return false;throw Error('Use yes/no for mowing and edging');};
 for(const [index,row] of rows.entries()){
  const line=Number(row.__source_row)||index+2;
  try{
   if(row.__formula_error)throw Error(row.__formula_error);
   const name=String(row.client_name||row.name||'').trim(),street=String(row.address||'').trim(),city=String(row.city||'').trim(),region=String(row.state||'').trim(),zip=String(row.zip||'').trim();
   const address=[street,city,[region,zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
   if(!name||!street)throw Error('Client name and address are required');
   const id=String(row.client_id||`IMPORT-${data.jobs.length+index+1}`).trim();if(!/^[A-Za-z0-9_-]{1,60}$/.test(id))throw Error('Use letters, numbers, hyphens or underscores for client IDs');
   if(existing.has(id)||jobs.some(j=>j.clientId===id))throw Error('This client already has a visit in the demo day');
   if([...data.jobs,...jobs].some(j=>j.name.toLowerCase()===name.toLowerCase()&&j.address.toLowerCase()===address.toLowerCase()))throw Error('This customer and address already have a visit in the demo day');
   const mow=bool(row.mow),edge=bool(row.edge),mulch=bool(row.mulch),hedge=bool(row.hedge);if(!mow&&!edge&&!mulch&&!hedge)throw Error('Select mowing or edging, mulching or hedge maintenance');
   const hasMinutes=String(row.estimated_minutes??'').trim()!=='';
   const minutes=hasMinutes?Number(row.estimated_minutes):(mulch||hedge)?null:data.settings.setupMinutes+(mow?data.settings.defaultMowMinutes:0)+(edge?data.settings.defaultEdgeMinutes:0);
   if(minutes!==null&&(!Number.isInteger(minutes)||minutes<1||minutes>600))throw Error('Service minutes must be 1–600');
   let price=null;if(String(row.job_price_usd??'').trim()!=='')price=amount(minor(String(row.job_price_usd).trim()));
   const known=data.jobs.find(j=>j.address.toLowerCase()===address.toLowerCase());
   const assigned=data.crews.find(c=>c.id===String(row.crew_id??'').trim()||c.name.toLowerCase()===String(row.crew_id??'').trim().toLowerCase());
   const coordinates=parseCoordinates(row.latitude,row.longitude);
   const job={id:`VISIT-${id}`,clientId:id,name,address,street,city,region,zip,county:String(row.county||'').trim(),email:String(row.email||'').trim(),phone:String(row.phone||'').trim(),mow,edge,mulch,hedge,minutes,price,materials:'0.00',crew:assigned?.id||data.crews[0].id,x:known?.x??null,y:known?.y??null,...coordinates,locationSource:hasCoordinates(coordinates)?'Spreadsheet coordinates — not independently geocoded':null,status:'planned',source:row.__source_sheet?`Excel · ${row.__source_sheet} · row ${line}`:`Imported CSV · row ${line}`,estimateSource:hasMinutes?'Owner spreadsheet estimate':minutes===null?'Needs an estimate for all requested services':'Owner demo time defaults',notes:''};
   jobs.push(job);
   if(String(row.crew_id??'').trim()&&!assigned)issues.push({row:line,severity:'review',message:'Crew was not recognized; assigned the first crew for owner review.'});
   if(!hasPin(job))issues.push({row:line,severity:'review',message:'Place a pin on the demo map before routing this visit.'});
   if(price===null)issues.push({row:line,severity:'review',message:'Job price needs review in Price studio.'});
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.email))issues.push({row:line,severity:'review',message:'Add an email before preparing a completion message.'});
   if(!hasMinutes)issues.push({row:line,severity:'review',message:minutes===null?'Enter an estimate covering all requested services before scheduling.':'Using owner demo time defaults; review the estimate.'});
  }catch(error){issues.push({row:line,severity:'error',message:error.message});}
 }
 return {jobs,issues,rows:rows.length};
}
