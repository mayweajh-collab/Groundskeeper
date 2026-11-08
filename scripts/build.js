import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import XLSX from 'xlsx';
import {toCSV} from '../lib/csv.js';
import {createLawnTemplate} from '../lib/lawn-intake.js';

const require=createRequire(import.meta.url),root=new URL('../',import.meta.url),output=new URL('public/',root);
const read=file=>fs.readFile(new URL(file,root),'utf8');
const normalize=text=>text.replace(/\r\n?/g,'\n');
const strip=text=>text.replace(/^import .*?;\r?\n/gm,'');
const files=['lib/finance.js','lib/csv.js','lib/lawn-geo.js','lib/lawn-workspace.js','lib/lawn-service-times.js','lib/lawn-roads.js','lib/lawn-address.js','lib/lawn-intake.js','lib/lawn.js','lib/lawn-planner.js','lib/lawn-week.js','lib/lawn-bulk-pricing.js','lib/landscape-projects.js','lib/business-seed.js','src/lawn/live-map.js','src/lawn/operations-ui.js','src/lawn/landscape-ui.js','src/lawn/business-client.js','src/lawn/business-access.js','src/lawn/bulk-pricing-ui.js','src/lawn/app.js'];
const [template,css,operationsCSS,accountCSS,bulkCSS,raw,notices,...modules]=await Promise.all(['src/lawn/index.html','src/lawn/styles.css','src/lawn/operations.css','src/lawn/business-access.css','src/lawn/bulk-pricing.css','data/lawn-demo.json','THIRD-PARTY-NOTICES.txt',...files].map(read));
const [sheetjs,leaflet,leafletStyles]=await Promise.all(['xlsx/dist/xlsx.full.min.js','leaflet/dist/leaflet.js','leaflet/dist/leaflet.css'].map(file=>fs.readFile(require.resolve(file),'utf8')));
let leafletCSS=leafletStyles;
for(const name of ['layers.png','layers-2x.png','marker-icon.png']){
 const image=await fs.readFile(require.resolve('leaflet/dist/images/'+name));
 leafletCSS=leafletCSS.replaceAll('images/'+name,'data:image/png;base64,'+image.toString('base64'));
}
const data=JSON.parse(raw),safeJSON=JSON.stringify(data).replace(/</g,'\\u003c');
const html=normalize(template)
 .replace('<link rel="stylesheet" href="/vendor/leaflet.css">','')
 .replace('<script type="module" src="/lawn.js"></script>',()=>'<script id="lawn-demo-data" type="application/json">'+safeJSON+'</script><script type="module" src="/lawn.js"></script>')
 .replace(/<\/body>\s*<\/html>\s*$/,()=>'<!--\n'+notices.replaceAll('--','—')+'\n-->\n</body></html>');
if(html===template||!html.includes('id="lawn-demo-data"'))throw Error('Dashboard template could not be built.');
const write=async(file,bytes)=>{const url=new URL(file,output);await fs.mkdir(new URL('.',url),{recursive:true});await fs.writeFile(url,bytes);};
await write('index.html',html);
await write('lawn.js',normalize(modules.map(strip).join('\n')));
await write('lawn.css',normalize(leafletCSS)+'\n'+normalize(css)+'\n'+normalize(operationsCSS)+'\n'+normalize(accountCSS)+'\n'+normalize(bulkCSS));
await write('vendor/leaflet.js',leaflet);
await write('vendor/leaflet.css',leafletCSS);
await write('vendor/xlsx.js',sheetjs);
const clerkDist=new URL('../node_modules/@clerk/clerk-js/dist/',import.meta.url);
for(const name of await fs.readdir(clerkDist))if(name==='clerk.browser.js'||/_clerk\.browser_.*\.js$/.test(name))await write('vendor/clerk/'+name,await fs.readFile(new URL(name,clerkDist)));
await write('vendor/clerk/LICENSE',await fs.readFile(new URL('../node_modules/@clerk/clerk-js/LICENSE',import.meta.url)));
await write('THIRD-PARTY-NOTICES.txt',notices);
const records=data.jobs.map(j=>({client_id:j.clientId,client_name:j.name,address:j.street||j.address,city:j.city,state:j.region,zip:j.zip,county:j.county,phone:j.phone,email:j.email,mow:j.mow?'yes':'no',edge:j.edge?'yes':'no',mulch:j.mulch?'yes':'no',hedge:j.hedge?'yes':'no',job_price_usd:j.price,estimated_minutes:j.minutes,crew_id:j.crew,latitude:j.latitude,longitude:j.longitude}));
await write('groundskeeper-demo-customers.csv',toCSV(records));
await write('groundskeeper-import-template.xlsx',XLSX.write(createLawnTemplate(XLSX),{type:'buffer',bookType:'xlsx'}));
console.log('Built Groundskeeper with editable source, 50 mock customers, Excel import, maps, pricing and weekly planning.');
