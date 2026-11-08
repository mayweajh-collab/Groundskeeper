import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {hasCoordinates,parseCoordinates,coordinateCenter,estimatedGeoTravel,weatherRequestUrl,parseWeatherResponse} from '../lib/lawn-geo.js';
import {normalizeLawnRows} from '../lib/lawn-intake.js';
import {importLawnRows,services,planLawnDay,startLawnJob} from '../lib/lawn.js';
const fixture=async()=>JSON.parse(await fs.readFile(new URL('../data/lawn-routing-sample.json',import.meta.url),'utf8'));
test('coordinates preserve zero and reject incomplete or invalid pairs',()=>{
 assert.deepEqual(parseCoordinates('0','0'),{latitude:0,longitude:0});assert.deepEqual(parseCoordinates('',''),{latitude:null,longitude:null});
 for(const pair of [['','-84'],['39',''],['91','-84'],['39','-181'],['not a number','-84']])assert.throws(()=>parseCoordinates(...pair));
 assert.equal(hasCoordinates({latitude:'39',longitude:-84}),false);
});
test('supplied workbook columns retain full address, coordinates and all four services',async()=>{
 const data=await fixture(),rows=normalizeLawnRows([{ID:123,Name:'Workbook Sample',Address:'123 Sample Lane',City:'Cincinnati',State:'OH',ZIP:'45201',Mowing:'Yes',Edging:'Yes',Mulching:'Yes','Hedge Maintenance':'Yes',Latitude:39.1,Longitude:-84.5,Phone:'0202-555-0123'}]);
 const result=importLawnRows(rows,data),job=result.jobs[0];
 assert.equal(result.jobs.length,1);assert.equal(job.clientId,'123');assert.equal(job.address,'123 Sample Lane, Cincinnati, OH 45201');assert.equal(job.latitude,39.1);assert.equal(job.longitude,-84.5);assert.equal(job.phone,'0202-555-0123');assert.equal(services(job).length,4);assert.equal(job.minutes,null);assert.equal(job.price,null);
 assert.ok(result.issues.some(i=>i.message.includes('all requested services')));
});
test('the 50-customer seed never invents prices or extra-service durations and keeps every job visible',async()=>{
 const data=JSON.parse(await fs.readFile(new URL('../data/lawn-demo.json',import.meta.url),'utf8'));
 assert.equal(data.jobs.length,50);assert.equal(data.jobs.filter(hasCoordinates).length,50);assert.ok(data.jobs.every(j=>j.price===null));assert.equal(data.jobs.filter(j=>j.minutes===null).length,37);
 const plan=planLawnDay(data,true);assert.equal(plan.routes.reduce((n,r)=>n+r.stops.length,0)+plan.unassigned.length,50);
 assert.ok(plan.unassigned.some(j=>j.reason==='Needs a service-time estimate'));
 const missing=data.jobs.find(j=>j.minutes===null);assert.throws(()=>startLawnJob(data,missing.id),/service-time estimate/);
});
test('geographic distance times are symmetric estimates and weather requests expose only the area center',()=>{
 const a={latitude:39.1,longitude:-84.5},b={latitude:39.3,longitude:-84.4};assert.equal(estimatedGeoTravel(a,a),0);assert.equal(estimatedGeoTravel(a,b),estimatedGeoTravel(b,a));assert.ok(estimatedGeoTravel(a,b)>0);
 const center=coordinateCenter([a,b,{latitude:null,longitude:null}]);assert.equal(center.latitude,39.2);
 const url=new URL(weatherRequestUrl(center));assert.equal(url.origin,'https://api.open-meteo.com');assert.equal(url.searchParams.get('timezone'),'auto');assert.equal(url.searchParams.get('forecast_days'),'7');assert.equal(url.searchParams.has('address'),false);assert.throws(()=>weatherRequestUrl({latitude:NaN,longitude:0}));
});
test('weather preserves missing forecast values and rejects incomplete upstream responses',()=>{
 assert.throws(()=>parseWeatherResponse({error:true}));
 const result=parseWeatherResponse({timezone:'America/New_York',daily:{time:['2026-11-09'],temperature_2m_max:[62],temperature_2m_min:[null],precipitation_probability_max:[0]},hourly:{time:['2026-11-09T08:00'],temperature_2m:[40]}},'2026-11-07T22:00:00Z');
 assert.equal(result.days[0].high,62);assert.equal(result.days[0].low,null);assert.equal(result.days[0].rain,0);assert.equal(result.days[0].wind,null);assert.equal(result.hours[0].rain,null);assert.equal(result.fetchedAt,'2026-11-07T22:00:00Z');
});
