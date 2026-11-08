export function hasCoordinates(point){return typeof point?.latitude==='number'&&typeof point?.longitude==='number'&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=90&&Math.abs(point.longitude)<=180;}
export function parseCoordinates(latitude,longitude){
 const lat=String(latitude??'').trim(),lon=String(longitude??'').trim();
 if(!lat&&!lon)return {latitude:null,longitude:null};
 const point={latitude:lat===''?null:Number(lat),longitude:lon===''?null:Number(lon)};
 if(!hasCoordinates(point))throw Error('Supply valid Latitude and Longitude together.');
 return point;
}
export function coordinateCenter(jobs){const points=jobs.filter(hasCoordinates);if(!points.length)return null;return {latitude:points.reduce((s,p)=>s+p.latitude,0)/points.length,longitude:points.reduce((s,p)=>s+p.longitude,0)/points.length};}
export function estimatedGeoTravel(a,b){
 const rad=v=>v*Math.PI/180,dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);
 const h=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
 const miles=3958.7613*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
 return miles<.001?0:Math.ceil(miles*1.25/25*60)+2;
}
export function prepareGeoWorkspace(data){
 const center=coordinateCenter(data.jobs);if(!center)return;
 data.geographic=true;
 if(!hasCoordinates(data.depot))Object.assign(data.depot,center,{locationSource:'Assumed service-area center — owner review needed'});
 const cities=new Map();for(const job of data.jobs)if(job.city)cities.set(job.city,(cities.get(job.city)||0)+1);
 const top=[...cities].sort((a,b)=>b[1]-a[1])[0]?.[0];const state=data.jobs.find(j=>j.region)?.region;
 data.area=top?`${top} region${state?', '+state:''}`:'Imported service area';
}
export function weatherRequestUrl(point){
 if(!hasCoordinates(point))throw Error('Choose a location with valid coordinates.');
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 for(const [key,value]of Object.entries({latitude:point.latitude.toFixed(4),longitude:point.longitude.toFixed(4),current:'temperature_2m,weather_code,wind_speed_10m',hourly:'temperature_2m,precipitation_probability,wind_speed_10m',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',temperature_unit:'fahrenheit',wind_speed_unit:'mph',timezone:'auto',forecast_days:7}))url.searchParams.set(key,value);
 return url.href;
}
export function weatherDescription(code){if(code===0)return 'Clear';if([1,2].includes(code))return 'Partly cloudy';if(code===3)return 'Overcast';if([45,48].includes(code))return 'Fog';if([51,53,55,56,57].includes(code))return 'Drizzle';if([61,63,65,66,67,80,81,82].includes(code))return 'Rain';if([71,73,75,77,85,86].includes(code))return 'Snow';if([95,96,99].includes(code))return 'Thunderstorms';return 'Conditions unavailable';}
export function parseWeatherResponse(payload,fetchedAt=new Date().toISOString()){
 if(payload.error||!payload.daily?.time?.length||!payload.hourly?.time?.length||!payload.timezone)throw Error('The forecast response was incomplete.');
 const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
 const days=payload.daily.time.map((date,i)=>({date,code:number(payload.daily.weather_code?.[i]),high:number(payload.daily.temperature_2m_max?.[i]),low:number(payload.daily.temperature_2m_min?.[i]),rain:number(payload.daily.precipitation_probability_max?.[i]),wind:number(payload.daily.wind_speed_10m_max?.[i])}));
 const hours=payload.hourly.time.map((time,i)=>({time,temperature:number(payload.hourly.temperature_2m?.[i]),rain:number(payload.hourly.precipitation_probability?.[i]),wind:number(payload.hourly.wind_speed_10m?.[i])}));
 return {days,hours,current:payload.current||null,timezone:payload.timezone,fetchedAt,source:'Open-Meteo',units:{temperature:payload.daily_units?.temperature_2m_max||'°F',wind:payload.daily_units?.wind_speed_10m_max||'mph'}};
}
