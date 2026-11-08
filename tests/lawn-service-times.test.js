import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import XLSX from 'xlsx';
import {defaultServiceTime,validateServiceTimeDefaults,reviewMissingServiceTimes,fillMissingServiceTimes} from '../lib/lawn-service-times.js';
import {normalizeOperations,archiveClient} from '../lib/lawn-workspace.js';
import {importLawnRows,planLawnDay} from '../lib/lawn.js';
import {recommendWeeklyPlan} from '../lib/lawn-week.js';
import {lawnWorkbookRows} from '../lib/lawn-intake.js';
import {validateBusinessWorkspace} from '../lib/business-workspaces.js';

const defaults={defaultMowMinutes:30,defaultEdgeMinutes:10,defaultMulchMinutes:60,defaultHedgeMinutes:25,setupMinutes:5};
function fixture(){return normalizeOperations({version:2,company:'Synthetic service-time test',date:'2026-11-09',clockDate:'2026-11-09',now:480,geographic:false,depot:{x:0,y:0},settings:{...defaults,marginBps:2500,minimumPrice:'0.00',laborBudgetMode:'scheduled'},crews:[{id:'A',name:'Test crew',members:2,workerRate:'30.00',equipmentRate:'0.00',overhead:'0.00',shiftStart:480,shiftEnd:990,breakStart:720,breakMinutes:30}],jobs:[{id:'J1',clientId:'C1',name:'Synthetic client',address:'Sample property',x:0,y:0,mow:true,edge:true,mulch:true,hedge:true,minutes:null,price:'200.00',materials:'0.00',status:'planned',crew:'A',serviceDate:'2026-11-09'}]});}

test('all requested service combinations add their defaults and count setup exactly once',()=>{
 const flags=['mow','edge','mulch','hedge'],values=[30,10,60,25];
 for(let mask=1;mask<16;mask++){const job=Object.fromEntries(flags.map((flag,index)=>[flag,!!(mask&(1<<index))])),estimate=defaultServiceTime(job,defaults),expected=5+values.reduce((sum,value,index)=>sum+(mask&(1<<index)?value:0),0);assert.equal(estimate.ready,true);assert.equal(estimate.minutes,expected);assert.equal(estimate.components.filter(item=>item.label==='Setup').length,1);assert.match(estimate.source,new RegExp(`${expected} crew min$`));}
 assert.equal(defaultServiceTime({hedge:true},{...defaults,setupMinutes:0}).minutes,25);
});

test('unconfigured specialty times never produce partial estimates and oversized totals remain unresolved',()=>{
 const unknown={...defaults,defaultMulchMinutes:null,defaultHedgeMinutes:null};
 assert.equal(defaultServiceTime({mow:true,edge:true},unknown).minutes,45);
 const estimate=defaultServiceTime({mow:true,mulch:true,hedge:true},unknown);assert.equal(estimate.minutes,null);assert.match(estimate.reason,/Mulching, Hedge maintenance/);
 assert.equal(defaultServiceTime({customService:'Planting',mow:true},defaults).ready,false);
 assert.equal(defaultServiceTime({},defaults).ready,false);
 assert.match(defaultServiceTime({mow:true,edge:true,mulch:true},{...defaults,defaultMowMinutes:300,defaultEdgeMinutes:300}).reason,/exceed 600/);
});

test('time defaults require bounded whole crew minutes, while blank specialty defaults are valid',()=>{
 assert.doesNotThrow(()=>validateServiceTimeDefaults({...defaults,defaultMulchMinutes:null,defaultHedgeMinutes:undefined,setupMinutes:0}));
 for(const key of ['defaultMowMinutes','defaultEdgeMinutes','defaultMulchMinutes','defaultHedgeMinutes'])for(const value of [0,-1,301,2.5,'30',NaN])assert.throws(()=>validateServiceTimeDefaults({...defaults,[key]:value}),/whole crew minutes/);
 for(const value of [-1,61,0.5,'5'])assert.throws(()=>validateServiceTimeDefaults({...defaults,setupMinutes:value}),/Setup/);
});

test('spreadsheet and manual intake share specialty estimates and preserve entered totals and prices',()=>{
 const data=fixture(),base={client_name:'New synthetic client',address:'Other sample property',mow:true,edge:true,mulch:true,hedge:true};
 const calculated=importLawnRows([base],data);assert.equal(calculated.jobs[0].minutes,130);assert.equal(calculated.jobs[0].price,null);assert.match(calculated.jobs[0].estimateSource,/Setup 5.*Mowing 30.*Mulching 60.*Hedge maintenance 25/);
 const entered=importLawnRows([{...base,estimated_minutes:80,job_price_usd:175}],data);assert.equal(entered.jobs[0].minutes,80);assert.equal(entered.jobs[0].price,'175.00');assert.equal(entered.jobs[0].estimateSource,'Owner spreadsheet estimate');
 data.settings.defaultMulchMinutes=null;assert.equal(importLawnRows([base],data).jobs[0].minutes,null);assert.equal(importLawnRows([{...base,estimated_minutes:80}],data).jobs[0].minutes,80);
 assert.equal(importLawnRows([{...base,estimated_minutes:0}],data).jobs.length,0);
});

