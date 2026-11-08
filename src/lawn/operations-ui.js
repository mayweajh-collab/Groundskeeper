import {planLawnDay,validateCrew,clockInput,parseClock,services} from '/assets/lawn-engine.js';
import {parseCoordinates,hasCoordinates} from '/assets/lawn-geo.js';
import {clientRecord,isClientArchived,visitClientKey,isReportedVisit,activeClients,archiveClient,restoreClient,registerClients,normalizeOperations,weekDates,validServiceDate,validateTeam} from '/assets/lawn-workspace.js';
import {workspaceForDay,recommendWeeklyPlan} from '/assets/lawn-week.js';
import {suggestJobPrice,planningFingerprint} from '/assets/lawn-planner.js';

export function createOperationsUI(api){
 const {esc,money,clockLabel,dateText,toast}=api,data=()=>api.getData(),state=()=>api.getState();
 let proposal=null,crewDraft=[],archiveIds=[];
 const selectedDate=()=>state().viewDate||data().date;
 const crewText=count=>count+' '+(count===1?'crew':'crews');
 const selectedClients=()=>new Set(state().selectedClientIds||[]);
 const optionalNumber=(id,fallback=null)=>{const field=document.getElementById(id);return field?field.value.trim()===''?null:Number(field.value):fallback;};
 const clientStage=job=>clientRecord(data(),job).stage==='new'?'New client':'Existing client';
 const dayPlan=date=>date===selectedDate()?api.getPlan():planLawnDay(workspaceForDay(data(),date),false);
 const shortDate=date=>validServiceDate(date)?new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')):'Unscheduled';
 const dayCount=plan=>plan.routes.reduce((sum,route)=>sum+route.stops.length,0);
 const refresh=()=>{api.save();api.render();};
 function invalidate(){proposal=null;delete state().dayPlanBackup;delete state().weekPlanBackup;}
 function dialogs(){
  document.body.insertAdjacentHTML('beforeend',`<dialog id="ops-archive-dialog" class="modal" aria-labelledby="ops-archive-title"><div class="dialog-top"><div><p class="eyebrow">A TIDIER CLIENT LIST</p><h2 id="ops-archive-title">Remove clients from active work</h2></div><button class="icon-button" type="button" data-close aria-label="Close client removal">×</button></div><div id="ops-archive-body"></div><p class="field-hint">Completed visit records and reviewed prices are retained. You can restore clients from the Archived filter.</p><p class="form-error" id="ops-archive-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" data-close>Keep clients</button><button class="button primary" data-ops="confirm-archive">Archive clients</button></div></dialog><dialog id="ops-week-dialog" class="modal large-modal ops-week-dialog" aria-labelledby="ops-week-title"><div class="dialog-top"><div><p class="eyebrow">A CLEARER WORKWEEK</p><h2 id="ops-week-title">Review the suggested week</h2></div><button type="button" class="icon-button" data-close aria-label="Close weekly proposal">×</button></div><div id="ops-week-proposal"></div><p class="form-error" id="ops-week-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" data-close>Keep current schedule</button><button class="button primary" data-ops="apply-week" id="ops-apply-week" disabled>Apply weekly plan</button></div></dialog>`);
 }
 dialogs();
 function filterClient(job){const mode=state().clientFilter||'active',archived=isClientArchived(data(),job);return mode==='archived'?archived:!archived&&(mode==='active'||clientRecord(data(),job).stage===mode);}
 function clientToolbar(){
  const counts={active:0,new:0,existing:0,archived:0},seen=new Set();
  for(const job of data().jobs){const id=visitClientKey(job);if(seen.has(id))continue;seen.add(id);if(isClientArchived(data(),job))counts.archived++;else{counts.active++;counts[clientRecord(data(),job).stage==='new'?'new':'existing']++;}}
  return `<div class="client-toolbar"><div class="client-filter-tabs" aria-label="Client group">${[['active','Active'],['new','New clients'],['existing','Existing clients'],['archived','Archived']].map(([key,label])=>`<button data-ops="client-filter" data-value="${key}" aria-pressed="${(state().clientFilter||'active')===key}">${label} <span>${counts[key]}</span></button>`).join('')}</div><div class="action-group"><button class="button secondary" data-bulk-pricing="selected-clients" ${selectedClients().size&&state().clientFilter!=='archived'?'':'disabled'}>Price selected clients (${selectedClients().size})</button><button class="button secondary" data-ops="${state().clientFilter==='archived'?'restore-selected':'archive-selected'}" ${selectedClients().size?'':'disabled'}>${state().clientFilter==='archived'?'Restore':'Archive'} selected (${selectedClients().size})</button>${state().lastArchived?.length?'<button class="text-button" data-ops="undo-archive">Undo last archive</button>':''}</div></div><p class="field-hint client-list-note">Clients stay in this directory. Their service dates decide which day’s map and routes they appear on. Archive removes future work from active planning.</p>`;
 }
 function jobsTable(jobs){
  const chosen=selectedClients(),cache=new Map();
  const forJob=job=>{if(!job.serviceDate)return null;if(!cache.has(job.serviceDate))cache.set(job.serviceDate,dayPlan(job.serviceDate));return cache.get(job.serviceDate);};
  const allSelected=jobs.length&&jobs.every(job=>chosen.has(visitClientKey(job)));
  return `<div class="table-scroll"><table class="ops-client-table"><caption class="sr-only">Client visits and service dates. Suggested prices require operator review.</caption><thead><tr><th><input type="checkbox" id="ops-select-visible" aria-label="Select all visible clients" ${allSelected?'checked':''}></th><th>Client & address</th><th>Services</th><th>Service day / visit</th><th>Crew</th><th>Job price</th><th>Status</th><th>Manage</th></tr></thead><tbody>${jobs.map(job=>{
   const archived=isClientArchived(data(),job),meta=clientRecord(data(),job),plan=forJob(job),stop=plan?.routes.flatMap(route=>route.stops).find(stop=>stop.id===job.id),issue=plan?.unassigned.find(issue=>issue.id===job.id),crew=data().crews.find(crew=>crew.id===job.crew),suggestion=plan?suggestJobPrice(workspaceForDay(data(),job.serviceDate),job,plan):{ready:false};
   const price=job.price!==null&&job.price!==undefined?money(job.price):suggestion.ready?`<button class="price-suggestion-link" data-price="${esc(job.id)}"><strong>${money(suggestion.suggested)}</strong><span>Suggested · review ↗</span></button>`:`<button class="text-button" data-price="${esc(job.id)}">Review price ↗</button>`;
   const label=archived?'Archived':job.status==='working'?'On site':job.status==='completed'?'Completed':!job.serviceDate?'Unscheduled':stop?'Scheduled':'Needs review';
   return `<tr><td><input type="checkbox" class="ops-client-select" data-id="${esc(visitClientKey(job))}" aria-label="Select ${esc(job.name)}" ${chosen.has(visitClientKey(job))?'checked':''}></td><td><button class="customer-name" data-job="${esc(job.id)}">${esc(job.name)}</button><span class="client-stage ${meta.stage==='new'?'new':''}">${archived?'Archived':clientStage(job)}</span><span class="subtext">${esc(job.address)}</span></td><td>${api.serviceTags(job)}</td><td><strong>${shortDate(job.serviceDate)}</strong><span class="subtext">${stop?clockLabel(stop.start)+' – '+clockLabel(stop.end):esc(issue?.reason||'Choose a day or build a weekly plan')}</span></td><td>${esc(crew?.name||'Choose crew')}</td><td>${price}</td><td><span class="status ${job.status==='working'?'working':label==='Needs review'?'needs-review':''}">${label}</span></td><td><div class="row-manage"><button class="row-action" data-job="${esc(job.id)}" aria-label="Open ${esc(job.name)} job">↗</button><button class="text-button" data-ops="${archived?'restore-client':'archive-client'}" data-id="${esc(visitClientKey(job))}">${archived?'Restore':'Archive'}</button></div></td></tr>`;
  }).join('')||'<tr><td colspan="8"><div class="empty-state"><strong>No matching clients</strong>Change the client group or search.</div></td></tr>'}</tbody></table></div><div class="table-foot"><span>${jobs.length} client visits shown · ${activeClients(data()).length} active clients</span><span>Dates and reviewed prices are retained</span></div>`;
 }
 function dayControls(){
  const dates=weekDates(state().weekStart||selectedDate()),plan=api.getPlan(),team=validateTeam(data());
  return `<div class="day-scope-bar"><div><label for="ops-day-select">Workday</label><select id="ops-day-select">${[...new Set([...dates,selectedDate()])].sort().map(date=>`<option value="${date}" ${date===selectedDate()?'selected':''}>${shortDate(date)}</option>`).join('')}</select></div><a class="text-button" href="#week">View the week ↗</a><span>${data().settings.dailyJobLimit===null?'Shift-based daily capacity':data().settings.dailyJobLimit+' jobs/day across the business'} · ${crewText(plan.crewsUsed)} / ${plan.peopleUsed} people in this plan</span></div><section class="staffing-strip" aria-label="Daily staffing and labor budget"><div><small>Labor budget for scheduled visits</small><strong>${money(plan.laborBudget)}</strong><span>${data().settings.laborBudgetMode==='shift'?'Full shifts for crews used, including idle/break time':'Scheduled work, driving and waiting only'}</span></div><div><small>Work & travel labor</small><strong>${money(plan.laborCost)}</strong><span>Based on crew size, rates and estimated minutes</span></div><div><small>Team available</small><strong>${team.total} people</strong><span>${crewText(team.crews)} set up · ${team.reserve} unassigned people</span><button class="text-button" data-ops="settings">Edit team & capacity ↗</button></div></section>`;
 }
 function mapJobs(){
  const plan=api.getPlan(),ids=new Set(plan.routes.flatMap(route=>route.stops.map(stop=>stop.id)));
  return state().showAllDayJobs?plan.jobs:plan.jobs.filter(job=>ids.has(job.id));
 }
 function mapToggle(){return `<button class="text-button" data-ops="map-pending" aria-pressed="${!!state().showAllDayJobs}">${state().showAllDayJobs?'Show scheduled stops only':'Show all jobs for this day'}</button>`;}
 function weekPage(){
  const dates=weekDates(state().weekStart||data().date),backlog=data().jobs.filter(job=>!isClientArchived(data(),job)&&job.status==='planned'&&!job.serviceDate).length;
  return `<div class="week-heading-controls"><div><label class="field-label" for="ops-week-start">Week containing</label><input id="ops-week-start" type="date" value="${dates[0]}"></div><div class="action-group"><button class="button secondary" data-ops="settings">Team & daily limits</button><button class="button primary" data-ops="build-week">Spread jobs across the week</button></div></div><div class="notice">${data().settings.dailyJobLimit===null?'Capacity uses service times, road travel, breaks and crew shifts.':data().settings.dailyJobLimit+' jobs total per day, with each crew’s own limit and shift.'} ${backlog} unscheduled visits are in the backlog. Review a proposal before moving jobs; reported work stays in place.</div><div class="week-grid">${dates.map(date=>{
   const plan=dayPlan(date),count=dayCount(plan),inputIssues=plan.unassigned.filter(issue=>/estimate|address|latitude|road|pin/.test(issue.reason)).length;
   return `<article class="panel week-day-card ${date===selectedDate()?'selected':''}"><p class="eyebrow">${shortDate(date)}</p><strong class="week-job-count">${count}<small>${data().settings.dailyJobLimit===null?' jobs fit':' / '+data().settings.dailyJobLimit+' jobs fit'}</small></strong><p>${crewText(plan.crewsUsed)} · ${plan.peopleUsed} people</p><dl><div><dt>Labor budget</dt><dd>${money(plan.laborBudget)}</dd></div><div><dt>Road travel</dt><dd>${plan.travelMinutes} min</dd></div></dl>${plan.unassigned.length?`<p class="week-issue">${plan.unassigned.length} need review${inputIssues?' · '+inputIssues+' missing inputs':''}</p>`:plan.overCapacity?'<p class="week-issue">Recorded work exceeds the current job limit</p>':'<p class="week-clear">Within configured limits</p>'}<button class="button secondary full-width" data-ops="view-day" data-date="${date}">View jobs & road routes</button></article>`;
  }).join('')}</div><div class="week-notes"><p>Daily labor budgets use ${data().settings.laborBudgetMode==='shift'?'full shifts for activated crews':'scheduled work, drive and wait minutes'}. Job prices and modeled job costs are separate.</p><p>Service times are elapsed crew minutes. Adding people changes labor cost; review job times for the new crew size. The planner does not assume perfect productivity scaling.</p>${state().weekPlanBackup?'<button class="text-button" data-ops="undo-week">Undo last weekly plan ↶</button>':''}</div>`;
 }
 function buildWeek(){
  const dialog=document.getElementById('ops-week-dialog'),body=document.getElementById('ops-week-proposal');body.innerHTML='<p class="weather-loading" role="status">Balancing weekday capacity, staffing and road travel…</p>';document.getElementById('ops-week-error').textContent='';document.getElementById('ops-apply-week').disabled=true;dialog.showModal();
  setTimeout(()=>{
   try{
    proposal=recommendWeeklyPlan(data(),state().weekStart||data().date);const grouped=new Map();for(const issue of proposal.issues)grouped.set(issue.reason,(grouped.get(issue.reason)||0)+1);
    body.innerHTML=`<div class="day-plan-summary"><div><strong>${proposal.count} / ${proposal.included}</strong><span>visits fit this week</span></div><div><strong>${crewText(proposal.peakCrews)}</strong><span>suggested peak staffing · ${proposal.peakPeople} people</span></div><div><strong>${money(proposal.laborBudget)}</strong><span>week labor budget · ${data().settings.laborBudgetMode==='shift'?'full crew shifts':'scheduled minutes'}</span></div></div><p class="day-plan-explanation">${proposal.changes.length} proposed date or crew changes. The search balances weekdays within the limits, then compares labor budget and road travel. It does not guarantee a global optimum. Reviewed prices and reported work stay intact.</p>${proposal.staffingScenario?`<aside class="notice amber"><strong>Extra staffing scenario</strong><p>${proposal.staffingScenario.additionalCrews} additional crew(s), with ${proposal.staffingScenario.membersPerExtraCrew} people each, could fit all ${proposal.staffingScenario.knownJobs} visits with known inputs in this model. The proposal below uses your available team. Update team settings and rebuild to use extra staff.</p></aside>`:''}<div class="week-proposal-days">${proposal.days.map(({date,plan})=>`<section class="day-plan-crew"><h3>${shortDate(date)} <span>${dayCount(plan)} jobs · ${crewText(plan.crewsUsed)} · ${money(plan.laborBudget)} labor</span></h3>${plan.routes.filter(route=>route.stops.length).map(route=>`<div class="week-proposal-route"><strong>${esc(data().crews.find(crew=>crew.id===route.crewId)?.name||route.crewId)}</strong><span>${route.travelMinutes} min driving · return ${clockLabel(route.finish)}</span><ol>${route.stops.map(stop=>{const job=proposal.jobs.find(job=>job.id===stop.id);return `<li><span>${esc(job.name)}</span><time>${clockLabel(stop.start)} – ${clockLabel(stop.end)}</time></li>`;}).join('')}</ol></div>`).join('')||'<p class="field-hint">No feasible visits assigned.</p>'}</section>`).join('')}</div>${grouped.size?`<div class="notice amber"><strong>${proposal.issues.length} visits stay in the backlog</strong><ul>${[...grouped].map(([reason,count])=>`<li>${count} · ${esc(reason)}</li>`).join('')}</ul></div>`:''}<p class="field-hint">All customer records are retained. Missing time/address data is not guessed. If the configured team cannot finish the list, the remainder stays visible for another week or a larger crew setup.</p>`;
    document.getElementById('ops-apply-week').disabled=false;
   }catch(error){proposal=null;body.textContent='The week could not be planned.';document.getElementById('ops-week-error').textContent=error.message;}
  },0);
 }
 function applyWeek(){
  if(!proposal)return;if(proposal.fingerprint!==planningFingerprint(data())){document.getElementById('ops-week-dialog').close();buildWeek();document.getElementById('ops-week-error').textContent='Work or settings changed. Review the refreshed proposal.';return;}
  state().weekPlanBackup=data().jobs.map(({id,crew,serviceDate,routeOrder})=>({id,crew,serviceDate,routeOrder}));data().jobs=proposal.jobs;state().optimized=false;state().dayPlanApplied=false;state().viewDate=proposal.dates[0];state().weekStart=proposal.dates[0];proposal=null;document.getElementById('ops-week-dialog').close();api.save();api.go('week');toast('Weekly plan applied. Choose a day to see its jobs and road routes.');
 }
 function undoWeek(){
  const before=new Map((state().weekPlanBackup||[]).map(job=>[job.id,job]));for(const job of data().jobs)if(job.status==='planned'&&before.has(job.id)){const item=before.get(job.id);Object.assign(job,{crew:item.crew,serviceDate:item.serviceDate,routeOrder:item.routeOrder});}
  delete state().weekPlanBackup;state().optimized=false;refresh();toast('Earlier dates and unstarted crew assignments restored.');
 }
 function openArchive(ids){
  archiveIds=[...new Set(ids)].filter(id=>data().jobs.some(job=>visitClientKey(job)===id&&!isClientArchived(data(),job)));if(!archiveIds.length)return;
  const names=archiveIds.map(id=>data().jobs.find(job=>visitClientKey(job)===id)?.name),pending=data().jobs.filter(job=>archiveIds.includes(visitClientKey(job))&&!isReportedVisit(job)).length;
  document.querySelectorAll('#job-dialog[open]').forEach(dialog=>dialog.close());document.getElementById('ops-archive-body').innerHTML=`<p class="dialog-copy">Archive ${names.length} client${names.length===1?'':'s'} and remove ${pending} unstarted visit${pending===1?'':'s'} from active schedules and maps.</p><ul class="archive-name-list">${names.slice(0,8).map(name=>`<li>${esc(name)}</li>`).join('')}${names.length>8?`<li>…and ${names.length-8} more</li>`:''}</ul>`;document.getElementById('ops-archive-error').textContent='';document.getElementById('ops-archive-dialog').showModal();
 }
 function confirmArchive(){
  try{
   for(const id of archiveIds)if(data().jobs.some(job=>visitClientKey(job)===id&&job.status==='working'))throw Error('A selected client has a job on site. Finish that job before archiving.');
   for(const id of archiveIds)archiveClient(data(),id);state().lastArchived=[...archiveIds];state().selectedClientIds=[];invalidate();document.getElementById('ops-archive-dialog').close();refresh();toast(archiveIds.length+' clients archived. Restore is available in the Archived filter.');
  }catch(error){document.getElementById('ops-archive-error').textContent=error.message;}
 }
 function readCrewDraft(){
  return crewDraft.map(crew=>({...crew,members:Number(document.getElementById('members-'+crew.id)?.value??crew.members),workerRate:Number(document.getElementById('rate-'+crew.id)?.value??crew.workerRate).toFixed(2),equipmentRate:Number(document.getElementById('equipment-'+crew.id)?.value??crew.equipmentRate).toFixed(2),overhead:Number(document.getElementById('overhead-'+crew.id)?.value??crew.overhead).toFixed(2),maxJobsPerDay:optionalNumber('cap-'+crew.id,crew.maxJobsPerDay),shiftStart:parseClock(document.getElementById('shift-start-'+crew.id)?.value||clockInput(crew.shiftStart)),shiftEnd:parseClock(document.getElementById('shift-end-'+crew.id)?.value||clockInput(crew.shiftEnd)),breakStart:parseClock(document.getElementById('break-start-'+crew.id)?.value||clockInput(crew.breakStart??720)),breakMinutes:Number(document.getElementById('break-minutes-'+crew.id)?.value??crew.breakMinutes??30)}));
 }
 function updateTeamUsage(){const node=document.getElementById('ops-team-usage');if(!node)return;const total=Number(document.getElementById('ops-team-total').value),assigned=crewDraft.reduce((sum,crew)=>sum+Number(document.getElementById('members-'+crew.id)?.value||0),0);node.textContent=assigned+' of '+total+' available people assigned to '+crewText(crewDraft.length)+(assigned>total?' — increase availability or reduce crew sizes.':' · '+(total-assigned)+' in reserve.');}
 function renderCrewDraft(){
  document.getElementById('crew-settings').innerHTML=crewDraft.map(crew=>`<div class="form-section"><h3>${esc(crew.name)}</h3><p>Labor rates are business costs, separate from customer prices.</p></div><div class="form-grid"><div><label class="field-label" for="members-${crew.id}">Crew members</label><input id="members-${crew.id}" type="number" min="1" max="10" value="${crew.members}" required></div><div><label class="field-label" for="cap-${crew.id}">Optional jobs per day for this crew</label><input id="cap-${crew.id}" type="number" min="1" max="50" value="${crew.maxJobsPerDay??''}" placeholder="Use shift capacity"></div><div><label class="field-label" for="rate-${crew.id}">Loaded cost per worker / hour ($)</label><input id="rate-${crew.id}" type="number" min="0" max="500" step="0.01" value="${crew.workerRate}" required></div><div><label class="field-label" for="equipment-${crew.id}">Equipment / service hour ($)</label><input id="equipment-${crew.id}" type="number" min="0" max="500" step="0.01" value="${crew.equipmentRate}" required></div><div><label class="field-label" for="overhead-${crew.id}">Overhead / job ($)</label><input id="overhead-${crew.id}" type="number" min="0" max="1000" step="0.01" value="${crew.overhead}" required></div><div><label class="field-label" for="shift-start-${crew.id}">Shift start</label><input id="shift-start-${crew.id}" type="time" value="${clockInput(crew.shiftStart)}" required></div><div><label class="field-label" for="shift-end-${crew.id}">Shift finish</label><input id="shift-end-${crew.id}" type="time" value="${clockInput(crew.shiftEnd)}" required></div><div><label class="field-label" for="break-start-${crew.id}">Break starts</label><input id="break-start-${crew.id}" type="time" value="${clockInput(crew.breakStart??720)}" required></div><div><label class="field-label" for="break-minutes-${crew.id}">Break minutes</label><input id="break-minutes-${crew.id}" type="number" min="0" max="120" value="${crew.breakMinutes??30}" required></div></div>`).join('')+(state().restoreBackup?'<button type="button" class="text-button" data-action="undo-restore">Undo last demo restore ↶</button>':'');
 }
 function openSettings(){
  const value=data();crewDraft=structuredClone(value.crews);
  const fields={'setting-base-latitude':value.depot.latitude??'','setting-base-longitude':value.depot.longitude??'','setting-clock':clockInput(value.now),'setting-margin':value.settings.marginBps/100,'setting-minimum':value.settings.minimumPrice,'setting-mow':value.settings.defaultMowMinutes,'setting-edge':value.settings.defaultEdgeMinutes,'setting-setup':value.settings.setupMinutes,'ops-team-total':value.settings.totalMembers,'ops-crew-size':value.settings.defaultCrewMembers,'ops-crew-count':value.crews.length,'ops-daily-limit':value.settings.dailyJobLimit,'ops-default-crew-cap':value.settings.defaultCrewJobLimit,'ops-labor-mode':value.settings.laborBudgetMode,'ops-clock-date':value.clockDate||value.date};
  for(const [id,entry]of Object.entries(fields))document.getElementById(id).value=entry??'';
  document.getElementById('setting-base-source').textContent=value.depot.locationSource||'No crew base location';document.getElementById('settings-error').textContent='';renderCrewDraft();updateTeamUsage();document.getElementById('settings-dialog').showModal();
 }
 function setupCrews(){
  try{
   const count=Number(document.getElementById('ops-crew-count').value),size=Number(document.getElementById('ops-crew-size').value),cap=optionalNumber('ops-default-crew-cap');
   if(!Number.isInteger(count)||count<1||count>12||!Number.isInteger(size)||size<1||size>10)throw Error('Choose 1–12 crews and 1–10 people per crew.');
   crewDraft=readCrewDraft();const names=['Willow crew','Clover crew','Meadow crew','Oak crew','Maple crew','Cedar crew','Pine crew','Elm crew','Birch crew','Ash crew','Fern crew','Ivy crew'],base=crewDraft[0];
   const next=Array.from({length:count},(_,index)=>({...structuredClone(crewDraft[index]||base),id:String.fromCharCode(65+index),name:crewDraft[index]?.name||names[index],members:size,maxJobsPerDay:cap}));
   const removed=crewDraft.filter(crew=>!next.some(item=>item.id===crew.id));if(removed.some(crew=>data().jobs.some(job=>job.crew===crew.id&&job.status==='working')))throw Error('A crew is on site. Keep it until its active job is finished.');
   crewDraft=next;renderCrewDraft();updateTeamUsage();document.getElementById('settings-error').textContent='Crew setup updated in this form. Save settings to apply it.';
  }catch(error){document.getElementById('settings-error').textContent=error.message;}
 }
 function saveSettings(event){
  event.preventDefault();try{
   const next=structuredClone(data()),base=parseCoordinates(document.getElementById('setting-base-latitude').value,document.getElementById('setting-base-longitude').value),clockDate=document.getElementById('ops-clock-date').value;
   if(!validServiceDate(clockDate))throw Error('Choose a valid demo workday.');if(next.jobs.some(job=>job.status==='working'&&job.serviceDate!==clockDate))throw Error('Finish the active job before changing the demo workday.');
   Object.assign(next.depot,base,{locationSource:hasCoordinates(base)?'Owner-entered crew base':'Crew-base coordinates needed'});next.now=parseClock(document.getElementById('setting-clock').value);next.clockDate=clockDate;
   Object.assign(next.settings,{totalMembers:Number(document.getElementById('ops-team-total').value),defaultCrewMembers:Number(document.getElementById('ops-crew-size').value),dailyJobLimit:optionalNumber('ops-daily-limit'),defaultCrewJobLimit:optionalNumber('ops-default-crew-cap'),laborBudgetMode:document.getElementById('ops-labor-mode').value,marginBps:Math.round(Number(document.getElementById('setting-margin').value)*100),minimumPrice:Number(document.getElementById('setting-minimum').value).toFixed(2),defaultMowMinutes:Number(document.getElementById('setting-mow').value),defaultEdgeMinutes:Number(document.getElementById('setting-edge').value),setupMinutes:Number(document.getElementById('setting-setup').value)});
   next.crews=readCrewDraft();for(const crew of next.crews){validateCrew(crew);if(crew.breakMinutes>0&&(crew.breakStart<crew.shiftStart||crew.breakStart+crew.breakMinutes>crew.shiftEnd))throw Error('Keep each break within its crew’s shift.');}
   validateTeam(next);
   for(const job of next.jobs)if(!next.crews.some(crew=>crew.id===job.crew)){if(isReportedVisit(job))throw Error('Keep crews with reported visits.');job.crew=next.crews[0].id;job.serviceDate=null;}
   planLawnDay(next,false);api.setData(next);state().optimized=false;invalidate();document.getElementById('settings-dialog').close();refresh();toast('Team, daily limits and cost assumptions saved. Review a refreshed weekly plan.');
  }catch(error){document.getElementById('settings-error').textContent=error.message;}
 }
 function prepareManual(){document.getElementById('manual-service-date').value=selectedDate();document.getElementById('manual-client-stage').value='new';}
 function decorateManual(job){const date=document.getElementById('manual-service-date').value||null;registerClients(data(),[job],{stage:document.getElementById('manual-client-stage').value,serviceDate:date});}
 function registerImport(jobs){registerClients(data(),jobs,{stage:document.getElementById('import-client-stage').value,serviceDate:document.getElementById('import-service-date').value||null});}
 function decorateJobDialog(job){
  const form=document.getElementById('job-edit-form');if(!form)return;
  form.insertAdjacentHTML('afterbegin',`<div class="form-grid"><div><label class="field-label" for="ops-job-stage">Client group</label><select id="ops-job-stage"><option value="new" ${clientRecord(data(),job).stage==='new'?'selected':''}>New client</option><option value="existing" ${clientRecord(data(),job).stage!=='new'?'selected':''}>Existing client</option></select></div><div><label class="field-label" for="ops-job-date">Service date</label><input id="ops-job-date" type="date" value="${job.serviceDate||''}" ${isReportedVisit(job)?'disabled':''}></div></div><label class="check-label date-lock-label"><input id="ops-job-lock" type="checkbox" ${job.dateLocked?'checked':''} ${isReportedVisit(job)?'disabled':''}>Keep this date when building the week</label><p class="field-hint">Leave the service date blank to keep this visit in the unscheduled backlog.</p>`);
  form.insertAdjacentHTML('beforeend',`<button type="button" class="text-button archive-job-button" data-ops="${isClientArchived(data(),job)?'restore-client':'archive-client'}" data-id="${esc(visitClientKey(job))}">${isClientArchived(data(),job)?'Restore client':'Archive client and remove future work'}</button>`);
 }
 function saveJobMeta(job){
  const date=isReportedVisit(job)?job.serviceDate:document.getElementById('ops-job-date').value||null;if(date!==null&&!validServiceDate(date))throw Error('Choose a valid service date.');
  const locked=document.getElementById('ops-job-lock').checked;if(locked&&!date)throw Error('Choose a service date before locking it.');
  data().clients[visitClientKey(job)]={...clientRecord(data(),job),stage:document.getElementById('ops-job-stage').value};Object.assign(job,{serviceDate:date,dateLocked:locked});invalidate();
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-ops]');if(!button)return;const action=button.dataset.ops;
  if(action==='client-filter'){state().clientFilter=button.dataset.value;state().selectedClientIds=[];refresh();}
  if(action==='archive-client')openArchive([button.dataset.id]);
  if(action==='archive-selected')openArchive([...selectedClients()]);
  if(action==='restore-selected'){for(const id of selectedClients())if(data().clients[id]?.archivedAt)restoreClient(data(),id);state().selectedClientIds=[];invalidate();refresh();toast('Selected clients restored.');}
  if(action==='confirm-archive')confirmArchive();
  if(action==='restore-client'){restoreClient(data(),button.dataset.id);document.getElementById('job-dialog').close();invalidate();refresh();toast('Client restored to active planning. Review its service dates.');}
  if(action==='undo-archive'){for(const id of state().lastArchived||[])if(data().clients[id]?.archivedAt)restoreClient(data(),id);delete state().lastArchived;invalidate();refresh();toast('Last archived clients restored.');}
  if(action==='map-pending'){state().showAllDayJobs=!state().showAllDayJobs;refresh();}
  if(action==='settings')openSettings();
  if(action==='setup-crews')setupCrews();
  if(action==='build-week')buildWeek();
  if(action==='apply-week')applyWeek();
  if(action==='undo-week')undoWeek();
  if(action==='view-day'){state().viewDate=button.dataset.date;state().mapCrew='all';api.save();api.go('today');}
 });
 document.getElementById('settings-form').addEventListener('input',updateTeamUsage);
 document.addEventListener('change',event=>{
  if(event.target.matches('.ops-client-select')){const chosen=selectedClients();event.target.checked?chosen.add(event.target.dataset.id):chosen.delete(event.target.dataset.id);state().selectedClientIds=[...chosen];refresh();}
  if(event.target.id==='ops-select-visible'){const ids=[...document.querySelectorAll('.ops-client-select')].map(input=>input.dataset.id),chosen=selectedClients();for(const id of ids)event.target.checked?chosen.add(id):chosen.delete(id);state().selectedClientIds=[...chosen];refresh();}
  if(event.target.id==='ops-day-select'){state().viewDate=event.target.value;refresh();}
  if(event.target.id==='ops-week-start'){try{state().weekStart=weekDates(event.target.value)[0];refresh();}catch(error){toast(error.message);}}
 });
 return {filterClient,clientToolbar,jobsTable,dayControls,mapJobs,mapToggle,weekPage,openSettings,saveSettings,prepareManual,decorateManual,registerImport,decorateJobDialog,saveJobMeta,selectedDate};
}
