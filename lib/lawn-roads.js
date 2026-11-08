import {hasCoordinates} from './lawn-geo.js';
import {isClientArchived,isReportedVisit} from './lawn-workspace.js';

export const roadProvider='OSRM / FOSSGIS · OpenStreetMap car network';
const roadOrigin='https://routing.openstreetmap.de/routed-car';
export const coordinateToken=point=>`${Number(point.longitude).toFixed(6)},${Number(point.latitude).toFixed(6)}`;
export function roadPoints(data){
 if(!hasCoordinates(data.depot))throw Error('Add valid crew-base coordinates in Business settings.');
 const all=[data.depot,...data.jobs.filter(job=>job.status!=='skipped'&&(!isClientArchived(data,job)||isReportedVisit(job))&&hasCoordinates(job)).toSorted((a,b)=>a.id.localeCompare(b.id))],seen=new Set();
 return all.filter(point=>{const key=coordinateToken(point);if(seen.has(key))return false;seen.add(key);return true;}).map(point=>({latitude:Number(point.latitude.toFixed(6)),longitude:Number(point.longitude.toFixed(6))}));
}
export function roadFingerprint(data){try{return roadPoints(data).map(coordinateToken).join(';');}catch{return '';}}
export function roadMatrixUrl(points){
 if(!points.length||points.length>100||!points.every(hasCoordinates))throw Error('Road routing supports up to 100 distinct locations, including the crew base.');
 return `${roadOrigin}/table/v1/driving/${points.map(coordinateToken).join(';')}?annotations=duration,distance&generate_hints=false`;
}
export function parseRoadMatrix(payload,points,fetchedAt=new Date().toISOString()){
 if(payload.code!=='Ok')throw Error(payload.code==='NoSegment'?'A location could not be matched to a drivable road. Review its coordinates.':'Road times could not be calculated. '+(payload.message||payload.code||''));
 const count=points.length;
 for(const key of ['durations','distances'])if(!Array.isArray(payload[key])||payload[key].length!==count||payload[key].some(row=>!Array.isArray(row)||row.length!==count||row.some(value=>value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0))))throw Error('The road-time table was incomplete.');
 if(!Array.isArray(payload.sources)||payload.sources.length!==count||payload.sources.some(point=>!point||!hasCoordinates({longitude:point.location?.[0],latitude:point.location?.[1]})||typeof point.distance!=='number'||!Number.isFinite(point.distance)||point.distance<0))throw Error('Road access points were incomplete.');
 return {signature:points.map(coordinateToken).join(';'),points,durations:payload.durations,distances:payload.distances,snaps:payload.sources.map(point=>({latitude:point.location[1],longitude:point.location[0],offsetMeters:point.distance,name:String(point.name||'')})),fetchedAt,provider:roadProvider};
}
export function roadMatrixRequests(points){
 if(!points.length||points.length>151||!points.every(hasCoordinates))throw Error('Use up to 150 job locations plus the crew base.');
 if(points.length<=100){
  const url=new URL(roadMatrixUrl(points.length===1?[points[0],points[0]]:points));
  if(points.length===1){url.searchParams.set('sources','0');url.searchParams.set('destinations','0');}
  return [{url:url.href,sources:points.map((_,index)=>index),destinations:points.map((_,index)=>index)}];
 }
 const chunks=[];for(let index=0;index<points.length;index+=50)chunks.push(points.slice(index,index+50).map((_,offset)=>index+offset));
 return chunks.flatMap(sources=>chunks.map(destinations=>{
  const indexes=[...new Set([...sources,...destinations])];
  if(indexes.length===1)indexes.push(indexes[0]===0?1:0);
  const url=new URL(roadMatrixUrl(indexes.map(index=>points[index])));
  url.searchParams.set('sources',sources.map(index=>indexes.indexOf(index)).join(';'));url.searchParams.set('destinations',destinations.map(index=>indexes.indexOf(index)).join(';'));
  return {url:url.href,sources,destinations};
 }));
}
export function mergeRoadMatrixBlocks(points,blocks,fetchedAt=new Date().toISOString()){
 const count=points.length,durations=Array.from({length:count},()=>Array(count).fill(null)),distances=Array.from({length:count},()=>Array(count).fill(null)),sources=Array(count),covered=Array.from({length:count},()=>new Set());
 for(const {request,payload}of blocks){
  if(payload?.code!=='Ok'||!Array.isArray(payload.sources)||payload.sources.length!==request.sources.length)throw Error('A road-time batch could not be calculated. Review locations or retry.');
  for(const key of ['durations','distances'])if(!Array.isArray(payload[key])||payload[key].length!==request.sources.length||payload[key].some(row=>!Array.isArray(row)||row.length!==request.destinations.length))throw Error('A road-time batch was incomplete. Retry road routes.');
  request.sources.forEach((source,row)=>{
   if(source<0||source>=count)throw Error('Invalid road-time batch.');sources[source]=payload.sources[row];
   request.destinations.forEach((destination,column)=>{if(destination<0||destination>=count)throw Error('Invalid road-time batch.');durations[source][destination]=payload.durations[row][column];distances[source][destination]=payload.distances[row][column];covered[source].add(destination);});
  });
 }
 if(covered.some(row=>row.size!==count))throw Error('Some road-time batches are missing. Retry road routes.');
 return parseRoadMatrix({code:'Ok',durations,distances,sources},points,fetchedAt);
}
export async function loadRoadMatrix(points,{refresh=false,onProgress=()=>{}}={}){
 const requests=roadMatrixRequests(points),blocks=[];
 for(const request of requests){const payload=await fetchRoadData(request.url,{refresh});blocks.push({request,payload});onProgress(blocks.length,requests.length);}
 return mergeRoadMatrixBlocks(points,blocks);
}
export function roadMatrixMatches(data){
 const matrix=data.roadMatrix,signature=roadFingerprint(data);
 return !!signature&&matrix?.signature===signature&&matrix.provider===roadProvider&&Array.isArray(matrix.points)&&matrix.points.length>0&&matrix.durations?.length===matrix.points.length&&matrix.snaps?.length===matrix.points.length;
}
export function roadTravelLookup(data){
 if(!roadMatrixMatches(data))return ()=>null;
 const matrix=data.roadMatrix,indexes=new Map(matrix.points.map((point,index)=>[coordinateToken(point),index]));
 return (from,to)=>{
  if(!hasCoordinates(from)||!hasCoordinates(to))return null;
  const a=indexes.get(coordinateToken(from)),b=indexes.get(coordinateToken(to));
  if(a===undefined||b===undefined||matrix.snaps[a]?.offsetMeters>250||matrix.snaps[b]?.offsetMeters>250)return null;
  const seconds=matrix.durations[a]?.[b];return typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0?Math.ceil(seconds/60):null;
 };
}
export function roadAccessIssue(data,point){
 if(!roadMatrixMatches(data))return 'Road driving times need to load';
 const matrix=data.roadMatrix,index=matrix.points.findIndex(candidate=>coordinateToken(candidate)===coordinateToken(point));
 if(index<0)return 'This location needs road routing';
 const offset=matrix.snaps[index]?.offsetMeters;
 return offset>250?`Review coordinates: nearest drivable road is ${Math.round(offset)} m away`:'No drivable road connection for this stop';
}
export function roadRouteSpec(data,route){
 if(!roadMatrixMatches(data)||!route?.stops?.length)return null;
 const original=[data.depot,...route.stops.map(stop=>data.jobs.find(job=>job.id===stop.id)),data.depot];
 if(!original.every(hasCoordinates))return null;
 const indexes=new Map(data.roadMatrix.points.map((point,index)=>[coordinateToken(point),index]));
 const points=original.map(point=>data.roadMatrix.snaps[indexes.get(coordinateToken(point))]);
 if(!points.every(hasCoordinates))return null;
 return {key:data.roadMatrix.fetchedAt+'|'+points.map(coordinateToken).join(';'),points,jobIds:route.stops.map(stop=>stop.id)};
}
export function roadRouteUrl(points){
 if(points.length<2||points.length>100||!points.every(hasCoordinates))throw Error('Choose a valid set of road stops.');
 return `${roadOrigin}/route/v1/driving/${points.map(coordinateToken).join(';')}?overview=full&geometries=geojson&steps=false&continue_straight=false&generate_hints=false`;
}
export function parseRoadRoute(payload,spec,fetchedAt=new Date().toISOString()){
 if(payload.code!=='Ok')throw Error('No drivable route could be drawn for these stops.');
 const route=payload.routes?.[0],coordinates=route?.geometry?.coordinates;
 if(route?.geometry?.type!=='LineString'||!Array.isArray(coordinates)||coordinates.length<2||coordinates.some(point=>!hasCoordinates({longitude:point?.[0],latitude:point?.[1]}))||!Array.isArray(route.legs)||route.legs.length!==spec.points.length-1||route.legs.some(leg=>!Number.isFinite(leg.duration)||leg.duration<0||!Number.isFinite(leg.distance)||leg.distance<0))throw Error('The road route response was incomplete.');
 return {key:spec.key,coordinates,jobIds:spec.jobIds,legs:route.legs.map(leg=>({seconds:leg.duration,meters:leg.distance})),fetchedAt,provider:roadProvider};
}
export async function loadRoadRoute(spec,{refresh=false,fetchImpl=fetch}={}){
 const coordinates=[],legs=[];
 for(let from=0;from<spec.points.length-1;from+=99){
  const points=spec.points.slice(from,from+100),raw=await fetchRoadData(roadRouteUrl(points),{refresh,fetchImpl}),part=parseRoadRoute(raw,{...spec,points});
  coordinates.push(...part.coordinates.slice(coordinates.length?1:0));legs.push(...part.legs);
 }
 if(legs.length!==spec.points.length-1)throw Error('The full road route could not be drawn.');
 return {key:spec.key,coordinates,jobIds:spec.jobIds,legs,fetchedAt:new Date().toISOString(),provider:roadProvider};
}

// This public demonstration service permits at most one request per second.
// Share one queue across matrix and geometry calls, and cache identical requests.
let roadQueue=Promise.resolve(),lastRoadRequest=0;
const roadResponseCache=new Map();
export function fetchRoadData(url,{refresh=false,fetchImpl=fetch}={}){
 const cached=roadResponseCache.get(url);if(!refresh&&cached&&Date.now()-cached.time<24*60*60*1000)return cached.promise;
 const promise=roadQueue.catch(()=>{}).then(async()=>{
  const wait=1100-(Date.now()-lastRoadRequest);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
  lastRoadRequest=Date.now();const response=await fetchImpl(url,{signal:AbortSignal.timeout(20000),referrerPolicy:'strict-origin-when-cross-origin'});
  if(!response.ok)throw Error('Road service unavailable ('+response.status+'). Retry shortly.');return response.json();
 });
 roadQueue=promise;roadResponseCache.set(url,{promise,time:Date.now()});promise.catch(()=>roadResponseCache.delete(url));
 if(roadResponseCache.size>12)roadResponseCache.delete(roadResponseCache.keys().next().value);
 return promise;
}
