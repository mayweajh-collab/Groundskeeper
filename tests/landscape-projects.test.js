import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {minor} from '../lib/finance.js';
import {normalizeOperations} from '../lib/lawn-workspace.js';
import {services,planLawnDay,startLawnJob} from '../lib/lawn.js';
import {ensureLandscapeWorkspace,landscapeCosts,landscapeOverdue,landscapeDate,landscapeVisits,landscapeNextVisit,landscapeAttention,assignLandscapeVisit,unscheduleLandscapeVisit,recordLandscapeTime} from '../lib/landscape-projects.js';

const demo=async()=>normalizeOperations(JSON.parse(await fs.readFile(new URL('../data/lawn-demo.json',import.meta.url),'utf8')));
function schedulingFixture(){
 return normalizeOperations({version:2,date:'2026-11-09',now:480,depot:{x:0,y:0},settings:{marginBps:2500,minimumPrice:'0.00',defaultMowMinutes:30,defaultEdgeMinutes:10,setupMinutes:5},crews:[{id:'A',name:'Willow crew',members:2,workerRate:'25.00',equipmentRate:'0.00',overhead:'0.00',shiftStart:480,shiftEnd:990,breakStart:720,breakMinutes:30}],jobs:[{id:'ONE',clientId:'C1',name:'Client One',address:'Sample property',x:35,y:0,mow:true,minutes:30,price:'90.00',materials:'0.00',crew:'A',status:'planned',serviceDate:'2026-11-10',windowStart:540,windowEnd:570},{id:'TWO',clientId:'C2',name:'Client Two',address:'Another property',x:70,y:0,mow:true,minutes:30,price:null,materials:'0.00',crew:'A',status:'planned',serviceDate:null}]});
}

test('project migration is repeatable and preserves existing visit prices, reports and dates',async()=>{
 const data=await demo(),before=structuredClone(data.jobs);ensureLandscapeWorkspace(data);
 assert.equal(data.landscape.projects.length,6);assert.equal(data.jobs.length,before.length+5);
 for(const original of before){const migrated=data.jobs.find(job=>job.id===original.id);for(const key of ['price','status','actualStart','actualEnd','serviceDate','minutes','crew'])assert.deepEqual(migrated[key],original[key]);}
 const snapshot=structuredClone(data);ensureLandscapeWorkspace(data);assert.deepEqual(data,snapshot);
 assert.equal(new Set(data.jobs.map(job=>job.id)).size,data.jobs.length);
 assert.equal(data.settings.dailyJobLimit,null);
 const limited=await demo();while(limited.jobs.length<149)limited.jobs.push({...limited.jobs[0],id:'EXTRA-'+limited.jobs.length});ensureLandscapeWorkspace(limited);assert.equal(limited.jobs.length,150);
});

test('patio cost forecast counts actuals and outstanding commitments once, with exact category reconciliation',async()=>{
 const data=await demo();ensureLandscapeWorkspace(data);const costs=landscapeCosts(data.landscape.projects.find(project=>project.id==='P-1005'));
 for(const [key,value] of Object.entries({budget:'12400.00',actual:'6200.00',committed:'4000.00',remaining:'2600.00',forecast:'12800.00',profit:'3200.00',variance:'-400.00'}))assert.equal(costs[key],value);
 assert.equal(costs.margin,20);
 for(const key of ['budget','actual','committed','remaining','forecast','variance'])assert.equal(minor(costs[key],{signed:true}),costs.rows.reduce((sum,row)=>sum+minor(row[key],{signed:true}),0n));
 for(const row of costs.rows){assert.equal(minor(row.forecast),minor(row.actual)+minor(row.committed)+minor(row.remaining));for(const key of ['actual','committed','remaining'])assert.equal(minor(row[key]),row.items.reduce((sum,item)=>sum+minor(item[key]),0n));}
});

test('cost validation rejects invalid input and allows a visible loss or missing contract value',async()=>{
 const data=await demo();ensureLandscapeWorkspace(data);const project=structuredClone(data.landscape.projects[0]);
 project.contractValue='0.00';assert.equal(landscapeCosts(project).margin,null);assert.equal(landscapeCosts(project).profit,'-1535.00');
 project.costs[0].remaining='-1.00';assert.throws(()=>landscapeCosts(project),/money/i);
 project.costs[0].remaining='1.001';assert.throws(()=>landscapeCosts(project),/decimal/);
 project.costs[0].remaining='350.00';project.costs.pop();assert.throws(()=>landscapeCosts(project),/four cost categories/);
});

