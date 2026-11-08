export const visitClientKey=job=>String(job.clientId||job.id);
export function clientRecord(data,job){return data.clients?.[visitClientKey(job)]||{stage:'existing',archivedAt:null};}
export function isClientArchived(data,job){return !!clientRecord(data,job).archivedAt;}
export function isReportedVisit(job){return ['working','completed'].includes(job.status);}
export function validServiceDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export function weekDates(value){
 if(!validServiceDate(value))throw Error('Choose a valid week date.');
 const date=new Date(value+'T12:00:00Z'),weekday=date.getUTCDay();date.setUTCDate(date.getUTCDate()-(weekday+6)%7);
 return Array.from({length:5},(_,index)=>{const day=new Date(date);day.setUTCDate(day.getUTCDate()+index);return day.toISOString().slice(0,10);});
}
export function normalizeOperations(data){
 data.clients??={};
 for(const job of data.jobs){const id=visitClientKey(job);data.clients[id]??={stage:'existing',archivedAt:null,createdAt:null};if(!Object.hasOwn(job,'serviceDate'))job.serviceDate=data.date;}
 const sum=data.crews.reduce((total,crew)=>total+crew.members,0);
 data.settings.totalMembers??=sum;data.settings.defaultCrewMembers??=data.crews[0]?.members||2;
 data.settings.defaultMulchMinutes??=null;data.settings.defaultHedgeMinutes??=null;
 if(!Object.hasOwn(data.settings,'dailyJobLimit'))data.settings.dailyJobLimit=null;if(!Object.hasOwn(data.settings,'defaultCrewJobLimit'))data.settings.defaultCrewJobLimit=null;data.settings.laborBudgetMode??='shift';
 for(const crew of data.crews)crew.maxJobsPerDay??=data.settings.defaultCrewJobLimit;
 data.schedulingEnabled=true;data.clockDate??=data.date;return data;
}
export function registerClients(data,jobs,{stage='new',serviceDate=null,createdAt=new Date().toISOString()}={}){
 if(!['new','existing'].includes(stage))throw Error('Choose new or existing client.');
 if(serviceDate!==null&&!validServiceDate(serviceDate))throw Error('Choose a valid service date.');
 data.clients??={};for(const job of jobs){data.clients[visitClientKey(job)]??={stage,archivedAt:null,createdAt};job.serviceDate=serviceDate;}
}
export function archiveClient(data,id,archivedAt=new Date().toISOString()){
 const jobs=data.jobs.filter(job=>visitClientKey(job)===String(id));if(!jobs.length)throw Error('Client not found.');
 if(jobs.some(job=>job.status==='working'))throw Error('Finish the client’s active job before archiving.');
 data.clients??={};data.clients[id]={...clientRecord(data,jobs[0]),archivedAt};
}
export function restoreClient(data,id){
 if(!data.clients?.[id]?.archivedAt)throw Error('Choose an archived client.');
 data.clients[id].archivedAt=null;
}
export function visitsForDate(data,date=data.date){return data.jobs.filter(job=>job.status!=='skipped'&&(!isClientArchived(data,job)||isReportedVisit(job))&&(!data.schedulingEnabled||job.serviceDate===date));}
export function activeClients(data){const clients=new Map();for(const job of data.jobs)if(!isClientArchived(data,job)&&!clients.has(visitClientKey(job)))clients.set(visitClientKey(job),job);return [...clients.values()];}
export function validateTeam(data){
 const total=Number(data.settings.totalMembers??data.crews.reduce((sum,crew)=>sum+crew.members,0));
 if(!Number.isInteger(total)||total<1||total>60)throw Error('Enter 1–60 available team members.');
 if(!data.crews.length||data.crews.length>12)throw Error('Set up 1–12 crews.');
 if(new Set(data.crews.map(crew=>crew.id)).size!==data.crews.length)throw Error('Each crew needs a unique ID.');
 const assigned=data.crews.reduce((sum,crew)=>sum+crew.members,0);if(assigned>total)throw Error('Crew assignments use '+assigned+' people, but only '+total+' are available.');
 for(const crew of data.crews)if(crew.maxJobsPerDay!==null&&(!Number.isInteger(crew.maxJobsPerDay)||crew.maxJobsPerDay<1||crew.maxJobsPerDay>50))throw Error('Each optional crew limit must be 1–50 jobs, or blank for shift-based capacity.');
 if(data.settings.dailyJobLimit!==null&&(!Number.isInteger(data.settings.dailyJobLimit)||data.settings.dailyJobLimit<1||data.settings.dailyJobLimit>150))throw Error('The optional business daily limit must be 1–150 jobs, or blank for shift-based capacity.');
 if(!['shift','scheduled'].includes(data.settings.laborBudgetMode))throw Error('Choose the labor budgeting method.');
 return {total,assigned,reserve:total-assigned,crews:data.crews.length};
}
