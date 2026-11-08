import {createClerkClient} from '@clerk/backend';
import {neon} from '@neondatabase/serverless';
import {createGroundskeeperApi} from './lawn-hosted-api.js';
import {createPostgresWorkspaceStore,validateBusinessWorkspace} from './business-workspaces.js';

const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization, Origin',...extra}});
const fail=(message,statusCode)=>Object.assign(Error(message),{statusCode});
const MAX_WORKSPACE_BYTES=3500000;
export function businessAccountConfig(env=process.env){
 const publishableKey=env.CLERK_PUBLISHABLE_KEY||env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||'',secretKey=env.CLERK_SECRET_KEY||'',databaseUrl=env.DATABASE_URL||'';
 const origins=new Set([env.GROUNDSKEEPER_APP_URL||'https://groundskeeper-nine.vercel.app']);
 if(env.VERCEL_URL)origins.add('https://'+env.VERCEL_URL);
 if(env.VERCEL_PROJECT_PRODUCTION_URL)origins.add('https://'+env.VERCEL_PROJECT_PRODUCTION_URL);
 if(env.VERCEL!=='1')for(const port of [4180,4182,4183,4184])for(const host of ['127.0.0.1','localhost'])origins.add('http://'+host+':'+port);
 return {publishableKey,secretKey,databaseUrl,origins:[...origins].map(value=>new URL(value).origin),ready:!!(publishableKey&&secretKey&&databaseUrl),developmentInstance:publishableKey.startsWith('pk_test_')};
}
async function readWorkspace(request){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw fail('Send workspace data as JSON.',415);
 if(Number(request.headers.get('content-length'))>MAX_WORKSPACE_BYTES)throw fail('The workspace is too large to save. Download a backup and reduce older route details.',413);
 if(!request.body)throw fail('Workspace data is required.',400);
 const reader=request.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_WORKSPACE_BYTES){await reader.cancel();throw fail('The workspace is too large to save.',413);}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('The workspace is not valid JSON.',400);}
 return validateBusinessWorkspace(body);
}
export function createAccountApi({config=businessAccountConfig(),verifyAccount,store,geocodeAddress,reportFailure=status=>console.error('Groundskeeper account request failed',{status})}={}){
 let clerk;
 const legacy=createGroundskeeperApi({geocodeAddress,reportFailure});
 const workspaceStore=store||(config.databaseUrl?createPostgresWorkspaceStore(neon(config.databaseUrl)):null);
 const authenticate=verifyAccount||(async request=>{
  clerk??=createClerkClient({publishableKey:config.publishableKey,secretKey:config.secretKey});
  const result=await clerk.authenticateRequest(request,{authorizedParties:config.origins,acceptsToken:'session_token'});
  const auth=result.toAuth();if(!result.isAuthenticated||!auth?.userId||!auth.sessionId)return null;
  let session;try{session=await clerk.sessions.getSession(auth.sessionId);}catch(error){if(error.status===404)return null;throw fail('Account verification is temporarily unavailable. Please retry.',503);}
  return session.status==='active'&&session.userId===auth.userId?{id:auth.userId}:null;
 });
 return async request=>{
  const url=new URL(request.url),path=url.pathname.replace(/\/$/,'');
  if(path==='/api/health'){
   if(!['GET','HEAD'].includes(request.method))return json({error:'Use GET.'},405,{Allow:'GET, HEAD'});
   const response=json({ok:true,app:'Groundskeeper',mode:'business-accounts',storage:'private-postgres',accountsReady:config.ready});return request.method==='HEAD'?new Response(null,{headers:response.headers}):response;
  }
  if(path==='/api/account/config'){
   if(request.method!=='GET')return json({error:'Use GET.'},405,{Allow:'GET'});
   return json({configured:config.ready,publishableKey:config.ready?config.publishableKey:null,developmentInstance:config.developmentInstance});
  }
  if(!['/api/workspace','/api/account','/api/lawn/geocode'].includes(path))return json({error:'Endpoint not found.'},404);
  const allowed=path==='/api/workspace'?['GET','PUT']:path==='/api/account'?['GET']:['POST'];
  if(!allowed.includes(request.method))return json({error:'Use '+allowed.join(' or ')+'.'},405,{Allow:allowed.join(', ')});
  const origin=request.headers.get('origin');if((origin&&origin!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Use your Groundskeeper workspace to make this request.'},403);
  if(!config.ready)return json({error:'Secure account setup is not finished yet. Please try again shortly.',code:'SETUP_REQUIRED'},503);
  if(!/^Bearer [A-Za-z0-9._~-]+$/.test(request.headers.get('authorization')||''))return json({error:'Sign in to access your business workspace.',code:'SIGN_IN_REQUIRED'},401);
  let account;try{account=await authenticate(request);}catch(error){if(error.statusCode===503)return json({error:'Account verification is temporarily unavailable. Please retry.'},503);account=null;}
  if(!account?.id||typeof account.id!=='string')return json({error:'Your session has expired. Sign in again.',code:'SIGN_IN_REQUIRED'},401);
  try{
   if(path==='/api/account')return json({account:{id:account.id}});
   if(path==='/api/lawn/geocode')return legacy(request);
   if(request.method==='GET')return json({workspace:await workspaceStore.get(account.id)});
   const match=request.headers.get('if-match');if(!/^"(0|[1-9]\d{0,8})"$/.test(match||''))return json({error:'Reload the latest workspace before saving.',code:'VERSION_REQUIRED'},428);
   const payload=await readWorkspace(request),saved=await workspaceStore.save(account.id,payload,Number(match.slice(1,-1)));
   if(!saved)return json({error:'This workspace changed in another tab or device. Download your current changes, then reload the latest saved version.',code:'WORKSPACE_CONFLICT'},409);
   return json({saved:true,...saved},200,{ETag:'"'+saved.version+'"'});
  }catch(error){const status=[400,413,415].includes(error.statusCode)?error.statusCode:500;if(status===500)reportFailure(status);return json({error:status===500?'Your workspace could not be saved or loaded. Please retry.':error.message},status);}
 };
}
