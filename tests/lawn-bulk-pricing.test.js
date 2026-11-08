import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOperations,archiveClient} from '../lib/lawn-workspace.js';
import {roadPoints,parseRoadMatrix} from '../lib/lawn-roads.js';
import {createBulkPriceReview,bulkPriceTotals,applyBulkJobPrices,undoBulkJobPrices,jobPriceSuggestion} from '../lib/lawn-bulk-pricing.js';

function fixture(){
 const crew={members:2,workerRate:'60.00',equipmentRate:'6.00',overhead:'5.00',shiftStart:480,shiftEnd:1020,breakStart:720,breakMinutes:30};
 const jobs=Array.from({length:9},(_,index)=>({id:'J'+(index+1),clientId:'C'+(index+1),name:'Client '+(index+1),address:'Synthetic property '+(index+1),latitude:39+index*.001,longitude:-84.1,mow:true,minutes:30,price:null,materials:'0.00',crew:'A',serviceDate:'2026-11-09',status:'planned'}));
 jobs[1].price='90.00';jobs[2].minutes=null;jobs[3].serviceDate=null;jobs[3].crew='B';jobs[3].minutes=45;jobs[3].quoteInputs={travelMinutes:12,marginBps:5000,minimum:'20.00'};
 jobs[4].serviceDate='2026-11-10';jobs[4].clientId='C1';delete jobs[4].price;
 Object.assign(jobs[5],{crew:'B',status:'completed',actualStart:480,actualEnd:510,price:'75.00',completedServices:['Mowing']});Object.assign(jobs[6],{crew:'B',status:'working',actualStart:525,price:'65.00'});jobs[7].status='skipped';
 const data=normalizeOperations({version:2,date:'2026-11-09',now:480,geographic:true,company:'Test landscaping',depot:{latitude:39,longitude:-84},settings:{marginBps:2500,minimumPrice:'0.00'},crews:[{...crew,id:'A',name:'Willow'},{...crew,id:'B',name:'Clover'}],jobs,landscape:{projects:[],invoices:[],activity:[]}});
 archiveClient(data,'C9');const points=roadPoints(data),values=points.map((_,a)=>points.map((_,b)=>a===b?0:300));data.roadMatrix=parseRoadMatrix({code:'Ok',durations:values,distances:values,sources:points.map(point=>({distance:0,location:[point.longitude,point.latitude]}))},points,'2026-11-09T08:00:00Z');return data;
}