test('overdue invoices use only outstanding balances as of the selected workday',async()=>{
 const data=await demo();ensureLandscapeWorkspace(data);assert.equal(landscapeOverdue(data,'2026-11-09').total,'2650.00');assert.equal(landscapeOverdue(data,'2026-11-09').invoices.length,2);
 data.landscape.invoices[0].paid='1100.00';assert.equal(landscapeOverdue(data,'2026-11-09').total,'1800.00');
 assert.throws(()=>landscapeDate('2026-02-30'),/date/);assert.throws(()=>landscapeDate(''),/date/);
});

test('assignment updates the shared visit, retains reviewed pricing and derives the next project visit',()=>{
 const data=schedulingFixture();data.landscape={projects:[{id:'P',jobIds:['TWO']}],activity:[]};data.jobs[1].projectId='P';
 assignLandscapeVisit(data,'TWO',{date:'2026-11-11',crewId:'A',start:'13:00',minutes:45});
 assert.equal(data.jobs[1].serviceDate,'2026-11-11');assert.equal(data.jobs[1].windowStart,780);assert.equal(data.jobs[1].price,null);assert.equal(data.jobs[0].price,'90.00');
 const planned=landscapeVisits(data,'2026-11-11');assert.equal(planned.scheduled.length,1);assert.equal(planned.scheduled[0].stop.start,780);assert.equal(landscapeNextVisit(data,data.landscape.projects[0]).id,'TWO');
 unscheduleLandscapeVisit(data,'TWO');assert.equal(data.jobs.length,2);assert.equal(data.jobs[1].serviceDate,null);assert.equal(data.jobs[1].crew,'');assert.equal(landscapeNextVisit(data,data.landscape.projects[0]),null);
});

test('schedule validation rejects conflicts, breaks, unavailable crews and reported moves without mutation',()=>{
 for(const [change,pattern]of [[{start:'09:00'},/conflicts/],[{start:'12:00'},/break/],[{start:'16:20'},/shift/],[{date:'2026-02-30'},/date/]]){
  const data=schedulingFixture(),before=structuredClone(data);assert.throws(()=>assignLandscapeVisit(data,'TWO',{date:'2026-11-10',crewId:'A',start:'10:00',minutes:30,...change}),pattern);assert.deepEqual(data,before);
 }
 const data=schedulingFixture();data.crews[0].unavailableDates=['2026-11-10'];assert.throws(()=>assignLandscapeVisit(data,'TWO',{date:'2026-11-10',crewId:'A',start:'10:00',minutes:30}),/unavailable/);
 Object.assign(data.jobs[0],{status:'completed',actualStart:540,actualEnd:570});assert.throws(()=>assignLandscapeVisit(data,'ONE',{date:'2026-11-11',crewId:'A',start:'10:00',minutes:30}),/unstarted/);assert.throws(()=>unscheduleLandscapeVisit(data,'ONE'),/unstarted/);
 const day=planLawnDay({...data,date:'2026-11-10'});assert.equal(day.completed,1);assert.equal(day.routes[0].stops[0].id,'ONE');
});

test('unavailable crews retain future work for review and custom landscape services are named explicitly',()=>{
 const data=schedulingFixture();data.crews[0].unavailableDates=['2026-11-10'];const plan=landscapeVisits(data,'2026-11-10');assert.equal(plan.scheduled.length,0);assert.match(plan.pending[0].reason,/unavailable/);
 assert.deepEqual(services({...data.jobs[0],mow:false,customService:'Patio installation'}),['Patio installation']);
 assert.throws(()=>startLawnJob({...data,clockDate:'2026-11-10'},'ONE'),/unavailable/);
});

test('missing actual times remain actionable without inventing costs or losing completed work',()=>{
 const data=schedulingFixture();Object.assign(data.jobs[0],{serviceDate:data.date,status:'completed',actualStart:null,actualEnd:null});
 const before=landscapeVisits(data,data.date);assert.equal(before.scheduled.length,0);assert.match(before.pending[0].reason,/actual start/);assert.equal(before.cost,'0.00');assert.equal(before.completed,1);assert.equal(landscapeAttention(data,data.date).find(item=>item.kind==='time').action,'time-entries');
 assert.throws(()=>recordLandscapeTime(data,'ONE',{start:'09:30',end:'09:00'}),/actual times/);assert.equal(data.jobs[0].actualStart,null);
 recordLandscapeTime(data,'ONE',{start:'09:00',end:'09:30'});assert.equal(landscapeVisits(data,data.date).scheduled[0].stop.serviceMinutes,30);assert.equal(data.jobs[0].price,'90.00');assert.equal(data.jobs[0].status,'completed');assert.equal(landscapeAttention(data,data.date).some(item=>item.kind==='time'),false);
});
