import {minor,amount} from './finance.js';
import {planLawnDay,parseClock} from './lawn.js';
import {workspaceForDay} from './lawn-week.js';
import {normalizeOperations,isClientArchived,weekDates} from './lawn-workspace.js';
import {roadMatrixMatches} from './lawn-roads.js';

export const landscapeCategories=['Labor','Materials','Equipment','Subcontractors'];
export const landscapeServices=['Irrigation repair','Planting','Drainage','Patio installation'];
export function landscapeDate(date,offset=0){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Choose a valid service date.');
 const value=new Date(date+'T12:00:00Z');if(!Number.isFinite(value.getTime())||value.toISOString().slice(0,10)!==date)throw Error('Choose a valid service date.');
 value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10);
}
export function landscapeCosts(project){
 const rows=landscapeCategories.map(category=>{
  const input=project.costs.find(row=>row.category===category);if(!input)throw Error('Every project needs all four cost categories.');
  const budget=minor(input.budget),actual=minor(input.actual),committed=minor(input.committed),remaining=minor(input.remaining);
  return {category,budget:amount(budget),actual:amount(actual),committed:amount(committed),remaining:amount(remaining),forecast:amount(actual+committed+remaining),variance:amount(budget-actual-committed-remaining),items:input.items||[]};
 });
 const sum=field=>rows.reduce((total,row)=>total+minor(row[field],{signed:field==='variance'}),0n);
 const revenue=minor(project.contractValue),forecast=sum('forecast'),profit=revenue-forecast;
 return {rows,revenue:amount(revenue),budget:amount(sum('budget')),actual:amount(sum('actual')),committed:amount(sum('committed')),remaining:amount(sum('remaining')),forecast:amount(forecast),variance:amount(sum('budget')-forecast),profit:amount(profit),margin:revenue===0n?null:Number(profit*10000n/revenue)/100};
}
export function landscapeOverdue(data,date){
 landscapeDate(date);
 const invoices=(data.landscape?.invoices||[]).filter(invoice=>invoice.dueDate<date&&minor(invoice.total)>minor(invoice.paid));
 return {invoices,total:amount(invoices.reduce((sum,invoice)=>sum+minor(invoice.total)-minor(invoice.paid),0n))};
}
const categoryRows=(values,labels)=>landscapeCategories.map((category,index)=>({category,budget:values[index][0],actual:values[index][1],committed:values[index][2],remaining:values[index][3],items:[{label:labels[index],actual:values[index][1],committed:values[index][2],remaining:values[index][3]}]}));

