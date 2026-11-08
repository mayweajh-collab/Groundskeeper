import {planLawnDay} from './lawn.js';
import {normalizeOperations,validServiceDate,validateTeam} from './lawn-workspace.js';
import {landscapeCosts,landscapeDate} from './landscape-projects.js';
import {validateServiceTimeDefaults} from './lawn-service-times.js';

const bad=message=>Object.assign(Error(message),{statusCode:400});
export function validateBusinessWorkspace(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['data','state'].includes(key)))throw bad('Send workspace data and view settings only.');
 const {data,state={}}=input;
 if(!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.jobs)||data.jobs.length>150||!Array.isArray(data.crews)||data.crews.length<1||data.crews.length>12||!data.settings)throw bad('Use a valid workspace with up to 150 visits and 12 crews.');
 if(typeof data.company!=='string'||!data.company.trim()||data.company.length>120||/[<>]/.test(data.company))throw bad('Enter a business name up to 120 characters.');
 if(!validServiceDate(data.date)||!validServiceDate(data.clockDate||data.date))throw bad('Choose a valid workspace date.');
 if(!state||typeof state!=='object'||Array.isArray(state))throw bad('View settings must be an object.');
 for(const key of ['viewDate','weekStart','scheduleMobileDate'])if(state[key]!==undefined&&!validServiceDate(state[key]))throw bad('Choose valid dates in view settings.');
 for(const key of ['search','filter','clientFilter','projectSearch','scheduleSearch','projectStatus','scheduleStatus'])if(state[key]!==undefined&&typeof state[key]!=='string')throw bad('Use text for search and filter settings.');
 let nodes=0;
 function inspect(value,depth=0){
  if(++nodes>200000||depth>24)throw bad('The workspace is too complex.');
  if(typeof value==='string'&&value.length>100000)throw bad('A workspace field is too long.');
  if(typeof value==='number'&&!Number.isFinite(value))throw bad('Use finite numbers in the workspace.');
  if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw bad('The workspace contains an unsupported field.');inspect(child,depth+1);}
 }
 inspect(input);
 try{
  const crewIds=new Set();for(const crew of data.crews){if(typeof crew.id!=='string'||crewIds.has(crew.id)||typeof crew.name!=='string'||!crew.name.trim()||crew.name.length>80||/[<>]/.test(crew.name))throw bad('Use unique crews with valid names.');crewIds.add(crew.id);if(crew.unavailableDates?.some(date=>!validServiceDate(date)))throw bad('Choose valid crew availability dates.');}
  for(const job of data.jobs){if(typeof job.id!=='string'||job.id.length>120||typeof job.name!=='string'||job.name.length>120||typeof job.address!=='string'||job.address.length>300||!['planned','working','completed','skipped'].includes(job.status))throw bad('A visit has incomplete customer or status information.');if(job.serviceDate!==null&&job.serviceDate!==undefined&&!validServiceDate(job.serviceDate))throw bad('Choose valid service dates.');}
  validateServiceTimeDefaults(data.settings);normalizeOperations(data);validateTeam(data);planLawnDay(data,false);
  if(data.landscape){if(!Array.isArray(data.landscape.projects)||data.landscape.projects.length>100||!Array.isArray(data.landscape.invoices)||data.landscape.invoices.length>1000)throw bad('The project ledger is too large or incomplete.');for(const project of data.landscape.projects)landscapeCosts(project);for(const invoice of data.landscape.invoices)landscapeDate(invoice.dueDate);}
 }catch(error){if(error.statusCode)throw error;throw bad('Check the workspace values: '+error.message);}
 return {data,state};
}

export function createPostgresWorkspaceStore(sql){
 return {
  async get(accountId){
   const rows=await sql.query('SELECT payload, version, updated_at FROM groundskeeper_workspaces WHERE account_id = $1',[accountId]);
   return rows[0]?{...rows[0].payload,version:rows[0].version,updatedAt:new Date(rows[0].updated_at).toISOString()}:null;
  },
  async save(accountId,payload,expectedVersion){
   const rows=expectedVersion===0
    ?await sql.query('INSERT INTO groundskeeper_workspaces (account_id, payload, version) VALUES ($1, $2::jsonb, 1) ON CONFLICT (account_id) DO NOTHING RETURNING version, updated_at',[accountId,JSON.stringify(payload)])
    :await sql.query('UPDATE groundskeeper_workspaces SET payload = $2::jsonb, version = version + 1, updated_at = now() WHERE account_id = $1 AND version = $3 RETURNING version, updated_at',[accountId,JSON.stringify(payload),expectedVersion]);
   return rows[0]?{version:rows[0].version,updatedAt:new Date(rows[0].updated_at).toISOString()}:null;
  }
 };
}
