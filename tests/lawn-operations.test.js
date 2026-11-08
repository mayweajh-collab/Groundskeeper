import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {normalizeOperations,registerClients,archiveClient,restoreClient,activeClients,clientRecord,weekDates,validateTeam,visitsForDate} from '../lib/lawn-workspace.js';
import {planLawnDay,startLawnJob} from '../lib/lawn.js';
import {recommendLawnDay} from '../lib/lawn-planner.js';
import {roadPoints,parseRoadMatrix,roadMatrixMatches} from '../lib/lawn-roads.js';
import {recommendWeeklyPlan,workspaceForDay} from '../lib/lawn-week.js';
function matrix(data){const points=roadPoints(data),values=points.map((_,a)=>points.map((_,b)=>a===b?0:300));data.roadMatrix=parseRoadMatrix({code:'Ok',durations:values,distances:values,sources:points.map(point=>({distance:0,location:[point.longitude,point.latitude]}))},points,'2026-11-07T23:00:00Z');return data;}
function fixture(count=5){
 const crew={members:2,workerRate:'30.00',equipmentRate:'0.00',overhead:'0.00',shiftStart:480,shiftEnd:600,breakStart:600,breakMinutes:0};
 return matrix(normalizeOperations({version:2,date:'2026-11-09',now:480,geographic:true,depot:{latitude:39,longitude:-84},crews:[{...crew,id:'A',name:'Crew A'},{...crew,id:'B',name:'Crew B'}],settings:{marginBps:2500,minimumPrice:'0.00',defaultMowMinutes:30,defaultEdgeMinutes:10,setupMinutes:5},jobs:Array.from({length:count},(_,index)=>({id:'J'+index,clientId:'C'+index,name:'Client '+index,latitude:39+index*.001,longitude:-84.1,minutes:30,price:index===0?'60.00':null,materials:'0.00',status:'planned',crew:'A'}))}));
}
test('migration preserves clients and reports, is repeatable, and introduces no fixed job target',()=>{
 const data=fixture(),before=structuredClone(data);normalizeOperations(data);assert.deepEqual(data,before);assert.equal(data.settings.dailyJobLimit,null);assert.equal(data.crews[0].maxJobsPerDay,null);assert.equal(data.settings.totalMembers,4);assert.equal(data.jobs[0].price,'60.00');assert.equal(clientRecord(data,data.jobs[0]).stage,'existing');
 data.jobs[0].serviceDate=null;normalizeOperations(data);assert.equal(data.jobs[0].serviceDate,null);
});
test('archiving is reversible, removes future routing locations and retains client history and prices',()=>{
 const data=fixture(),beforeCount=data.jobs.length;archiveClient(data,'C0','2026-11-07T23:00:00Z');assert.equal(data.jobs.length,beforeCount);assert.equal(data.jobs[0].price,'60.00');assert.equal(activeClients(data).length,4);assert.equal(visitsForDate(data).length,4);assert.equal(roadMatrixMatches(data),false);assert.equal(roadPoints(data).length,5);
 restoreClient(data,'C0');assert.equal(activeClients(data).length,5);assert.equal(data.jobs[0].serviceDate,'2026-11-09');assert.equal(data.jobs[0].price,'60.00');
 data.jobs[0].status='working';assert.throws(()=>archiveClient(data,'C0'),/active job/);assert.equal(clientRecord(data,data.jobs[0]).archivedAt,null);
});
test('new and existing classifications and backlog dates are explicit for manual/imported clients',()=>{
 const data=fixture(),job={id:'NEW',clientId:'NEW',status:'planned'};registerClients(data,[job],{stage:'new',serviceDate:null,createdAt:'2026-11-07T23:00:00Z'});assert.equal(clientRecord(data,job).stage,'new');assert.equal(job.serviceDate,null);
 assert.throws(()=>registerClients(data,[job],{stage:'new',serviceDate:'2026-02-30'}),/date/);assert.deepEqual(weekDates('2026-11-15'),['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13']);
});
test('team size is enforced without inventing people and optional caps can be blank',()=>{
 const data=fixture();data.settings.totalMembers=6;data.crews.forEach(crew=>crew.members=3);assert.equal(validateTeam(data).assigned,6);data.settings.totalMembers=5;assert.throws(()=>validateTeam(data),/only 5/);data.settings.totalMembers=6;data.crews[0].maxJobsPerDay=0;assert.throws(()=>validateTeam(data),/optional crew limit/);
});
test('daily labor distinguishes elapsed crew time, worker-hours and full paid shifts',()=>{
 const data=fixture(1),day=planLawnDay(data);assert.equal(day.laborCost,'40.00');assert.equal(day.shiftLaborCost,'120.00');assert.equal(day.laborBudget,'120.00');assert.equal(day.peopleUsed,2);
 data.settings.laborBudgetMode='scheduled';assert.equal(planLawnDay(data).laborBudget,'40.00');data.crews[0].members=3;data.settings.totalMembers=5;assert.equal(planLawnDay(data).laborCost,'60.00');assert.equal(planLawnDay(data).routes[0].serviceMinutes,30);
});
test('daily and per-crew caps constrain unstarted work without hiding reported jobs',()=>{
 const data=fixture(5);data.settings.dailyJobLimit=2;data.crews.forEach(crew=>crew.maxJobsPerDay=1);const result=recommendLawnDay(data);assert.equal(result.plan.routes.reduce((sum,route)=>sum+route.stops.length,0),2);assert.equal(result.plan.unassigned.length,3);
 Object.assign(data.jobs[0],{status:'working',actualStart:480});data.settings.dailyJobLimit=1;const day=planLawnDay(data);assert.ok(day.routes[0].stops.some(stop=>stop.id==='J0'));assert.equal(day.working,1);
});
test('reported work can exceed a newly lowered cap and its labor budget never drops below modeled work',()=>{
 const data=fixture(2);data.settings.dailyJobLimit=1;data.crews[0].maxJobsPerDay=1;
 Object.assign(data.jobs[0],{status:'completed',actualStart:480,actualEnd:600});Object.assign(data.jobs[1],{status:'completed',actualStart:600,actualEnd:720});
 const plan=planLawnDay(data);assert.equal(plan.completed,2);assert.equal(plan.routes[0].stops.length,2);assert.equal(plan.overCapacity,true);assert.equal(plan.laborCost,'255.00');assert.equal(plan.laborBudget,'255.00');
});
test('a full-shift budget reconciles with per-job cent rounding when reported work exceeds a shift',()=>{
 const data=fixture(2);Object.assign(data.crews[0],{members:1,workerRate:'1.00',shiftEnd:481});Object.assign(data.jobs[0],{status:'completed',actualStart:480,actualEnd:481});Object.assign(data.jobs[1],{status:'completed',actualStart:481,actualEnd:482});
 const plan=planLawnDay(data);assert.equal(plan.laborCost,'0.29');assert.equal(plan.shiftLaborCost,'0.29');assert.equal(plan.laborBudget,'0.29');
});
test('daily planning lowers a full-shift budget while retaining all feasible jobs and reviewed prices',()=>{
 const data=fixture(2);data.jobs[1].crew='B';const current=planLawnDay(data),result=recommendLawnDay(data);assert.equal(current.crewsUsed,2);assert.equal(result.plan.crewsUsed,1);assert.equal(result.plan.laborBudget,'120.00');assert.equal(result.plan.unassigned.length,0);assert.equal(result.jobs.find(job=>job.id==='J0').price,'60.00');
});
test('weekly planning balances selected workload using shift capacity with no hard-coded five-job limit',()=>{
 const data=fixture(12),before=structuredClone(data),result=recommendWeeklyPlan(data,'2026-11-09'),counts=result.days.map(day=>day.plan.routes.reduce((sum,route)=>sum+route.stops.length,0));
 assert.equal(result.count,12);assert.equal(result.issues.length,0);assert.ok(Math.max(...counts)-Math.min(...counts)<=1);assert.equal(new Set(result.jobs.map(job=>job.id)).size,12);assert.deepEqual(data,before);
 for(const day of result.days){assert.ok(day.plan.peopleUsed<=data.settings.totalMembers);assert.ok(day.plan.routes.every(route=>route.finish<=600));for(const job of day.plan.jobs)assert.equal(job.serviceDate,day.date);}
 const five=recommendWeeklyPlan(fixture(5),'2026-11-09');assert.deepEqual(five.days.map(day=>day.plan.jobs.length),[1,1,1,1,1]);
});
test('an extra-staffing scenario is separate from the feasible plan and never invents available workers',()=>{
 const data=fixture(20);data.crews=data.crews.slice(0,1);data.settings.totalMembers=2;const before=structuredClone(data),result=recommendWeeklyPlan(data,'2026-11-09');
 assert.equal(result.count,15);assert.equal(result.peakCrews,1);assert.equal(result.peakPeople,2);assert.equal(result.staffingScenario.additionalCrews,1);assert.equal(result.staffingScenario.additionalPeople,2);assert.equal(result.staffingScenario.knownJobs,20);assert.equal(result.staffingScenario.crewsUsed,2);assert.deepEqual(data,before);assert.ok(result.jobs.every(job=>job.crew==='A'));
});
test('optional weekly caps overflow to an explicit backlog and preserve every record',()=>{
 const data=fixture(20);data.settings.dailyJobLimit=3;data.crews.forEach(crew=>crew.maxJobsPerDay=2);const result=recommendWeeklyPlan(data,'2026-11-09');assert.equal(result.count,15);assert.equal(result.issues.length,5);assert.equal(result.jobs.filter(job=>job.serviceDate===null).length,5);assert.equal(result.jobs.length,20);assert.ok(result.days.every(day=>day.plan.jobs.length<=3));
});
test('weekly scheduling respects reported work, locked days, excluded weeks and missing estimates',()=>{
 const data=fixture(6);Object.assign(data.jobs[0],{status:'working',actualStart:480,serviceDate:'2026-11-09'});Object.assign(data.jobs[1],{dateLocked:true,serviceDate:'2026-11-10'});data.jobs[2].serviceDate='2026-11-16';data.jobs[3].minutes=null;archiveClient(data,'C4');matrix(data);
 const result=recommendWeeklyPlan(data,'2026-11-09'),job=id=>result.jobs.find(job=>job.id===id);assert.equal(job('J0').crew,'A');assert.equal(job('J0').actualStart,480);assert.equal(job('J0').price,'60.00');assert.equal(job('J1').serviceDate,'2026-11-10');assert.equal(job('J2').serviceDate,'2026-11-16');assert.equal(job('J3').serviceDate,null);assert.equal(job('J4').serviceDate,'2026-11-09');assert.ok(result.issues.some(issue=>issue.id==='J3'));assert.equal(result.jobs.length,6);
 data.jobs[5].serviceDate='2026-11-10';assert.throws(()=>startLawnJob(data,'J5'),/demo workday/);assert.equal(workspaceForDay(data,'2026-11-10').now,480);
});
test('the supplied customer seed remains intact while its week accounts for missing service durations',async()=>{
 const data=normalizeOperations(JSON.parse(await fs.readFile(new URL('../data/lawn-demo.json',import.meta.url),'utf8'))),result=recommendWeeklyPlan(data,data.date);assert.equal(result.jobs.length,50);assert.equal(result.count,13);assert.equal(result.issues.length,37);assert.equal(result.jobs.filter(job=>job.price!==null).length,0);assert.ok(result.days.every(day=>day.plan.peopleUsed<=data.settings.totalMembers));
});