test('real Excel booleans use specialty defaults when the Estimated Minutes cell is blank',()=>{
 const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Client Name','Address','Mowing','Mulching','Hedge Maintenance','Estimated Minutes'],['Excel synthetic client','Other sample property',true,true,true,'']]),'Customers');
 const reread=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}),rows=lawnWorkbookRows(reread,'Customers',XLSX).rows,result=importLawnRows(rows,fixture());assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].minutes,120);assert.match(result.jobs[0].source,/Excel/);
});

test('filling missing estimates preserves known times, reviewed prices, reports, archived clients and schedules',()=>{
 const data=fixture(),base=data.jobs[0];data.jobs=Array.from({length:8},(_,index)=>({...structuredClone(base),id:'J'+index,clientId:'C'+index}));normalizeOperations(data);
 data.jobs[1].minutes=77;data.jobs[1].estimateSource='Owner manual estimate';data.jobs[2].status='completed';data.jobs[2].actualStart=480;data.jobs[2].actualEnd=540;data.jobs[3].status='working';data.jobs[3].actualStart=550;data.jobs[4].status='skipped';archiveClient(data,'C5');data.jobs[6].customService='Patio installation';data.jobs[7].serviceDate=null;
 const before=structuredClone(data),review=reviewMissingServiceTimes(data);assert.deepEqual(data,before);assert.deepEqual(review.updates.map(row=>row.id),['J0','J7']);assert.equal(review.unresolved.length,1);
 const result=fillMissingServiceTimes(data);assert.equal(result.updates.length,2);for(const index of [1,2,3,4,5,6])assert.deepEqual(data.jobs[index],before.jobs[index]);
 for(const index of [0,7]){assert.equal(data.jobs[index].minutes,130);for(const key of ['price','serviceDate','crew','status','materials','actualStart','actualEnd'])assert.deepEqual(data.jobs[index][key],before.jobs[index][key]);}
 assert.equal(fillMissingServiceTimes(data).updates.length,0);
});

test('legacy workspaces retain missing specialty times until the owner configures and explicitly applies defaults',()=>{
 const data=fixture();delete data.settings.defaultMulchMinutes;delete data.settings.defaultHedgeMinutes;normalizeOperations(data);assert.equal(data.settings.defaultMulchMinutes,null);assert.equal(data.settings.defaultHedgeMinutes,null);assert.equal(data.jobs[0].minutes,null);
 const before=structuredClone(data);normalizeOperations(data);assert.deepEqual(data,before);Object.assign(data.settings,{defaultMulchMinutes:60,defaultHedgeMinutes:25});assert.equal(data.jobs[0].minutes,null);assert.equal(reviewMissingServiceTimes(data).updates.length,1);
});

test('partial specialty configuration fills only visits whose entire service list can be estimated',()=>{
 const data=fixture();data.settings.defaultMulchMinutes=null;data.jobs.push({...structuredClone(data.jobs[0]),id:'HEDGE',clientId:'HEDGE',mow:false,edge:false,mulch:false,hedge:true});normalizeOperations(data);
 const review=fillMissingServiceTimes(data);assert.deepEqual(review.updates.map(row=>row.id),['HEDGE']);assert.equal(data.jobs[0].minutes,null);assert.equal(data.jobs[1].minutes,30);
});

test('filled estimates feed daily worker costs and weekly scheduling without multiplying service time by headcount',()=>{
 const data=fixture();assert.equal(recommendWeeklyPlan(data,data.date,{estimateExtra:false}).count,0);fillMissingServiceTimes(data);
 const day=planLawnDay(data);assert.equal(day.routes[0].serviceMinutes,130);assert.equal(day.costs.J1.workerMinutes,260);assert.equal(day.costs.J1.labor,'130.00');assert.equal(day.revenue,'200.00');
 const week=recommendWeeklyPlan(data,data.date,{estimateExtra:false});assert.equal(week.count,1);assert.equal(week.issues.length,0);assert.equal(week.jobs[0].minutes,130);assert.equal(week.jobs[0].price,'200.00');
});

test('private workspace validation accepts configured defaults and rejects invalid specialty settings',()=>{
 const data=fixture();fillMissingServiceTimes(data);assert.equal(validateBusinessWorkspace({data,state:{}}).data.settings.defaultMulchMinutes,60);
 for(const value of [-1,0,301,1.5,'60']){const invalid=structuredClone(data);invalid.settings.defaultMulchMinutes=value;assert.throws(()=>validateBusinessWorkspace({data:invalid,state:{}}),/Mulching default/);}
});

test('the 37 specialty visits in the sample can be estimated without rewriting the other 13 visits',async()=>{
 const data=normalizeOperations(JSON.parse(await fs.readFile(new URL('../data/lawn-demo.json',import.meta.url),'utf8'))),before=structuredClone(data.jobs),missing=before.filter(job=>job.minutes===null).map(job=>job.id);assert.equal(missing.length,37);assert.equal(reviewMissingServiceTimes(data).updates.length,0);
 Object.assign(data.settings,defaults);assert.equal(fillMissingServiceTimes(data).updates.length,37);
 for(const job of data.jobs)if(missing.includes(job.id)){assert.equal(job.minutes,5+(job.mow?30:0)+(job.edge?10:0)+(job.mulch?60:0)+(job.hedge?25:0));assert.equal(job.price,null);}else assert.deepEqual(job,before.find(item=>item.id===job.id));
});
