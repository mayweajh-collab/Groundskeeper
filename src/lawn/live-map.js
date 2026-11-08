import {hasCoordinates,weatherRequestUrl,parseWeatherResponse,weatherDescription} from '/assets/lawn-geo.js';
import {coordinateToken,roadRouteSpec} from '/assets/lawn-roads.js';
const mapCrewColors=['#377b59','#536ee8','#ae6338','#8158ac','#268a92','#a74672','#7a8432','#3e71a1','#905d58','#506b3a','#665fc5','#8a6d26'];

export function mountAddressPreview(element,point){
 const L=globalThis.L;if(!L||!hasCoordinates(point)||location.protocol==='file:')return ()=>{};
 const map=L.map(element,{scrollWheelZoom:false,zoomControl:false}).setView([point.latitude,point.longitude],16);
 L.control.zoom({position:'topright'}).addTo(map);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'}).addTo(map);
 L.circleMarker([point.latitude,point.longitude],{radius:8,color:'#204536',weight:3,fillColor:'#79a27b',fillOpacity:1}).addTo(map).bindTooltip('Estimated service location');
 const resize=new ResizeObserver(()=>map.invalidateSize({pan:false}));resize.observe(element);
 return ()=>{resize.disconnect();map.remove();};
}

export function mountStreetMap(element,{jobs,routes,depot,roadMatrix,roadShapes={},crews,crewFilter='all',showRoutes=true,onOpen,routingWorkspace=null}){
 const L=globalThis.L;if(!L){element.textContent='The street-map reader could not load. Reopen the dashboard.';return ()=>{};}
 if(location.protocol==='file:'){element.innerHTML='<div class="empty-state"><strong>Open the local preview for street maps</strong>Run the local app so map tiles can identify the website. Weather can still load in this file.</div>';return ()=>{};}
 const map=L.map(element,{scrollWheelZoom:false,zoomControl:false}),selectedRoutes=routes.filter(route=>crewFilter==='all'||route.crewId===crewFilter);
 L.control.zoom({position:'topright'}).addTo(map);
 const tile=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'}).addTo(map);
 let errors=0;tile.on('tileerror',()=>{errors++;if(errors===4){const notice=document.createElement('div');notice.className='map-tile-error';notice.textContent='Some map tiles could not load. Check the connection or reopen the preview.';element.append(notice);}});
 const bounds=[],routeBounds=[],matrixIndexes=new Map((roadMatrix?.points||[]).map((point,index)=>[coordinateToken(point),index]));
 for(const route of selectedRoutes){
  const spec=roadRouteSpec(routingWorkspace||{jobs,depot,roadMatrix},route),shape=roadShapes[route.crewId];
  if(!showRoutes||!spec||shape?.key!==spec.key)continue;
  const coordinates=shape.coordinates.map(([longitude,latitude])=>[latitude,longitude]);routeBounds.push(...coordinates);
  const color=mapCrewColors[Math.max(0,crews.findIndex(crew=>crew.id===route.crewId))%mapCrewColors.length],casing='#253b35';
  L.polyline(coordinates,{color:casing,weight:8,opacity:.85,lineCap:'round',lineJoin:'round',className:'road-route-casing'}).addTo(map);
  const line=L.polyline(coordinates,{color,weight:5,opacity:1,lineCap:'round',lineJoin:'round',className:'road-route'}).addTo(map);
  line.bindTooltip((crews.find(c=>c.id===route.crewId)?.name||route.crewId)+' · road route · '+route.stops.length+' scheduled stops');
  line.on('add',()=>line.getElement()?.setAttribute('data-road-crew',route.crewId));
  for(const point of spec.points.slice(0,-1))L.circleMarker([point.latitude,point.longitude],{radius:3.5,color,weight:2,fillColor:'#fff',fillOpacity:1,className:'road-access-point'}).addTo(map);
 }
 const points=jobs.filter(job=>hasCoordinates(job)&&(crewFilter==='all'||job.crew===crewFilter));
 for(const job of points){
  const coordinates=[job.latitude,job.longitude];bounds.push(coordinates);
  const route=routes.find(candidate=>candidate.crewId===job.crew),index=route?.stops.findIndex(stop=>stop.id===job.id)??-1,scheduled=index>=0;
  const crewIndex=Math.max(0,crews.findIndex(crew=>crew.id===job.crew))%mapCrewColors.length;
  const marker=L.marker(coordinates,{title:job.name+' — customer location',zIndexOffset:scheduled?500:0,icon:L.divIcon({className:'street-pin crew-pin-'+crewIndex+' '+(job.crew==='B'?'blue ':'')+(scheduled?'scheduled':'unscheduled'),html:scheduled?String(index+1):'·',iconSize:scheduled?[28,28]:[18,18],iconAnchor:scheduled?[14,14]:[9,9]})}).addTo(map);
  marker.on('add',()=>marker.getElement()?.setAttribute('aria-label',job.name+' — customer location'));
  const popup=document.createElement('div');popup.className='street-popup';
  const name=document.createElement('strong');name.textContent=job.name;
  const address=document.createElement('p');address.textContent=job.address;
  const order=document.createElement('p');order.textContent=scheduled?(crews.find(c=>c.id===job.crew)?.name||job.crew)+' · Stop '+(index+1):'Not scheduled — review job details';
  const source=document.createElement('small'),snap=roadMatrix?.snaps?.[matrixIndexes.get(coordinateToken(job))];source.textContent=(job.locationSource||'Supplied coordinates')+(snap?' · Road access '+Math.round(snap.offsetMeters)+' m from pin.':'');
  const button=document.createElement('button');button.className='text-button';button.textContent='View customer job →';button.addEventListener('click',()=>onOpen(job.id));
  popup.append(name,address,order,source,button);marker.bindPopup(popup);
 }
 if(hasCoordinates(depot)){
  const base=L.marker([depot.latitude,depot.longitude],{title:'Crew base',zIndexOffset:1000,icon:L.divIcon({className:'street-base',html:'⌂',iconSize:[27,27],iconAnchor:[13,13]})}).addTo(map);
  base.bindTooltip(depot.locationSource?.startsWith('Assumed')?'Assumed crew base — review in Business settings':'Owner-entered crew base');
 }
 const fit=crewFilter!=='all'&&routeBounds.length?routeBounds:[...bounds,...routeBounds];
 if(fit.length)map.fitBounds(fit,{padding:[30,30],maxZoom:15});else map.setView([39.2,-84.5],10);
 const resize=new ResizeObserver(()=>map.invalidateSize({pan:false}));resize.observe(element);
 return ()=>{resize.disconnect();map.remove();};
}

