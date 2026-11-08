import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {planLawnDay} from '../lib/lawn.js';
import {coordinateToken,roadPoints,roadFingerprint,roadMatrixUrl,parseRoadMatrix,roadMatrixMatches,roadTravelLookup,roadRouteSpec,roadRouteUrl,parseRoadRoute,fetchRoadData,roadMatrixRequests,mergeRoadMatrixBlocks,loadRoadRoute} from '../lib/lawn-roads.js';

function roadFixture(){
 const data={geographic:true,now:480,depot:{latitude:39.2,longitude:-84.5},settings:{marginBps:2500,minimumPrice:'0.00'},crews:[{id:'A',name:'Crew A',members:1,workerRate:'60.00',equipmentRate:'0.00',overhead:'0.00',shiftStart:480,shiftEnd:1020,breakStart:1100,breakMinutes:0}],jobs:[
  {id:'B',clientId:'B',name:'B',latitude:39.3,longitude:-84.4,crew:'A',minutes:10,price:'100.00',status:'planned'},
  {id:'A',clientId:'A',name:'A',latitude:39.25,longitude:-84.45,crew:'A',minutes:10,price:'100.00',status:'planned'}
 ]};
 const points=roadPoints(data);assert.equal(points[1].latitude,39.25);
 const raw={code:'Ok',durations:[[0,61,500],[100,0,119],[181,700,0]],distances:[[0,1000,8000],[1500,0,2000],[3000,9000,0]],sources:points.map(point=>({location:[point.longitude,point.latitude],distance:0,name:'Sample road'}))};
 data.roadMatrix=parseRoadMatrix(raw,points,'2026-11-07T22:00:00Z');return {data,raw,points};
}

test('road request coordinates are longitude-first, bounded, and cached independently of price/time edits',()=>{
 const {data}=roadFixture(),before=roadFingerprint(data),url=new URL(roadMatrixUrl(roadPoints(data)));
 assert.equal(url.hostname,'routing.openstreetmap.de');assert.ok(url.pathname.includes('/table/v1/driving/-84.500000,39.200000;'));assert.equal(url.searchParams.has('fallback_speed'),false);
 data.jobs[0].price='75.00';data.jobs[0].minutes=30;assert.equal(roadFingerprint(data),before);
 data.jobs[0].longitude+=.001;assert.notEqual(roadFingerprint(data),before);assert.equal(roadMatrixMatches(data),false);
 assert.throws(()=>roadMatrixUrl(Array.from({length:101},()=>({latitude:39,longitude:-84}))),/100/);
});

test('road scheduling and optimization use asymmetric driving time and count the return trip exactly once',()=>{
 const {data}=roadFixture(),baseline=planLawnDay(data),optimized=planLawnDay(data,true),route=optimized.routes[0];
 assert.equal(baseline.travelMinutes,23);assert.equal(optimized.travelMinutes,8);assert.deepEqual(route.stops.map(stop=>stop.id),['A','B']);
 assert.equal(route.stops[0].start,482);assert.equal(route.stops[1].start,494);assert.equal(route.stops[1].returnMinutes,4);assert.equal(route.finish,508);
 assert.equal(optimized.cost,'28.00');assert.equal(optimized.revenue,'200.00');assert.equal(optimized.roadReady,true);
});

test('unreachable road pairs remain unavailable rather than becoming zero or straight-line estimates',()=>{
 const {data,raw,points}=roadFixture();raw.durations[2][0]=null;raw.distances[2][0]=null;data.roadMatrix=parseRoadMatrix(raw,points);
 const travel=roadTravelLookup(data);assert.equal(travel(data.jobs[0],data.depot),null);assert.equal(travel(data.depot,data.depot),0);
 const result=planLawnDay(data,true);assert.equal(result.unassigned.length,1);assert.equal(result.unassigned[0].id,'B');assert.match(result.unassigned[0].reason,/drivable road/);
 assert.equal(result.routes[0].stops.length+result.unassigned.length,2);
});

test('changed coordinates invalidate road times and far-away access points require review',()=>{
 const {data,raw,points}=roadFixture();raw.sources[1].distance=500;data.roadMatrix=parseRoadMatrix(raw,points);
 let result=planLawnDay(data,true);assert.ok(result.unassigned.some(job=>job.id==='A'&&job.reason.includes('500 m')));
 data.jobs[0].latitude+=.01;result=planLawnDay(data,true);assert.equal(result.roadReady,false);assert.equal(result.routes[0].stops.length,0);assert.equal(result.unassigned.length,2);assert.equal(result.travelMinutes,0);
});

test('road rerouting preserves reported work and owner-reviewed prices',()=>{
 const {data}=roadFixture();Object.assign(data.jobs[1],{status:'working',actualStart:500,price:'60.00'});data.now=505;
 const result=planLawnDay(data,true);assert.equal(result.routes[0].stops[0].id,'A');assert.equal(result.routes[0].stops[0].start,500);assert.equal(data.jobs[1].actualStart,500);assert.equal(data.jobs[1].price,'60.00');
});