export function ensureLandscapeWorkspace(data){
 if(data.landscape?.version===1)return data.landscape;
 const baseDate=data.clockDate||data.date,days=weekDates(baseDate),baseJobs=data.jobs.filter(job=>!isClientArchived(data,job));
 if(!baseJobs.length){data.landscape={version:1,projects:[],invoices:[],activity:[],sample:true};return data.landscape;}
 const definitions=[
  ['P-1001','Foxglove grounds maintenance','Maintenance','Active','3200.00',[[1100,440,0,520],[300,90,80,75],[400,150,0,180],[0,0,0,0]],['Weekly mowing and edging','Seasonal supplies','Mower and trailer costs','No subcontractors'],0],
  ['P-1002','Parkside irrigation repair','Irrigation','In progress','2400.00',[[700,210,0,370],[650,180,300,80],[150,30,0,60],[100,0,100,0]],['Valve diagnosis and installation','Valves, fittings and pipe','Trencher rental','Backflow inspection'],1],
  ['P-1003','Sunshine planting renewal','Planting','Scheduled','6800.00',[[1900,420,0,1200],[2400,650,1200,300],[350,100,0,200],[0,0,0,0]],['Bed preparation and planting','Trees, perennials and mulch','Compact loader rental','No subcontractors'],2],
  ['P-1004','Tarton Fields drainage','Drainage','At risk','9800.00',[[2400,1600,0,1200],[2700,1300,1400,400],[800,450,300,200],[600,0,700,0]],['Excavation and grading','Drain pipe and aggregate','Excavator rental','Utility locating and haul-away'],3],
  ['P-1005','Hartford patio installation','Installation','In progress','16000.00',[[4200,2200,0,2300],[5400,2800,2700,0],[1400,700,400,300],[1400,500,900,0]],['Patio base and laying crew','Pavers, base and edging','Compactor and loader rental','Haul-away subcontract'],4],
  ['P-1006','Cranberry seasonal care','Maintenance','Needs review','1800.00',[[600,120,0,350],[180,0,60,80],[150,30,0,90],[0,0,0,0]],['Hedge and lawn visits','Mulch and green-waste bags','Equipment allocation','No subcontractors'],5]
 ];
 const workspace={version:1,projects:[],invoices:[],activity:[],sample:true};
 for(const [id,name,type,status,contractValue,values,labels,index]of definitions){
  const base=baseJobs[index%baseJobs.length];
  const project={id,name,type,status,client:base.name,address:base.address,responsible:index%2?'Taylor Brooks':'Alex Morgan',contractValue,costs:categoryRows(values.map(row=>row.map(value=>Number(value).toFixed(2))),labels),jobIds:[],startDate:landscapeDate(baseDate,-7),targetDate:landscapeDate(days[4],type==='Maintenance'?14:0),description:type==='Maintenance'?'Recurring property care with a reviewed scope, access notes and scheduled visits.':'Complete the agreed scope, coordinate materials and keep the customer updated before each visit.',notes:[{id:id+'-note',text:'Access confirmed with the client. Keep the driveway clear and protect established planting.',createdAt:baseDate}],milestones:[{name:'Scope and access confirmed',date:landscapeDate(baseDate,-3),done:true},{name:'Crew work scheduled',date:days[index%5],done:false},{name:'Final walk-through',date:days[4],done:false}]};
  if(index===0||index===5){project.jobIds.push(base.id);base.projectId=id;}
  workspace.projects.push(project);
 }
 const visits=[['P-1002',1,0,90,'Irrigation repair',1],['P-1003',2,1,180,'Planting',2],['P-1004',3,0,180,'Drainage',3],['P-1005',3,1,180,'Patio installation',4],['P-1005',4,0,120,'Patio installation',4]];
 for(const [projectId,day,crewIndex,minutes,customService,baseIndex]of visits){
  if(data.jobs.length>=150)break;
  const project=workspace.projects.find(item=>item.id===projectId),base=baseJobs[baseIndex%baseJobs.length],id=projectId+'-VISIT-'+(project.jobIds.length+1);
  const crew=data.crews[crewIndex]||data.crews[0];if(!crew)continue;
  data.jobs.push({...structuredClone(base),id,clientId:base.clientId,projectId,customService,mow:false,edge:false,mulch:false,hedge:false,minutes,price:null,materials:'0.00',crew:crew.id,serviceDate:days[day],status:'planned',actualStart:null,actualEnd:null,completedServices:[],completionPriceReviewed:false,windowStart:540,windowEnd:540+minutes,routeOrder:10,source:'Sample landscaping project',estimateSource:'Sample crew-time estimate',notes:'Protect the driveway and confirm access with the client before starting.'});
  project.jobIds.push(id);
 }
 workspace.invoices=[{id:'INV-1042',projectId:'P-1001',total:'1100.00',paid:'250.00',dueDate:landscapeDate(baseDate,-5)},{id:'INV-1048',projectId:'P-1005',total:'1800.00',paid:'0.00',dueDate:landscapeDate(baseDate,-2)},{id:'INV-1051',projectId:'P-1003',total:'1200.00',paid:'0.00',dueDate:landscapeDate(baseDate,5)}];
 workspace.activity=[{projectId:'P-1005',text:'Paver order confirmed; only the outstanding balance remains committed.',date:landscapeDate(baseDate,-2)},{projectId:'P-1004',text:'Additional excavation and aggregate raised the forecast above the cost budget.',date:landscapeDate(baseDate,-1)}];
 data.landscape=workspace;normalizeOperations(data);return workspace;
}
export function landscapeProject(data,id){return data.landscape?.projects.find(project=>project.id===id);}
export function landscapeVisits(data,date){
 const plan=planLawnDay(workspaceForDay(data,date),false),byId=new Map(data.jobs.map(job=>[job.id,job]));
 return {...plan,scheduled:plan.routes.flatMap(route=>route.stops.map(stop=>({job:byId.get(stop.id),stop,crew:data.crews.find(crew=>crew.id===route.crewId)}))).sort((a,b)=>a.stop.start-b.stop.start),pending:plan.unassigned.map(item=>({...item,job:byId.get(item.id)}))};
}
export function landscapeNextVisit(data,project,from=data.date){
 return data.jobs.filter(job=>project.jobIds.includes(job.id)&&!isClientArchived(data,job)&&job.status!=='completed'&&job.serviceDate>=from).sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate)||(a.windowStart??0)-(b.windowStart??0))[0]||null;
}
export function landscapeAttention(data,date){
 const plan=landscapeVisits(data,date),items=[];
 const missing=plan.pending.filter(item=>/estimate/.test(item.reason)),unassigned=plan.pending.filter(item=>/Choose a crew/.test(item.reason)),conflicts=plan.pending.filter(item=>!/estimate|Choose a crew|actual start/.test(item.reason));
 if(missing.length)items.push({kind:'estimate',title:`${missing.length} jobs need a time estimate`,detail:'Review crew minutes before these visits can be scheduled.',count:missing.length,action:'jobs'});
 if(unassigned.length)items.push({kind:'unassigned',title:`${unassigned.length} jobs need a crew`,detail:'Assign an available crew and service date.',count:unassigned.length,action:'week'});
 if(conflicts.length)items.push({kind:'conflict',title:`${conflicts.length} visits need scheduling review`,detail:'Check the shift, customer window, location or road access.',count:conflicts.length,action:'week'});
 const timeEntries=data.jobs.filter(job=>['completed','working'].includes(job.status)&&job.serviceDate===date&&(!Number.isInteger(job.actualStart)||(job.status==='completed'&&(!Number.isInteger(job.actualEnd)||job.actualEnd<=job.actualStart||job.actualEnd-job.actualStart>600))));
 if(timeEntries.length)items.push({kind:'time',title:`${timeEntries.length} visits need time entries`,detail:'Confirm the actual start and finish before costs can be modeled.',count:timeEntries.length,action:'time-entries'});
 for(const project of data.landscape?.projects||[])if(minor(landscapeCosts(project).variance,{signed:true})<0n)items.push({kind:'budget',title:project.name,detail:'Forecast costs exceed the budget. Review the cost breakdown.',count:1,projectId:project.id,action:'costs'});
 return items;
}
export function assignLandscapeVisit(data,id,{date,crewId,start,minutes}){
 landscapeDate(date);
 const original=data.jobs.find(job=>job.id===id),crew=data.crews.find(item=>item.id===crewId);
 if(!original||original.status!=='planned')throw Error('Only unstarted jobs can be rescheduled. Reported work stays in place.');
 if(isClientArchived(data,original))throw Error('Restore this client before scheduling work.');
 if(!crew)throw Error('Choose an available crew.');
 if(crew.unavailableDates?.includes(date))throw Error('This crew is unavailable on that date.');
 const begin=typeof start==='string'?parseClock(start):start,duration=Number(minutes);
 if(!Number.isInteger(duration)||duration<1||duration>600)throw Error('Enter a service-time estimate from 1 to 600 minutes.');
 if(!Number.isInteger(begin)||begin<crew.shiftStart||begin+duration>crew.shiftEnd)throw Error('This visit must fit inside the crew shift.');
 if(crew.breakMinutes&&begin<crew.breakStart+crew.breakMinutes&&begin+duration>crew.breakStart)throw Error('This visit overlaps the crew break. Choose another time.');
 if(data.geographic&&!roadMatrixMatches(data))throw Error('Road travel is updating. Try again when the road routes are ready.');
 const before=landscapeVisits(data,date),others=before.scheduled.filter(item=>item.crew.id===crewId&&item.job.id!==id);
 if(others.some(item=>begin<item.stop.end&&begin+duration>item.stop.start))throw Error('This time conflicts with another job for this crew. Choose another slot.');
 const candidate=structuredClone(data),job=candidate.jobs.find(item=>item.id===id);
 Object.assign(job,{crew:crewId,serviceDate:date,minutes:duration,windowStart:begin,windowEnd:begin+duration,estimateSource:'Owner-reviewed schedule estimate'});
 const startTimes=new Map(others.map(item=>[item.job.id,item.stop.start]));startTimes.set(id,begin);
 candidate.jobs.filter(item=>item.crew===crewId&&item.serviceDate===date).sort((a,b)=>(a.actualStart??a.windowStart??startTimes.get(a.id)??1e6)-(b.actualStart??b.windowStart??startTimes.get(b.id)??1e6)).forEach((item,index)=>{if(item.status==='planned')item.routeOrder=index*10;});
 const after=landscapeVisits(candidate,date),scheduled=after.scheduled.find(item=>item.job.id===id);
 if(!scheduled)throw Error(after.pending.find(item=>item.id===id)?.reason||'This visit cannot fit with road travel and the return to base.');
 if(others.some(item=>!after.scheduled.some(next=>next.job.id===item.job.id)))throw Error('This slot would displace another visit. Choose a different time or crew.');
 data.jobs=candidate.jobs;
 data.landscape?.activity.unshift({projectId:job.projectId||null,text:`${job.customService||'Customer visit'} scheduled with ${crew.name} for ${date}.`,date});
 return data.jobs.find(item=>item.id===id);
}
export function unscheduleLandscapeVisit(data,id){
 const job=data.jobs.find(item=>item.id===id);if(!job||job.status!=='planned')throw Error('Only unstarted visits can be moved to unscheduled work.');
 job.serviceDate=null;job.crew='';delete job.windowStart;delete job.windowEnd;delete job.routeOrder;
}
export function recordLandscapeTime(data,id,{start,end}){
 const job=data.jobs.find(item=>item.id===id);if(!job||!['working','completed'].includes(job.status))throw Error('Choose a visit with reported work.');
 const begin=typeof start==='string'?parseClock(start):start,finish=job.status==='completed'?(typeof end==='string'?parseClock(end):end):null;
 if(!Number.isInteger(begin)||begin<0||begin>1439||(job.status==='completed'&&(!Number.isInteger(finish)||finish>1439||finish<=begin||finish-begin>600)))throw Error('Enter actual times in order, within a 10-hour visit.');
 if(data.jobs.some(item=>item.id!==id&&item.crew===job.crew&&item.serviceDate===job.serviceDate&&item.status==='completed'&&Number.isInteger(item.actualStart)&&Number.isInteger(item.actualEnd)&&begin<item.actualEnd&&(finish??begin+1)>item.actualStart))throw Error('These times overlap another completed visit for this crew.');
 job.actualStart=begin;if(job.status==='completed')job.actualEnd=finish;
 data.landscape?.activity.unshift({projectId:job.projectId||null,text:'Actual visit times were reviewed and saved.',date:job.serviceDate});return job;
}
