import {hasCoordinates} from './lawn-geo.js';
import {normalizeServiceAddress,serviceAddressKey} from './lawn-address.js';

const failure=(message,statusCode)=>Object.assign(Error(message),{statusCode});
export function censusGeocodeUrl(value){
 const address=normalizeServiceAddress(value),url=new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
 url.searchParams.set('address',address);url.searchParams.set('benchmark','Public_AR_Current');url.searchParams.set('format','json');return url;
}
export function parseCensusAddress(payload,fetchedAt=new Date().toISOString()){
 const raw=payload?.result?.addressMatches;
 if(!Array.isArray(raw))throw failure('The address service returned an incomplete result. Try again.',502);
 const matches=[],seen=new Set();
 for(const item of raw){
  const point={latitude:item?.coordinates?.y,longitude:item?.coordinates?.x};
  if(!hasCoordinates(point)||typeof item.matchedAddress!=='string'||!item.matchedAddress.trim()||item.matchedAddress.length>300)throw failure('The address service returned an invalid location. Try again.',502);
  const key=item.matchedAddress+'|'+point.latitude+'|'+point.longitude;if(seen.has(key))continue;seen.add(key);
  const parts=item.addressComponents||{};
  matches.push({...point,matchedAddress:item.matchedAddress,city:String(parts.city||'').slice(0,100),region:String(parts.state||'').slice(0,20),zip:String(parts.zip||'').slice(0,20)});
  if(matches.length===5)break;
 }
 return {provider:'U.S. Census Geocoder',precision:'Street address range estimate',fetchedAt,matches};
}
export function createAddressGeocoder({fetchImpl=fetch,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),intervalMs=1100}={}){
 const cache=new Map();let queue=Promise.resolve(),lastStarted=0,pending=0;
 return async value=>{
  let address;try{address=normalizeServiceAddress(value);}catch(error){throw failure(error.message,400);}
  const key=serviceAddressKey(address),cached=cache.get(key);
  if(cached&&now()-cached.time<24*60*60*1000)return cached.promise;
  if(pending>=8)throw failure('Address lookup is busy. Please try again shortly.',503);
  pending++;
  const promise=queue.catch(()=>{}).then(async()=>{
   const pause=intervalMs-(now()-lastStarted);if(pause>0)await wait(pause);lastStarted=now();
   let response;
   try{response=await fetchImpl(censusGeocodeUrl(address),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000),redirect:'error'});}catch(error){throw failure(error.name==='TimeoutError'?'Address lookup timed out. Try again.':'The address service could not be reached. Try again.',504);}
   if(!response.ok)throw failure('The address service is unavailable. Try again shortly.',502);
   let payload;try{payload=await response.json();}catch{throw failure('The address service returned an unreadable result. Try again.',502);}
   return parseCensusAddress(payload,new Date(now()).toISOString());
  });
  queue=promise;cache.set(key,{time:now(),promise});
  promise.catch(()=>{if(cache.get(key)?.promise===promise)cache.delete(key);}).finally(()=>pending--);
  if(cache.size>200)cache.delete(cache.keys().next().value);
  return promise;
 };
}
