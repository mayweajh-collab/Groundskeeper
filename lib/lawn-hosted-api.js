import {createAddressGeocoder} from './lawn-geocoder.js';

const MAX_BODY_BYTES=2048;
const failure=(message,statusCode)=>Object.assign(Error(message),{statusCode});
const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});

async function readAddress(request){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw failure('Send the address as JSON.',415);
 if(Number(request.headers.get('content-length'))>MAX_BODY_BYTES)throw failure('The address request is too large.',413);
 if(!request.body)throw failure('Enter a street address.',400);
 const reader=request.body.getReader(),parts=[];let size=0;
 try{
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();throw failure('The address request is too large.',413);}parts.push(value);}
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw failure('The address request is not valid JSON.',400);}
 if(!body||Array.isArray(body)||typeof body.address!=='string')throw failure('Enter a street address.',400);
 return body.address;
}

export function createGroundskeeperApi({geocodeAddress=createAddressGeocoder(),reportFailure=status=>console.error('Groundskeeper address lookup failed',{status})}={}){
 return async function fetchGroundskeeper(request){
  const url=new URL(request.url),path=url.pathname.replace(/\/$/,'');
  if(path==='/api/health'){
   if(!['GET','HEAD'].includes(request.method))return json({error:'Use GET for this endpoint.'},405,{Allow:'GET, HEAD'});
   const response=json({ok:true,app:'Groundskeeper',mode:'lawn-care-dashboard',storage:'browser-local'});
   return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
  }
  if(path!=='/api/lawn/geocode')return json({error:'Endpoint not found.'},404);
  if(request.method!=='POST')return json({error:'Use POST for address lookup.'},405,{Allow:'POST'});
  const origin=request.headers.get('origin');
  if(origin&&origin!==url.origin)return json({error:'Address lookup must be requested from this website.'},403);
  try{return json(await geocodeAddress(await readAddress(request)));}
  catch(error){
   const status=[400,413,415,502,503,504].includes(error.statusCode)?error.statusCode:500;
   if(status>=500)reportFailure(status);
   return json({error:status===500?'Address lookup could not be completed. Please try again.':error.message},status);
  }
 };
}
