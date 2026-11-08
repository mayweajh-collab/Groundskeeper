import {createBulkPriceReview,bulkPriceTotals,applyBulkJobPrices,undoBulkJobPrices} from '/assets/lawn-bulk-pricing.js';
import {services} from '/assets/lawn-engine.js';
import {visitClientKey} from '/assets/lawn-workspace.js';

export function createBulkPricingUI(api){
 const {esc,money,icon}=api;
 let review=null,selected=new Set(),query='',includeReviewed=false,selectionMode='all',clientPreset=null,lastChange=null;
 const dialog=document.createElement('dialog');dialog.id='bulk-price-dialog';dialog.className='modal large-modal bulk-price-dialog';dialog.setAttribute('aria-labelledby','bulk-price-title');document.body.append(dialog);
 const options=()=>({includeReviewed,optimized:!!api.getState().optimized,optimizedDate:api.getState().viewDate||api.getData().date});
 const dateLabel=value=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'Unscheduled';
 const button=(action,text,extra='',primary=false)=>`<button type="button" class="button ${primary?'primary':'secondary'}" data-bulk-pricing="${action}" ${extra}>${text}</button>`;
 function undoNotice(){return lastChange?`<div class="bulk-price-success" role="status"><span>${icon('check')}<strong>${lastChange.count} job ${lastChange.count===1?'price':'prices'} updated.</strong> Individual price review is still available.</span><button class="ops-link" data-bulk-pricing="undo">Undo bulk prices</button></div>`:'';}
 function panelHTML(){
  const data=api.getData();if(!data?.jobs.length)return '';
  const summary=createBulkPriceReview(data,options());
  return `<section class="panel bulk-price-panel" aria-labelledby="bulk-price-panel-title"><span class="bulk-price-panel-icon">${icon('tag')}</span><div><h2 id="bulk-price-panel-title">Price more jobs at once</h2><p>${summary.readyCount} jobs have suggestions${summary.reviewedCount?' · '+summary.reviewedCount+' already priced':''}${summary.needsDetailsCount?' · '+summary.needsDetailsCount+' need details':''}</p><small>Use saved job details and business pricing settings. Review all suggestions or choose individual jobs.</small></div><div class="bulk-price-panel-actions">${button('open-all','Review all suggestions','',true)}${button('choose','Choose jobs')}</div></section>${undoNotice()}`;
 }
 function resetReview(){
  const previous=selected;review=createBulkPriceReview(api.getData(),options());
  selected=new Set(review.rows.filter(row=>row.eligible&&(selectionMode==='all'||selectionMode==='clients'&&clientPreset?.has(row.id)||selectionMode==='choose'&&previous.has(row.id))).map(row=>row.id));
 }
 function open(mode='all'){
  if(!api.getData())return;
  includeReviewed=false;query='';selectionMode=mode;selected=new Set();clientPreset=null;
  if(mode==='clients'){const clients=new Set(api.getState().selectedClientIds||[]);clientPreset=new Set(api.getData().jobs.filter(job=>clients.has(visitClientKey(job))).map(job=>job.id));}
  resetReview();
  dialog.innerHTML=`<header class="bulk-price-header"><div><p class="eyebrow">PRICE STUDIO</p><h2 id="bulk-price-title">Bulk price review</h2><p>Review the suggested price for each job, then apply all eligible prices or your selection.</p></div><button type="button" class="ops-icon-button" data-bulk-pricing="close" aria-label="Close bulk price review">${icon('close')}</button></header><div class="bulk-price-scope"><span>${icon('users')}Active clients · Unstarted jobs · All service dates</span><small>Reported work and archived clients stay outside bulk pricing.</small></div><div class="bulk-price-toolbar"><label class="ops-search">${icon('search')}<span class="sr-only">Search bulk pricing jobs</span><input id="bulk-price-search" type="search" placeholder="Find a client, job, or address"></label><div class="bulk-price-selection-actions">${button('select-all','Select all eligible')}${button('clear','Clear selection')}${button('refresh','Refresh suggestions')}</div></div><label class="check-label bulk-price-include"><input id="bulk-price-include-reviewed" type="checkbox">Include jobs with a reviewed price</label><p class="bulk-price-policy" id="bulk-price-policy"></p><div class="bulk-price-counts" id="bulk-price-counts" aria-live="polite"></div><div class="bulk-price-table-scroll" tabindex="0" aria-label="Bulk price suggestions"><table class="bulk-price-table"><caption class="sr-only">Choose job prices to review. Existing prices are kept unless explicitly included.</caption><thead><tr><th class="bulk-price-check-cell"><input id="bulk-price-select-visible" type="checkbox" aria-label="Select all visible eligible jobs"></th><th>Job / client</th><th>Visit / crew</th><th class="number">Current price</th><th class="number">Suggested price</th><th>Pricing details</th></tr></thead><tbody id="bulk-price-rows"></tbody></table></div><div class="bulk-price-summary" id="bulk-price-summary" aria-live="polite"></div><p class="form-error" id="bulk-price-error" role="alert"></p><footer class="bulk-price-footer"><p>Prices are before tax. Applying prices updates the selected jobs in your business account.</p><div class="action-group">${button('close','Cancel')}${button('apply','Apply suggested prices','id="bulk-price-apply"',true)}</div></footer>`;
  paintRows();dialog.showModal();
 }
 function visibleRows(){const needle=query.toLowerCase().trim();return review.rows.filter(row=>!needle||[row.id,row.name,row.address,row.crewName,services(api.getData().jobs.find(job=>job.id===row.id)).join(' '),dateLabel(row.serviceDate)].join(' ').toLowerCase().includes(needle));}
 function paintRows(){
  const rows=visibleRows();
  dialog.querySelector('#bulk-price-rows').innerHTML=rows.map(row=>{
   const job=api.getData().jobs.find(job=>job.id===row.id),ready=row.suggestion.ready,checked=selected.has(row.id);
   return `<tr class="${checked?'is-selected':''}"><td class="bulk-price-check-cell"><label class="bulk-price-checkbox"><input class="bulk-price-row" type="checkbox" data-id="${esc(row.id)}" aria-label="Select price for ${esc(row.name)} · ${esc(row.id)}" ${checked?'checked':''} ${row.eligible?'':'disabled'}></label></td><td class="bulk-price-job"><strong>${esc(row.name)}</strong><small>${esc(row.address)}</small><small>${esc(services(job).join(' + '))} · ${esc(row.id)}</small></td><td data-label="Visit / crew">${dateLabel(row.serviceDate)}<small>${esc(row.crewName)}${row.minutes?' · '+row.minutes+' min':''}</small></td><td class="number" data-label="Current price">${row.previousPrice===null?'<span class="bulk-price-unpriced">Unpriced</span>':money(row.previousPrice,true)}</td><td class="number" data-label="Suggested price">${ready?`<strong>${money(row.suggestion.suggested,true)}</strong><small>${row.marginBps/100}% target margin</small>`:'—'}</td><td class="bulk-price-detail"><span class="bulk-price-state ${row.eligible?'ready':ready?'kept':'needs-details'}">${esc(row.reason)}</span>${ready?`<small>${esc(row.suggestion.basis)} · ${row.suggestion.travelMinutes} min travel / wait</small><small>${money(row.suggestion.cost,true)} modeled cost</small>`:job.status==='planned'?`<button class="ops-link" data-bulk-pricing="individual" data-id="${esc(row.id)}">Review this job →</button>`:''}</td></tr>`;
  }).join('')||'<tr><td colspan="6"><div class="ops-empty"><h3>No matching jobs</h3><p>Try another client, address, or service.</p></div></td></tr>';
  dialog.querySelector('#bulk-price-policy').textContent=includeReviewed?'Reviewed prices will be replaced only for jobs you select.':'Existing reviewed prices are kept. Turn on the option above to include them.';
  paintTotals();
 }
 function paintTotals(){
  const totals=bulkPriceTotals(review,selected),rows=visibleRows(),visible=new Set(rows.map(row=>row.id)),hidden=[...selected].filter(id=>!visible.has(id)).length,eligibleVisible=rows.filter(row=>row.eligible),selectedVisible=eligibleVisible.filter(row=>selected.has(row.id));
  dialog.querySelector('#bulk-price-counts').textContent=`${totals.count} selected · ${review.eligibleCount} eligible${hidden?' · '+hidden+' selected outside this search':''}${review.needsDetailsCount?' · '+review.needsDetailsCount+' need details':''}${review.excludedCount?' · '+review.excludedCount+' archived or skipped visits excluded':''}`;
  const all=dialog.querySelector('#bulk-price-select-visible');all.disabled=!eligibleVisible.length;all.checked=!!eligibleVisible.length&&selectedVisible.length===eligibleVisible.length;all.indeterminate=selectedVisible.length>0&&selectedVisible.length<eligibleVisible.length;
  const change=Number(totals.existingChange),changeText=totals.existingCount?(change===0?'No total change':(change<0?'Decrease ':'Increase ')+money(Math.abs(change),true))+' across '+totals.existingCount+' reviewed '+(totals.existingCount===1?'job':'jobs'):'Existing reviewed prices kept';
  dialog.querySelector('#bulk-price-summary').innerHTML=`<div><span>Selected jobs</span><strong>${totals.count}</strong><small>${totals.unpricedCount} newly priced${totals.existingCount?' · '+totals.existingCount+' already priced':''}</small></div><div><span>Selected job value</span><strong>${money(totals.total,true)}</strong><small>Suggested customer prices · before tax</small></div><div><span>Existing price changes</span><strong class="bulk-price-change-copy">${esc(changeText)}</strong><small>Other job prices stay as they are.</small></div>`;
  const apply=dialog.querySelector('#bulk-price-apply');apply.disabled=!totals.count;apply.textContent=`Apply suggested prices (${totals.count})`;
  dialog.querySelector('[data-bulk-pricing="select-all"]').textContent=query.trim()?'Select matching jobs':'Select all eligible';
 }
 document.addEventListener('click',event=>{
  const element=event.target.closest('[data-bulk-pricing]');if(!element)return;const action=element.dataset.bulkPricing;
  try{
   if(action==='open-all'||action==='choose'||action==='selected-clients'){open(action==='open-all'?'all':action==='choose'?'choose':'clients');return;}
   if(action==='close'){dialog.close();return;}
   if(action==='select-all'){selectionMode=query.trim()?'choose':'all';selected=new Set(visibleRows().filter(row=>row.eligible).map(row=>row.id));paintRows();}
   else if(action==='clear'){selectionMode='choose';selected.clear();paintRows();}
   else if(action==='refresh'){resetReview();dialog.querySelector('#bulk-price-error').textContent='';paintRows();}
   else if(action==='apply'){
    lastChange=applyBulkJobPrices(api.getData(),review,selected);dialog.close();api.save();api.render();api.toast(`${lastChange.count} suggested ${lastChange.count===1?'price applied':'prices applied'}. You can undo this bulk change.`);document.querySelector('[data-bulk-pricing="open-all"],[data-bulk-pricing="selected-clients"]')?.focus({preventScroll:true});
   }else if(action==='undo'){
    const count=undoBulkJobPrices(api.getData(),lastChange?.undo);lastChange=null;api.save();api.render();api.toast(`Previous prices restored for ${count} jobs.`);
   }else if(action==='individual'){dialog.close();api.getState().quoteJob=element.dataset.id;api.go('pricing');document.getElementById('quote-minutes')?.focus();}
  }catch(error){const target=dialog.open&&dialog.querySelector('#bulk-price-error');if(target)target.textContent=error.message;else api.toast(error.message);}
 });
 document.addEventListener('change',event=>{
  if(!dialog.open)return;
  if(event.target.id==='bulk-price-include-reviewed'){includeReviewed=event.target.checked;resetReview();dialog.querySelector('#bulk-price-error').textContent='';paintRows();}
  else if(event.target.matches('.bulk-price-row')){selectionMode='choose';event.target.checked?selected.add(event.target.dataset.id):selected.delete(event.target.dataset.id);event.target.closest('tr').classList.toggle('is-selected',event.target.checked);paintTotals();}
  else if(event.target.id==='bulk-price-select-visible'){selectionMode='choose';for(const row of visibleRows().filter(row=>row.eligible))event.target.checked?selected.add(row.id):selected.delete(row.id);paintRows();}
 });
 document.addEventListener('input',event=>{if(event.target.id==='bulk-price-search'){query=event.target.value;paintRows();}});
 return {panelHTML,undoNotice};
}