test('bulk review is read-only and excludes archived, skipped, reported and already reviewed work by default',()=>{
 const data=fixture(),before=structuredClone(data),review=createBulkPriceReview(data);
 assert.deepEqual(data,before);assert.equal(review.eligibleCount,3);assert.equal(review.readyCount,4);assert.equal(review.reviewedCount,1);assert.equal(review.needsDetailsCount,1);assert.equal(review.excludedCount,2);
 assert.deepEqual(review.rows.filter(row=>row.eligible).map(row=>row.id),['J1','J4','J5']);assert.match(review.rows.find(row=>row.id==='J2').reason,/Reviewed price kept/);assert.match(review.rows.find(row=>row.id==='J3').reason,/estimate/);
});
test('route allocation, the return leg and the correct service day reconcile to exact prices',()=>{
 const data=fixture(),review=createBulkPriceReview(data),row=id=>review.rows.find(row=>row.id===id);
 assert.equal(row('J1').suggestion.travelMinutes,5);assert.equal(row('J1').suggestion.cost,'78.00');assert.equal(row('J1').suggestion.suggested,'104.00');
 assert.equal(row('J2').suggestion.travelMinutes,10);assert.equal(row('J2').suggestion.suggested,'117.33');assert.equal(row('J5').suggestion.travelMinutes,10);assert.equal(row('J5').suggestion.suggested,'117.33');assert.equal(row('J5').suggestion.basis,'Current day route');
});
test('saved travel, individual margins and minimum prices are honored; unscheduled travel is explicit',()=>{
 const data=fixture(),job=data.jobs[3],saved=jobPriceSuggestion(data,job);assert.equal(saved.basis,'Saved travel allowance');assert.equal(saved.suggested,'247.00');assert.equal(saved.cost,'123.50');
 delete job.quoteInputs;const standalone=jobPriceSuggestion(data,job);assert.equal(standalone.basis,'Standalone return trip');assert.equal(standalone.travelMinutes,10);assert.equal(standalone.suggested,'159.33');
 data.jobs[0].quoteInputs={marginBps:5000,minimum:'200.00'};assert.equal(jobPriceSuggestion(data,data.jobs[0]).suggested,'200.00');
});
test('accepting all eligible prices updates only planned unpriced jobs and preserves schedules, expenses and reviewed quotes',()=>{
 const data=fixture(),before=structuredClone(data),review=createBulkPriceReview(data),ids=review.rows.filter(row=>row.eligible).map(row=>row.id),result=applyBulkJobPrices(data,review,ids);
 assert.equal(result.count,3);assert.equal(result.total,'468.33');assert.equal(data.jobs[0].price,'104.00');assert.equal(data.jobs[3].price,'247.00');assert.equal(data.jobs[4].price,'117.33');
 for(const index of [1,2,5,6,7,8])assert.deepEqual(data.jobs[index],before.jobs[index]);
 for(const index of [0,3,4])for(const key of ['minutes','materials','crew','serviceDate','status','actualStart','actualEnd'])assert.deepEqual(data.jobs[index][key],before.jobs[index][key]);
 assert.deepEqual(data.crews,before.crews);assert.deepEqual(data.landscape,before.landscape);assert.equal(data.jobs[0].quoteInputs.travelMinutes,undefined);assert.equal(data.jobs[3].quoteInputs.travelMinutes,12);
});
test('selection applies by visit ID even when two visits belong to the same client',()=>{
 const data=fixture(),before=structuredClone(data),review=createBulkPriceReview(data);applyBulkJobPrices(data,review,['J1','J1']);assert.equal(data.jobs[0].price,'104.00');assert.deepEqual(data.jobs[4],before.jobs[4]);assert.equal(data.jobs[0].clientId,data.jobs[4].clientId);
});
test('replacing a reviewed quote requires explicit inclusion and totals distinguish new value from existing price changes',()=>{
 const data=fixture(),safe=createBulkPriceReview(data),before=structuredClone(data);assert.throws(()=>applyBulkJobPrices(data,safe,['J1','J2']),/eligible/);assert.deepEqual(data,before);
 const review=createBulkPriceReview(data,{includeReviewed:true}),totals=bulkPriceTotals(review,['J1','J2']);assert.equal(totals.total,'221.33');assert.equal(totals.existingChange,'27.33');assert.equal(totals.existingCount,1);assert.equal(totals.unpricedCount,1);
 applyBulkJobPrices(data,review,['J2']);assert.equal(data.jobs[1].price,'117.33');assert.equal(data.jobs[0].price,null);
});
test('missing estimates and road data are never replaced with invented zero-cost suggestions',()=>{
 const data=fixture();data.roadMatrix=null;const review=createBulkPriceReview(data);assert.deepEqual(review.rows.filter(row=>row.eligible).map(row=>row.id),['J4']);assert.equal(review.rows.find(row=>row.id==='J1').suggestion.ready,false);assert.equal(review.rows.find(row=>row.id==='J3').suggestion.ready,false);
 assert.throws(()=>applyBulkJobPrices(data,review,['J4','J3']),/eligible/);assert.equal(data.jobs[3].price,null);
});
test('stale or altered previews are rejected atomically',()=>{
 for(const mutate of [data=>data.jobs[0].minutes++,data=>data.crews[0].workerRate='61.00',data=>data.roadMatrix.fetchedAt='2026-11-09T09:00:00Z']){
  const data=fixture(),review=createBulkPriceReview(data);mutate(data);const before=structuredClone(data);assert.throws(()=>applyBulkJobPrices(data,review,['J1','J4']),/changed/);assert.deepEqual(data,before);
 }
 const data=fixture(),review=createBulkPriceReview(data);review.rows.find(row=>row.id==='J1').suggestion.suggested='0.01';assert.throws(()=>applyBulkJobPrices(data,review,['J1']),/changed/);assert.equal(data.jobs[0].price,null);
});
test('undo restores exact prior price fields and refuses to overwrite later edits or reported work',()=>{
 const data=fixture(),before=structuredClone(data),review=createBulkPriceReview(data),result=applyBulkJobPrices(data,review,['J1','J4','J5']);assert.equal(undoBulkJobPrices(data,result.undo),3);assert.deepEqual(data,before);
 const updated=applyBulkJobPrices(data,createBulkPriceReview(data),['J1','J4']);data.jobs[0].price='333.00';const edited=structuredClone(data);assert.throws(()=>undoBulkJobPrices(data,updated.undo),/changed/);assert.deepEqual(data,edited);
});
test('zero-dollar suggestions remain valid explicit reviewed prices when costs and minimums are zero',()=>{
 const data=fixture();for(const crew of data.crews)Object.assign(crew,{workerRate:'0.00',equipmentRate:'0.00',overhead:'0.00'});data.jobs[0].materials='0.00';const review=createBulkPriceReview(data);assert.equal(review.rows[0].suggestion.suggested,'0.00');applyBulkJobPrices(data,review,['J1']);assert.equal(data.jobs[0].price,'0.00');assert.equal(createBulkPriceReview(data).rows[0].reviewed,true);
});
