import http from 'node:http';
import fs from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {createAccountApi} from './lib/account-api.js';

const root=new URL('./',import.meta.url);
const config=JSON.parse(await fs.readFile(new URL('vercel.json',root),'utf8'));
const security=Object.fromEntries(config.headers[0].headers.map(header=>[header.key,header.value]));
const publicFiles={
 '/':['public/index.html','text/html; charset=utf-8'],
 '/index.html':['public/index.html','text/html; charset=utf-8'],
 '/lawn.js':['public/lawn.js','text/javascript; charset=utf-8'],
 '/lawn.css':['public/lawn.css','text/css; charset=utf-8'],
 '/vendor/leaflet.js':['public/vendor/leaflet.js','text/javascript; charset=utf-8'],
 '/vendor/leaflet.css':['public/vendor/leaflet.css','text/css; charset=utf-8'],
 '/vendor/xlsx.js':['public/vendor/xlsx.js','text/javascript; charset=utf-8'],
 '/groundskeeper-import-template.xlsx':['public/groundskeeper-import-template.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
 '/groundskeeper-demo-customers.csv':['public/groundskeeper-demo-customers.csv','text/csv; charset=utf-8'],
 '/THIRD-PARTY-NOTICES.txt':['public/THIRD-PARTY-NOTICES.txt','text/plain; charset=utf-8']
};
for(const alias of ['/groundskeeper.html','/lawn.html','/dashboard.html'])publicFiles[alias]=publicFiles['/'];
try{for(const name of await fs.readdir(new URL('public/vendor/clerk/',root)))if(/^[a-zA-Z0-9_.-]+\.js$/.test(name))publicFiles['/vendor/clerk/'+name]=['public/vendor/clerk/'+name,'text/javascript; charset=utf-8'];}catch{}
for(const name of ['lawn-intake','lawn-geo','lawn-roads','lawn-address','lawn-planner','lawn-workspace','lawn-week','lawn-service-times','finance','csv'])publicFiles['/assets/'+name+'.js']=['lib/'+name+'.js','text/javascript; charset=utf-8'];
publicFiles['/assets/lawn-engine.js']=['lib/lawn.js','text/javascript; charset=utf-8'];

export function createServer(options={}){
 const api=createAccountApi(options);
 return http.createServer(async(req,res)=>{
  const send=async response=>{res.writeHead(response.status,{...security,...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));};
  try{
   const url=new URL(req.url,'http://'+req.headers.host);
   if(req.headers.origin&&req.headers.origin!==url.origin)return send(Response.json({error:'Cross-origin requests disabled'},{status:403}));
   if(req.method==='GET'&&url.pathname==='/api/lawn/demo')return send(Response.json(JSON.parse(await fs.readFile(new URL('data/lawn-demo.json',root),'utf8')),{headers:{'Cache-Control':'no-store'}}));
   if(url.pathname.startsWith('/api/')){
    const init={method:req.method,headers:req.headers};
    if(!['GET','HEAD'].includes(req.method)){init.body=Readable.toWeb(req);init.duplex='half';}
    return send(await api(new Request(url,init)));
   }
   const file=publicFiles[url.pathname];
   if(!file)return send(Response.json({error:'Not found.'},{status:404}));
   if(!['GET','HEAD'].includes(req.method))return send(Response.json({error:'Use GET for this file.'},{status:405,headers:{Allow:'GET, HEAD'}}));
   const bytes=await fs.readFile(new URL(file[0],root));
   res.writeHead(200,{...security,'Content-Type':file[1],'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){
   if(error.code==='ENOENT')return send(Response.json({error:'Build the dashboard with npm run build, then retry.'},{status:503}));
   console.error('Groundskeeper request failed');
   if(!res.headersSent)return send(Response.json({error:'The request could not be completed.'},{status:500}));
   res.end();
  }
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const port=Number(process.env.PORT||4180);
 createServer().listen(port,'127.0.0.1',()=>console.log(`Groundskeeper is running at http://127.0.0.1:${port}`));
}
