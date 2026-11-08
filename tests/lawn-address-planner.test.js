import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {normalizeServiceAddress,serviceAddressKey,addressLocationMatches,parseAddressLookup} from '../lib/lawn-address.js';
import {censusGeocodeUrl,parseCensusAddress,createAddressGeocoder} from '../lib/lawn-geocoder.js';
import {roadPoints,parseRoadMatrix} from '../lib/lawn-roads.js';
import {planLawnDay} from '../lib/lawn.js';
import {suggestJobPrice,recommendLawnDay,planningFingerprint} from '../lib/lawn-planner.js';
import {createServer} from '../server.js';
const address='950 Eden Park Dr, Cincinnati, OH 45202';
const census=(matches=[{matchedAddress:'950 EDEN PARK DR, CINCINNATI, OH, 45202',coordinates:{x:-84.49,y:39.11},addressComponents:{city:'CINCINNATI',state:'OH',zip:'45202'}}])=>({result:{addressMatches:matches}});
const timestamp='2026-11-07T23:00:00.000Z';

test('address requests are bounded, encoded and sent only to the fixed Census endpoint',()=>{
 const url=censusGeocodeUrl(address+' & example=1');assert.equal(url.origin,'https://geocoding.geo.census.gov');assert.equal(url.searchParams.get('address'),address+' & example=1');assert.equal(url.searchParams.has('example'),false);assert.deepEqual([...url.searchParams.keys()],['address','benchmark','format']);
 for(const value of [null,'45202','P.O. Box 12','x'.repeat(241),'950 Main\nStreet'])assert.throws(()=>normalizeServiceAddress(value));
 assert.equal(serviceAddressKey(' 950  EDEN Park '),'950 eden park');
});
test('geocoding preserves longitude/latitude order and explicit no-match and ambiguous results',()=>{
 const parsed=parseCensusAddress(census(),timestamp);assert.equal(parsed.matches[0].latitude,39.11);assert.equal(parsed.matches[0].longitude,-84.49);assert.equal(parsed.precision,'Street address range estimate');
 assert.deepEqual(parseCensusAddress(census([]),timestamp).matches,[]);
 const original=census().result.addressMatches[0],other={...original,matchedAddress:'950 EDEN PARK DR, ANOTHER CITY, OH, 45202'};
 assert.equal(parseCensusAddress(census([original,original,other]),timestamp).matches.length,2);
 assert.throws(()=>parseCensusAddress({}),/incomplete/);assert.throws(()=>parseCensusAddress(census([{...original,coordinates:{x:null,y:39}}])),/invalid/);
});
test('an address change invalidates the previous location instead of reusing its coordinates',()=>{
 const selected=parseAddressLookup(parseCensusAddress(census(),timestamp),address)[0];
 assert.equal(addressLocationMatches(selected,address.toUpperCase()),true);assert.equal(addressLocationMatches(selected,'951 Eden Park Dr, Cincinnati, OH 45202'),false);assert.equal(addressLocationMatches({...selected,latitude:null},address),false);
 assert.throws(()=>parseAddressLookup({matches:[],provider:'Unknown',fetchedAt:timestamp},address),/incomplete/);
});
test('address lookups coalesce, cache, expire and never forward contact fields or credentials',async()=>{
 let time=Date.parse(timestamp),requests=0;
 const lookup=createAddressGeocoder({now:()=>time,intervalMs:0,fetchImpl:async(url,options)=>{requests++;assert.equal(new URL(url).searchParams.size,3);assert.deepEqual(options.headers,{Accept:'application/json'});assert.equal(options.redirect,'error');return {ok:true,json:async()=>census()};}});
 const [a,b]=await Promise.all([lookup(address),lookup(address.toUpperCase())]);assert.deepEqual(a,b);assert.equal(requests,1);await lookup(address);assert.equal(requests,1);time+=24*60*60*1000+1;await lookup(address);assert.equal(requests,2);
 await assert.rejects(lookup('ZIP only'),error=>error.statusCode===400);assert.equal(requests,2);
});
test('address service errors are retryable and cannot become guessed locations',async()=>{
 let calls=0;const lookup=createAddressGeocoder({intervalMs:0,fetchImpl:async()=>{calls++;return calls===1?{ok:false,status:503}:{ok:true,json:async()=>census([])};}});
 await assert.rejects(lookup(address),error=>error.statusCode===502);assert.deepEqual((await lookup(address)).matches,[]);assert.equal(calls,2);
 const timeout=createAddressGeocoder({intervalMs:0,fetchImpl:async()=>{throw Object.assign(Error(),{name:'TimeoutError'});}});
 await assert.rejects(timeout(address),error=>error.statusCode===504);
});
test('the local address endpoint rejects cross-origin calls and returns controlled lookup results',async()=>{
 let calls=0;const geocodeAddress=createAddressGeocoder({intervalMs:0,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>census()};}}),server=createServer({geocodeAddress});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,post=input=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 try{
  let response=await fetch(base+'/api/lawn/geocode',post({address}));assert.equal(response.status,200);assert.equal((await response.json()).matches.length,1);assert.equal(response.headers.get('cache-control'),'no-store');
  response=await fetch(base+'/api/lawn/geocode',post({address:''}));assert.equal(response.status,400);assert.equal(calls,1);
  response=await fetch(base+'/api/lawn/geocode',{...post({address}),headers:{'Content-Type':'application/json',Origin:'https://unrelated.example'}});assert.equal(response.status,403);assert.equal(calls,1);
  assert.equal((await fetch(base+'/assets/lawn-address.js')).status,200);assert.equal((await fetch(base+'/assets/lawn-planner.js')).status,200);assert.equal((await fetch(base+'/lib/lawn-geocoder.js')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
function planningFixture(){
 const crew={members:1,workerRate:'60.00',equipmentRate:'0.00',overhead:'0.00',shiftStart:480,shiftEnd:540,breakStart:1000,breakMinutes:0};
 const data={geographic:true,now:480,depot:{latitude:39,longitude:-84},crews:[{...crew,id:'A',name:'Crew A'},{...crew,id:'B',name:'Crew B'}],settings:{marginBps:2500,minimumPrice:'0.00'},jobs:[1,2,3].map(i=>({id:'J'+i,name:'Job '+i,clientId:'J'+i,latitude:39+i*.01,longitude:-84,minutes:20,price:i===1?'60.00':null,materials:'0.00',status:'planned',crew:'A'}))};
 const points=roadPoints(data),durations=points.map((_,a)=>points.map((_,b)=>a===b?0:300));
 data.roadMatrix=parseRoadMatrix({code:'Ok',durations,distances:durations,sources:points.map(point=>({distance:0,location:[point.longitude,point.latitude]}))},points,timestamp);return data;
}
test('suggested prices include route travel and return once, respect margin overrides and preserve reviewed prices',()=>{
 const data=planningFixture(),plan=planLawnDay(data),before=structuredClone(data),first=suggestJobPrice(data,data.jobs[0],plan),last=suggestJobPrice(data,data.jobs[1],plan);
 assert.equal(first.cost,'25.00');assert.equal(first.suggested,'33.33');assert.equal(last.cost,'30.00');assert.equal(last.suggested,'40.00');assert.equal(first.basis,'Current day route');assert.equal(data.jobs[0].price,'60.00');assert.deepEqual(data,before);
 data.jobs[0].quoteInputs={marginBps:5000,minimum:'0.00'};assert.equal(suggestJobPrice(data,data.jobs[0],plan).suggested,'50.00');data.jobs[0].minutes=null;assert.equal(suggestJobPrice(data,data.jobs[0],plan).ready,false);
});
test('day planning fits more jobs across crews without mutating source data or losing deferred work',()=>{
 const data=planningFixture();data.jobs.push({id:'UNKNOWN',name:'Unknown time',clientId:'UNKNOWN',latitude:39.01,longitude:-84,minutes:null,price:null,status:'planned',crew:'A'});
 const before=structuredClone(data),proposal=recommendLawnDay(data),count=plan=>plan.routes.reduce((sum,route)=>sum+route.stops.length,0);
 assert.equal(count(proposal.current),2);assert.equal(count(proposal.plan),3);assert.ok(proposal.changes.length>=1);assert.equal(proposal.plan.unassigned.length,1);assert.equal(proposal.plan.unassigned[0].id,'UNKNOWN');assert.deepEqual(data,before);
 assert.deepEqual(new Set(proposal.jobs.map(job=>job.id)),new Set(data.jobs.map(job=>job.id)));assert.ok(proposal.plan.routes.every(route=>route.finish<=540));assert.equal(proposal.fingerprint,planningFingerprint(data));data.jobs[0].minutes=21;assert.notEqual(proposal.fingerprint,planningFingerprint(data));
});
test('day planning keeps reported work with its crew and preserves reported times and reviewed quotes',()=>{
 const data=planningFixture();Object.assign(data.jobs[0],{status:'working',actualStart:480,price:'60.00'});data.now=485;
 const result=recommendLawnDay(data),working=result.jobs.find(job=>job.id==='J1');assert.equal(working.crew,'A');assert.equal(working.actualStart,480);assert.equal(working.price,'60.00');assert.equal(result.plan.routes.find(route=>route.crewId==='A').stops[0].id,'J1');
});
test('the supplied 50-customer day remains fully accounted for after a recommendation',async()=>{
 const data=JSON.parse(await fs.readFile(new URL('../data/lawn-demo.json',import.meta.url),'utf8')),proposal=recommendLawnDay(data);
 assert.equal(proposal.jobs.length,50);assert.equal(proposal.plan.routes.reduce((sum,route)=>sum+route.stops.length,0)+proposal.plan.unassigned.length,50);assert.equal(proposal.jobs.filter(job=>job.price!==null).length,0);assert.equal(proposal.plan.unassigned.filter(issue=>issue.reason==='Needs a service-time estimate').length,37);
});
