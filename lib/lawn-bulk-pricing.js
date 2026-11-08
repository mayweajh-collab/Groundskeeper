import {minor,amount} from './finance.js';
import {planLawnDay,quoteJob} from './lawn.js';
import {suggestJobPrice,planningFingerprint} from './lawn-planner.js';
import {workspaceForDay} from './lawn-week.js';
import {isClientArchived,validServiceDate} from './lawn-workspace.js';

export function jobPriceSuggestion(data,job,options={},plans=new Map()){
 if(!Number.isInteger(job?.minutes)||job.minutes<1)return {ready:false,reason:'Add a service-time estimate'};
 const crew=data.crews.find(item=>item.id===job.crew);if(!crew)return {ready:false,reason:'Choose a crew'};
 if(job.quoteInputs?.travelMinutes!==undefined&&job.quoteInputs.travelMinutes!==null){
  try{return {ready:true,...quoteJob({minutes:job.minutes,travelMinutes:job.quoteInputs.travelMinutes,crew,materials:job.materials||'0.00',marginBps:job.quoteInputs.marginBps??data.settings.marginBps,minimum:job.quoteInputs.minimum??data.settings.minimumPrice}),travelMinutes:job.quoteInputs.travelMinutes,basis:'Saved travel allowance'};}catch(error){return {ready:false,reason:error.message};}
 }
 if(job.serviceDate&&!validServiceDate(job.serviceDate))return {ready:false,reason:'Choose a valid service date'};
 const date=job.serviceDate||(data.schedulingEnabled?null:data.date);
 try{
  if(date&&!plans.has(date))plans.set(date,planLawnDay(workspaceForDay(data,date),!!options.optimized&&options.optimizedDate===date));
  return suggestJobPrice(data,job,date?plans.get(date):{routes:[]});
 }catch(error){return {ready:false,reason:error.message};}
}

export function createBulkPriceReview(data,options={}){
 const settings={includeReviewed:!!options.includeReviewed,optimized:!!options.optimized,optimizedDate:options.optimizedDate||data.date},plans=new Map();
 const rows=data.jobs.filter(job=>!isClientArchived(data,job)&&job.status!=='skipped').map(job=>{
  const reviewed=job.price!==null&&job.price!==undefined;
  const suggestion=job.status==='planned'?jobPriceSuggestion(data,job,settings,plans):{ready:false,reason:job.status==='completed'?'Completed visit — review individually':'Work has started — review individually'};
  const eligible=job.status==='planned'&&suggestion.ready&&(!reviewed||settings.includeReviewed);
  return {id:job.id,name:job.name,address:job.address,serviceDate:job.serviceDate||null,crewId:job.crew,crewName:data.crews.find(crew=>crew.id===job.crew)?.name||'Unassigned',reviewed,previousPrice:reviewed?amount(minor(job.price)):null,eligible,reason:!suggestion.ready?suggestion.reason:reviewed&&!settings.includeReviewed?'Reviewed price kept':'Ready to apply',suggestion,minutes:job.minutes,materials:job.materials||'0.00',marginBps:job.quoteInputs?.marginBps??data.settings.marginBps,minimum:job.quoteInputs?.minimum??data.settings.minimumPrice};
 });
 return {fingerprint:planningFingerprint(data),options:settings,rows,readyCount:rows.filter(row=>row.suggestion.ready).length,eligibleCount:rows.filter(row=>row.eligible).length,reviewedCount:rows.filter(row=>row.reviewed&&row.suggestion.ready).length,needsDetailsCount:rows.filter(row=>!row.suggestion.ready&&data.jobs.find(job=>job.id===row.id).status==='planned').length,excludedCount:data.jobs.length-rows.length};
}

export function bulkPriceTotals(review,selectedIds){
 const selected=new Set(selectedIds),rows=review.rows.filter(row=>row.eligible&&selected.has(row.id));
 const priced=rows.filter(row=>row.reviewed);
 return {count:rows.length,total:amount(rows.reduce((sum,row)=>sum+minor(row.suggestion.suggested),0n)),unpricedCount:rows.filter(row=>!row.reviewed).length,existingCount:priced.length,existingChange:amount(priced.reduce((sum,row)=>sum+minor(row.suggestion.suggested)-minor(row.previousPrice),0n))};
}
const reviewedFields=['price','quoteInputs','completionPriceReviewed','bulkPriceReview'];
const priceSnapshot=job=>Object.fromEntries(reviewedFields.filter(key=>Object.hasOwn(job,key)).map(key=>[key,structuredClone(job[key])]));
const priceGuard=job=>JSON.stringify({...priceSnapshot(job),crew:job.crew,minutes:job.minutes,materials:job.materials,status:job.status,serviceDate:job.serviceDate});
export function applyBulkJobPrices(data,review,selectedIds,{reviewedAt=new Date().toISOString()}={}){
 const ids=[...new Set(selectedIds)];if(!ids.length)throw Error('Select at least one eligible job.');
 const current=createBulkPriceReview(data,review.options);
 if(current.fingerprint!==review.fingerprint)throw Error('Job details or route estimates changed. Refresh suggestions and review them again.');
 const changes=ids.map(id=>{
  const row=current.rows.find(item=>item.id===id),preview=review.rows.find(item=>item.id===id),job=data.jobs.find(item=>item.id===id);
  if(!row?.eligible||!preview?.eligible||!job)throw Error('A selected job is no longer eligible. Refresh suggestions before applying.');
  if(JSON.stringify(row.suggestion)!==JSON.stringify(preview.suggestion))throw Error('A suggested price changed. Refresh suggestions and review it again.');
  return {job,row,before:priceSnapshot(job)};
 });
 const undo=[];
 for(const {job,row,before}of changes){
  Object.assign(job,{price:row.suggestion.suggested,completionPriceReviewed:true,quoteInputs:{...job.quoteInputs,marginBps:row.marginBps,minimum:amount(minor(row.minimum))},bulkPriceReview:{reviewedAt,price:row.suggestion.suggested,cost:row.suggestion.cost,travelMinutes:row.suggestion.travelMinutes,basis:row.suggestion.basis}});
  undo.push({id:job.id,before,after:priceGuard(job)});
 }
 return {...bulkPriceTotals(current,ids),undo};
}
export function undoBulkJobPrices(data,undo){
 if(!Array.isArray(undo)||!undo.length)throw Error('There is no bulk price change to undo.');
 for(const change of undo){const job=data.jobs.find(item=>item.id===change.id);if(!job||isClientArchived(data,job)||job.status!=='planned'||priceGuard(job)!==change.after)throw Error('These jobs changed after bulk review. Their current details have been kept; review prices individually.');}
 for(const change of undo){const job=data.jobs.find(item=>item.id===change.id);for(const key of reviewedFields)if(Object.hasOwn(change.before,key))job[key]=structuredClone(change.before[key]);else delete job[key];}
 return undo.length;
}