test('road geometry cache follows stop order, validates legs, and requests road vertices',()=>{
 const {data}=roadFixture(),route=planLawnDay(data,true).routes[0],spec=roadRouteSpec(data,route),url=new URL(roadRouteUrl(spec.points));
 assert.equal(url.searchParams.get('geometries'),'geojson');assert.equal(url.searchParams.get('continue_straight'),'false');
 const raw={code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[-84.5,39.2],[-84.48,39.2],[-84.45,39.25],[-84.4,39.3],[-84.5,39.2]]},legs:[{duration:61,distance:1000},{duration:119,distance:2000},{duration:181,distance:3000}]}]};
 const shape=parseRoadRoute(raw,spec);assert.equal(shape.key,spec.key);assert.deepEqual(shape.jobIds,['A','B']);
 assert.notEqual(roadRouteSpec(data,{...route,stops:[...route.stops].reverse()}).key,spec.key);
 raw.routes[0].legs.pop();assert.throws(()=>parseRoadRoute(raw,spec),/incomplete/);assert.throws(()=>parseRoadRoute({code:'NoRoute'},spec),/drivable route/);
});

test('incomplete routing responses cannot produce a healthy table',()=>{
 const {raw,points}=roadFixture();raw.durations[0][1]=-10;assert.throws(()=>parseRoadMatrix(raw,points),/incomplete/);assert.throws(()=>parseRoadMatrix({code:'NoSegment'},points),/coordinates/);
});

test('identical in-flight routing requests are coalesced and service failures surface',async()=>{
 let requests=0;const fetchImpl=async()=>{requests++;return {ok:true,json:async()=>({code:'Ok'})};};
 const url='https://routing.openstreetmap.de/routed-car/table/v1/driving/0,0;1,1?test=cache';
 const [first,second]=await Promise.all([fetchRoadData(url,{fetchImpl}),fetchRoadData(url,{fetchImpl})]);assert.equal(requests,1);assert.deepEqual(first,second);
 await assert.rejects(fetchRoadData(url+'-error',{fetchImpl:async()=>({ok:false,status:429})}),/429/);
});

test('saved live road geometry agrees with the scheduling table for the supplied customer seed',async()=>{
 const data=JSON.parse(await fs.readFile(new URL('../data/lawn-demo.json',import.meta.url),'utf8')),plan=planLawnDay(data,false);
 assert.equal(roadMatrixMatches(data),true);assert.equal(data.roadMatrix.points.length,51);
 for(const route of plan.routes){const shape=data.roadShapes[route.crewId],spec=roadRouteSpec(data,route);assert.equal(shape.key,spec.key);assert.ok(shape.coordinates.length>route.stops.length+2);assert.equal(shape.legs.length,route.stops.length+1);assert.equal(shape.legs.reduce((sum,leg)=>sum+Math.ceil(leg.seconds/60),0),route.travelMinutes);}
 assert.equal(plan.routes.reduce((sum,route)=>sum+route.stops.length,0)+plan.unassigned.length,50);
});

test('large workspaces partition road requests and preserve every directional cell and unreachable trip',()=>{
 const points=Array.from({length:151},(_,index)=>({latitude:39+index*.001,longitude:-84})),requests=roadMatrixRequests(points);
 assert.equal(requests.length,16);assert.throws(()=>roadMatrixRequests([...points,points[0]]),/150/);
 const blocks=requests.map(request=>{
  const url=new URL(request.url),coordinates=url.pathname.split('/').at(-1).split(';');assert.ok(coordinates.length>=2&&coordinates.length<=100);
  return {request,payload:{code:'Ok',durations:request.sources.map(a=>request.destinations.map(b=>a===1&&b===150?null:a===b?0:a*1000+b)),distances:request.sources.map(a=>request.destinations.map(b=>a===b?0:a*1000+b)),sources:request.sources.map(index=>({distance:0,location:[points[index].longitude,points[index].latitude]}))}};
 });
 const matrix=mergeRoadMatrixBlocks(points,blocks,timestamp());assert.equal(matrix.durations.length,151);assert.equal(matrix.durations[150][1],150001);assert.equal(matrix.durations[1][150],null);assert.equal(matrix.snaps.length,151);assert.throws(()=>mergeRoadMatrixBlocks(points,blocks.slice(1)),/missing/);
});
const timestamp=()=>new Date().toISOString();
test('a final singleton road batch still sends the two coordinates required by OSRM',()=>{
 for(const count of [1,101]){
  const points=Array.from({length:count},(_,index)=>({latitude:39+index*.001,longitude:-84})),request=roadMatrixRequests(points).at(-1),url=new URL(request.url);
  assert.equal(url.pathname.split('/').at(-1).split(';').length,2);assert.equal(request.sources.length,1);assert.equal(request.destinations.length,1);assert.equal(url.searchParams.get('sources'),'0');assert.equal(url.searchParams.get('destinations'),'0');
 }
});
test('long road routes join overlapping chunks without losing return legs',async()=>{
 const points=Array.from({length:152},(_,index)=>({latitude:38+index*.001,longitude:-85}));let calls=0;
 const shape=await loadRoadRoute({points,key:'long-route',jobIds:Array.from({length:150},(_,i)=>'L'+i)},{fetchImpl:async url=>{
  calls++;const coordinates=new URL(url).pathname.split('/').at(-1).split(';').map(pair=>pair.split(',').map(Number));assert.ok(coordinates.length<=100);
  return {ok:true,json:async()=>({code:'Ok',routes:[{geometry:{type:'LineString',coordinates},legs:coordinates.slice(1).map(()=>({duration:60,distance:100}))}]})};
 }});
 assert.equal(calls,2);assert.equal(shape.legs.length,151);assert.equal(shape.coordinates.length,152);assert.deepEqual(shape.coordinates.at(-1),[-85,38.151]);
});
