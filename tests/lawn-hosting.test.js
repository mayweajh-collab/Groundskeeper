import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroundskeeperApi} from '../lib/lawn-hosted-api.js';

const origin='https://groundskeeper.example';
const post=(body,headers={})=>new Request(origin+'/api/lawn/geocode',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:typeof body==='string'?body:JSON.stringify(body)});

test('hosted address lookup sends only the address and prevents response caching',async()=>{
 const calls=[],payload={provider:'U.S. Census Geocoder',matches:[]};
 const api=createGroundskeeperApi({geocodeAddress:async address=>{calls.push(address);return payload;}});
 const response=await api(post({address:'950 Eden Park Dr, Cincinnati, OH 45202',email:'private@example.test'}));
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.deepEqual(await response.json(),payload);assert.deepEqual(calls,['950 Eden Park Dr, Cincinnati, OH 45202']);
});

test('hosted API rejects cross-site requests, bad methods, malformed JSON and oversized streaming bodies before lookup',async()=>{
 let calls=0;const api=createGroundskeeperApi({geocodeAddress:async()=>{calls++;return {};}});
 const cases=[
  [new Request(origin+'/api/lawn/geocode'),405],
  [post({address:'950 Eden Park Dr'},{Origin:'https://other.example'}),403],
  [post('{broken'),400],[post({address:42}),400],[post([]),400],
  [post('950 Eden Park Dr',{'Content-Type':'text/plain'}),415],
  [post({address:'a'.repeat(3000)}),413],
  [post({address:'950 Eden Park Dr'},{'Content-Length':'99999'}),413]
 ];
 for(const [request,status]of cases)assert.equal((await api(request)).status,status);
 assert.equal(calls,0);
});

test('hosted health and unknown endpoints do not expose configuration or invoke address lookup',async()=>{
 const api=createGroundskeeperApi({geocodeAddress:async()=>{throw Error('Should not run');}});
 const response=await api(new Request(origin+'/api/health'));
 assert.deepEqual(await response.json(),{ok:true,app:'Groundskeeper',mode:'lawn-care-dashboard',storage:'browser-local'});
 const head=await api(new Request(origin+'/api/health',{method:'HEAD'}));assert.equal(await head.text(),'');
 assert.equal((await api(new Request(origin+'/api/not-real'))).status,404);
});

test('hosted geocoder preserves controlled provider errors and hides unexpected details',async()=>{
 for(const code of [400,502,503,504,500]){
  const logged=[],message=code===500?'SECRET_INTERNAL_DETAILS':'Controlled error';
  const api=createGroundskeeperApi({geocodeAddress:async()=>{throw Object.assign(Error(message),{statusCode:code});},reportFailure:status=>logged.push(status)});
  const response=await api(post({address:'950 Eden Park Dr'})),body=await response.text();
  assert.equal(response.status,code);assert.equal(body.includes('SECRET_INTERNAL_DETAILS'),false);
  assert.deepEqual(logged,code>=500?[code]:[]);
 }
});
