import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {quoteJob,planLawnDay,startLawnJob,finishLawnJob,completionDraft,importLawnRows} from '../lib/lawn.js';
import {minor} from '../lib/finance.js';
import {createServer} from '../server.js';
const fixture=async()=>JSON.parse(await fs.readFile(new URL('../data/lawn-routing-sample.json',import.meta.url),'utf8'));

test('quote math counts worker-hours and distinguishes margin from markup',()=>{
 const crew={members:2,workerRate:'60.00',equipmentRate:'0.00',overhead:'0.00',shiftStart:480,shiftEnd:1020};
 const result=quoteJob({minutes:30,crew,marginBps:2500});
 assert.equal(result.workerMinutes,60);assert.equal(result.cost,'60.00');assert.equal(result.suggested,'80.00');
 assert.equal(result.modeledMargin,25);
 assert.equal(quoteJob({minutes:30,crew,marginBps:2500,minimum:'90.00'}).suggested,'90.00');
 assert.throws(()=>quoteJob({minutes:30,crew,marginBps:10000}));
});
test('routing preserves every visit and locked reports while improving the same travel model',async()=>{
 const data=await fixture(),base=planLawnDay(data),optimized=planLawnDay(data,true);
 assert.equal(base.unassigned.length,0);assert.equal(optimized.unassigned.length,0);
 assert.equal(new Set(optimized.routes.flatMap(r=>r.stops.map(s=>s.id))).size,12);
 assert.ok(optimized.travelMinutes<base.travelMinutes);
 assert.deepEqual(optimized.routes[0].stops.slice(0,2).map(s=>s.id),['J01','J02']);
 assert.equal(optimized.routes[0].stops[0].start,495);assert.equal(optimized.routes[0].stops[0].end,530);
 assert.ok(minor(optimized.travelCost)<minor(base.travelCost));
 assert.equal(optimized.revenue,base.revenue);
});
test('unknown coordinates and shift overflow remain visible instead of losing work',async()=>{
 const data=await fixture();data.jobs[2].x=null;data.jobs[3].minutes=600;
 const result=planLawnDay(data,true),ids=result.routes.flatMap(r=>r.stops.map(s=>s.id));
 assert.equal(ids.length+result.unassigned.length,12);
 assert.equal(result.unassigned.find(j=>j.id==='J03').reason,'Needs a map pin');
 assert.ok(result.unassigned.some(j=>j.id==='J04'));
});
test('day cost reconciles exactly to modeled job costs',async()=>{
 const data=await fixture(),result=planLawnDay(data,true);
 assert.equal(minor(result.cost),Object.values(result.costs).reduce((sum,c)=>sum+minor(c.cost),0n));
 for(const cost of Object.values(result.costs))assert.equal(minor(cost.cost),['labor','travel','equipment','materials','overhead'].reduce((sum,key)=>sum+minor(cost[key]),0n));
 assert.equal(result.completed,2);assert.equal(result.working,1);
});
test('crew reporting blocks concurrent jobs, invalid times and unsupported completed services',async()=>{
 const data=await fixture();assert.throws(()=>startLawnJob(data,'J03'),/current job/);
 assert.throws(()=>finishLawnJob(data,'J02',{start:550,end:549,completedServices:['Mowing']}));
 assert.throws(()=>finishLawnJob(data,'J02',{start:550,end:590,completedServices:['Tree removal']}));
 finishLawnJob(data,'J02',{start:550,end:590,completedServices:['Mowing']});
 assert.equal(data.jobs[1].status,'completed');assert.deepEqual(data.jobs[1].completedServices,['Mowing']);
 assert.throws(()=>completionDraft(data.jobs[1],data.date),/partially completed/);
 data.jobs[1].completionPriceReviewed=true;assert.match(completionDraft(data.jobs[1],data.date).body,/Services completed: Mowing\./);
 startLawnJob(data,'J03');assert.equal(data.jobs[2].actualStart,590);
});
test('completion drafts use actual services and reviewed job prices, with no send operation',async()=>{
 const data=await fixture(),job=data.jobs[0];
 const message=completionDraft(job,data.date);assert.equal(message.to,job.email);assert.match(message.body,/\$78\.00/);assert.match(message.body,/Mowing and Edging/);assert.match(message.body,/no email has been sent/);
 assert.throws(()=>completionDraft(data.jobs[2],data.date),/completed/);
 assert.throws(()=>completionDraft({...job,price:null},data.date),/price/);
 assert.throws(()=>completionDraft({...job,email:''},data.date),/email/);
});
test('CSV intake distinguishes unknown price and default duration from explicit values',async()=>{
 const data=await fixture();const rows=[{client_id:'NEW1',client_name:'Demo Person',address:'New sample address',email:'demo@example.com',mow:'yes',edge:'yes',job_price_usd:'',estimated_minutes:''},{client_id:'BAD1',client_name:'',address:'Somewhere',mow:'yes',edge:'no'},{client_id:'C01',client_name:'Duplicate',address:'Known',mow:'yes',edge:'no'}];
 const result=importLawnRows(rows,data);assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].price,null);assert.equal(result.jobs[0].minutes,45);assert.equal(result.jobs[0].x,null);
 assert.ok(result.issues.some(i=>i.message.includes('defaults')));assert.equal(result.issues.filter(i=>i.severity==='error').length,2);
});
test('lawn interface and demo API expose only allowlisted assets',async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{assert.match(await (await fetch(base+'/')).text(),/Groundskeeper/);assert.equal((await (await fetch(base+'/api/lawn/demo')).json()).jobs.length,50);assert.equal((await fetch(base+'/assets/lawn-engine.js')).status,200);assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/api/lawn/demo',{headers:{Origin:'https://example.com'}})).status,403);}
 finally{await new Promise(resolve=>server.close(resolve));}
});
