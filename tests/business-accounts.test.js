import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createAccountApi,businessAccountConfig} from '../lib/account-api.js';
import {emptyBusinessWorkspace} from '../lib/business-seed.js';
import {createBusinessTransport} from '../src/lawn/business-client.js';
import {validateBusinessWorkspace} from '../lib/business-workspaces.js';

const origin='https://groundskeeper.example';
const config={ready:true,publishableKey:'pk_test_public',secretKey:'server-only',databaseUrl:'private-database',origins:[origin],developmentInstance:true};
const seed=JSON.parse(await fs.readFile(new URL('../data/lawn-demo.json',import.meta.url),'utf8'));
const payload=name=>({data:emptyBusinessWorkspace(seed,name,'2026-11-09'),state:{viewDate:'2026-11-09'}});
const req=(path='/api/workspace',{owner='A',method='GET',body,headers={}}={})=>new Request(origin+path,{method,headers:{Origin:origin,...(owner?{Authorization:'Bearer owner-'+owner}:{}),...(body?{'Content-Type':'application/json','If-Match':'"0"'}:{}),...headers},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
function fixture(){
 const records=new Map(),calls=[];
 const store={async get(id){calls.push(['get',id]);return records.get(id)||null;},async save(id,body,version){calls.push(['save',id]);const current=records.get(id);if((current?.version||0)!==version)return null;const next={...structuredClone(body),version:version+1,updatedAt:'2026-11-09T09:00:00Z'};records.set(id,next);return {version:next.version,updatedAt:next.updatedAt};}};
 const api=createAccountApi({config,store,verifyAccount:async request=>{const match=/^Bearer owner-([AB])$/.exec(request.headers.get('authorization'));return match?{id:'account-'+match[1]}:null;},geocodeAddress:async address=>({matches:[],address}),reportFailure:()=>{}});
 return {api,records,calls};
}
test('private workspace and geocoding endpoints fail closed before storage is accessed',async()=>{
 const {api,calls}=fixture();
 for(const path of ['/api/workspace','/api/account'])assert.equal((await api(req(path,{owner:null}))).status,401);
 assert.equal((await api(req('/api/lawn/geocode',{owner:null,method:'POST',body:{address:'950 Eden Park Dr'}}))).status,401);
 assert.equal((await api(req('/api/workspace',{headers:{Authorization:'Bearer forged'}}))).status,401);
 assert.deepEqual(calls,[]);
 const unavailable=createAccountApi({config:{...config,ready:false},store:{get(){assert.fail('Must not access storage');}}});
 assert.equal((await unavailable(req())).status,503);
});
test('workspace ownership comes from the verified account rather than caller-controlled IDs',async()=>{
 const {api}=fixture();assert.equal((await api(req('/api/workspace',{method:'PUT',body:payload('A Landscaping')}))).status,200);
 const ownerA=await (await api(req())).json(),ownerB=await (await api(req('/api/workspace',{owner:'B'}))).json();
 assert.equal(ownerA.workspace.data.company,'A Landscaping');assert.equal(ownerB.workspace,null);
 const attack={...payload('Stolen'),accountId:'account-A'};assert.equal((await api(req('/api/workspace',{owner:'B',method:'PUT',body:attack}))).status,400);
 assert.equal((await api(req('/api/workspace',{owner:'B',method:'PUT',body:payload('B Landscaping')}))).status,200);
 assert.equal((await (await api(req())).json()).workspace.data.company,'A Landscaping');
});
test('stale devices cannot overwrite newer records and every private response prevents caching',async()=>{
 const {api}=fixture();const first=await api(req('/api/workspace',{method:'PUT',body:payload('First')}));assert.equal(first.headers.get('ETag'),'"1"');
 const next=await api(req('/api/workspace',{method:'PUT',body:payload('Newer'),headers:{'If-Match':'"1"'}}));assert.equal(next.status,200);
 const stale=await api(req('/api/workspace',{method:'PUT',body:payload('Old tab'),headers:{'If-Match':'"1"'}}));assert.equal(stale.status,409);assert.equal((await stale.json()).code,'WORKSPACE_CONFLICT');
 assert.equal((await (await api(req())).json()).workspace.data.company,'Newer');
 const noVersion=await api(req('/api/workspace',{method:'PUT',body:payload('No version'),headers:{'If-Match':''}}));assert.equal(noVersion.status,428);
 for(const response of [first,next,stale,await api(req())])assert.match(response.headers.get('Cache-Control'),/private, no-store/);
});
test('cross-site writes, cookie-only requests, invalid JSON and oversized bodies are rejected',async()=>{
 const {api,calls}=fixture();
 assert.equal((await api(req('/api/workspace',{method:'PUT',body:payload('Other'),headers:{Origin:'https://other.example'}}))).status,403);
 assert.equal((await api(req('/api/workspace',{method:'PUT',body:payload('Other'),headers:{'Sec-Fetch-Site':'cross-site'}}))).status,403);
 assert.equal((await api(req('/api/workspace',{owner:null,headers:{Cookie:'__session=forged'}}))).status,401);
 assert.equal((await api(req('/api/workspace',{method:'PUT',body:'{broken'}))).status,400);
 assert.equal((await api(req('/api/workspace',{method:'PUT',body:payload('Other'),headers:{'Content-Type':'text/plain'}}))).status,415);
 assert.equal((await api(req('/api/workspace',{method:'PUT',body:payload('Other'),headers:{'Content-Length':'4000000'}}))).status,413);
 assert.equal((await api(req('/api/workspace',{method:'POST',body:payload('Other')}))).status,405);
 assert.deepEqual(calls,[]);
});
test('workspace validation rejects executable property names and invalid schedules without changing prior data',()=>{
 assert.equal(validateBusinessWorkspace(payload('Real business')).data.jobs.length,0);
 const unsafe=payload('Real business');unsafe.state=JSON.parse('{"__proto__":{"polluted":true}}');assert.throws(()=>validateBusinessWorkspace(unsafe),/unsupported field/);
 const invalid=payload('Real business');invalid.data.crews[0].name='<img src=x onerror=bad>';assert.throws(()=>validateBusinessWorkspace(invalid),/crews/);
 const limits=payload('Real business');limits.data.settings.totalMembers=1;assert.throws(()=>validateBusinessWorkspace(limits),/workspace values/);
 const date=payload('Real business');date.data.date='2026-02-30';assert.throws(()=>validateBusinessWorkspace(date),/date/);
});
test('public account configuration exposes only the publishable key and generic readiness',async()=>{
 const {api}=fixture();const response=await api(req('/api/account/config',{owner:null})),text=await response.text();assert.ok(text.includes(config.publishableKey));assert.equal(text.includes(config.secretKey),false);assert.equal(text.includes(config.databaseUrl),false);
 const defaults=businessAccountConfig({});assert.equal(defaults.ready,false);assert.deepEqual(defaults.origins.includes('https://groundskeeper-nine.vercel.app'),true);
 const production=businessAccountConfig({VERCEL:'1',VERCEL_URL:'preview.example',CLERK_SECRET_KEY:'x',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'pk_test_x',DATABASE_URL:'x'});assert.equal(production.origins.some(origin=>origin.includes('localhost')),false);
});
test('unexpected storage failures do not expose credentials or query details',async()=>{
 const api=createAccountApi({config,verifyAccount:async()=>({id:'A'}),store:{get(){throw Error('postgres://PRIVATE_PASSWORD');}},reportFailure:()=>{}});
 const response=await api(req());assert.equal(response.status,500);assert.equal((await response.text()).includes('PRIVATE_PASSWORD'),false);
});
test('new business workspaces start empty and retain operational assumptions without importing browser records',()=>{
 const fresh=emptyBusinessWorkspace(seed,'A new business','2026-11-09');assert.equal(fresh.company,'A new business');assert.equal(fresh.jobs.length,0);assert.equal(fresh.landscape.projects.length,0);assert.equal(fresh.synthetic,false);assert.equal(fresh.geographic,false);assert.equal(fresh.depot.latitude,null);assert.equal(fresh.date,'2026-11-09');assert.equal(seed.jobs.length,50);
});
test('saving during an in-flight request serializes the newest snapshot with the new version',async()=>{
 const sent=[],statuses=[];let release;
 const paused=new Promise(resolve=>release=resolve);
 const transport=createBusinessTransport({delay:60000,getToken:async()=> 'owner-A',onStatus:value=>statuses.push(value.status),fetchImpl:async(path,options)=>{if(options.method==='PUT'){sent.push({body:JSON.parse(options.body),version:options.headers['If-Match'],authorization:options.headers.Authorization});if(sent.length===1)await paused;return Response.json({version:sent.length,updatedAt:'2026-11-09T09:00:00Z'});}return Response.json({workspace:null});}});
 await transport.load();const first=payload('First');transport.save(first);const saving=transport.flush();await new Promise(resolve=>setTimeout(resolve,0));first.data.company='Mutated after save';transport.save(payload('Latest'));release();await saving;
 assert.equal(sent.length,2);assert.equal(sent[0].body.data.company,'First');assert.equal(sent[1].body.data.company,'Latest');assert.deepEqual(sent.map(item=>item.version),['"0"','"1"']);assert.ok(sent.every(item=>item.authorization==='Bearer owner-A'));assert.equal(transport.dirty,false);assert.equal(statuses.at(-1),'saved');transport.stop();
});
test('conflicts retain unsaved work and stopped sessions cannot send data with a different account',async()=>{
 let calls=0;const statuses=[];const transport=createBusinessTransport({delay:60000,getToken:async()=> 'owner-A',onStatus:value=>statuses.push(value.status),fetchImpl:async()=>{calls++;return Response.json({error:'Newer changes exist.'},{status:409});}});
 transport.save(payload('Unsaved'));await assert.rejects(transport.flush(),/Newer/);assert.equal(transport.dirty,true);assert.equal(statuses.at(-1),'conflict');await assert.rejects(transport.flush(),/Another device/);assert.equal(calls,1);transport.stop();await assert.rejects(transport.request('/api/workspace'),/session has ended/);assert.equal(calls,1);
});