const forecastCache=new Map();
const liveEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const forecastDate=date=>new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
const weatherNumber=(value,suffix='')=>value===null||value===undefined?'—':Math.round(value)+suffix;
export function mountWeather(element,point,{serviceDate,label}){
 let selectedDate=serviceDate,busy=false;
 const url=weatherRequestUrl(point);
 async function load(force=false){
  if(busy)return;busy=true;
  element.innerHTML='<div class="weather-loading" role="status">Loading forecast for '+liveEsc(label)+'…</div>';
  try{
   let record=forecastCache.get(url);
   if(!record||force||Date.now()-record.loadedAt>15*60*1000){
    const request=fetch(url,{signal:AbortSignal.timeout(15000)}).then(async response=>{if(!response.ok)throw Error('Weather service returned '+response.status);const forecast=parseWeatherResponse(await response.json());forecastCache.set(url,{forecast,loadedAt:Date.now()});return forecast;});
    record={request,loadedAt:Date.now()};forecastCache.set(url,record);
   }
   const forecast=record.forecast||await record.request;
   if(!element.isConnected)return;
   if(!forecast.days.some(d=>d.date===selectedDate))selectedDate=forecast.days[0].date;
   show(forecast);
  }catch(error){forecastCache.delete(url);if(element.isConnected){element.innerHTML='<div class="weather-loading"><strong>Forecast unavailable</strong><p>Check the connection and try again. No sample forecast is substituted.</p><button class="button secondary" data-weather-retry>Retry weather</button></div>';element.querySelector('[data-weather-retry]').addEventListener('click',()=>load(true));}}
  finally{busy=false;}
 }
 function show(forecast){
  const day=forecast.days.find(d=>d.date===selectedDate),hours=forecast.hours.filter(h=>h.time.startsWith(selectedDate)&&Number(h.time.slice(11,13))>=8&&Number(h.time.slice(11,13))<=17);
  const fetched=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:forecast.timezone,timeZoneName:'short'}).format(new Date(forecast.fetchedAt));
  element.innerHTML=`<div class="weather-topline"><div><strong>${liveEsc(label)}</strong><small>${liveEsc(weatherDescription(day.code))} · forecast for ${liveEsc(forecastDate(day.date))}</small></div><div class="weather-actions"><label class="sr-only" for="weather-date">Forecast day</label><select id="weather-date">${forecast.days.map(d=>`<option value="${d.date}" ${d.date===selectedDate?'selected':''}>${forecastDate(d.date)}</option>`).join('')}</select><button class="text-button" data-weather-refresh>Refresh</button></div></div>${selectedDate!==serviceDate?`<p class="weather-date-note">Job plan: ${liveEsc(forecastDate(serviceDate))}. The forecast shown is for ${liveEsc(forecastDate(selectedDate))}.</p>`:''}<div class="weather-metrics"><div><small>High / low</small><strong>${weatherNumber(day.high,'°')} / ${weatherNumber(day.low,'°F')}</strong></div><div><small>Highest rain chance</small><strong>${weatherNumber(day.rain,'%')}</strong></div><div><small>Maximum wind</small><strong>${weatherNumber(day.wind,' mph')}</strong></div></div><div class="weather-hours" aria-label="Hourly weather from 8 am to 5 pm">${hours.map(hour=>{const h=Number(hour.time.slice(11,13));return `<div><time>${h%12||12}${h>=12?'pm':'am'}</time><strong>${weatherNumber(hour.temperature,'°')}</strong><span>${weatherNumber(hour.rain,'%')} rain</span><small>${weatherNumber(hour.wind,' mph')}</small></div>`;}).join('')}</div><div class="weather-attribution"><span>Model forecast · ${liveEsc(forecast.timezone)} · Retrieved ${liveEsc(fetched)}</span><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather data: Open-Meteo ↗</a></div>`;
  element.querySelector('#weather-date').addEventListener('change',event=>{selectedDate=event.target.value;show(forecast);});
  element.querySelector('[data-weather-refresh]').addEventListener('click',()=>load(true));
 }
 load();
}
