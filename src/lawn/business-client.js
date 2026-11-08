export function createBusinessTransport({getToken,fetchImpl=fetch,onStatus=()=>{},onUnauthorized=()=>{},delay=650}){
 let version=0,timer=null,pending=null,active=null,stopped=false,conflict=false,lastSaved=null;
 const controller=new AbortController();
 const publish=(status,message='')=>onStatus({status,message,lastSaved});
 async function request(path,options={}){
  if(stopped)throw Error('This account session has ended.');
  const token=await getToken();if(!token){onUnauthorized();throw Error('Sign in again to continue.');}
  if(stopped)throw Error('This account session has ended.');
  const response=await fetchImpl(path,{...options,headers:{...options.headers,Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000),...(options.signal?[options.signal]:[])])});
  if(response.status===401){onUnauthorized();throw Object.assign(Error('Your session has expired. Sign in again.'),{status:401});}
  return response;
 }
 async function load(){
  const response=await request('/api/workspace');let result;try{result=await response.json();}catch{throw Error('Your workspace could not be loaded. Please retry.');}
  if(!response.ok)throw Error(result.error||'Your workspace could not be loaded.');
  version=result.workspace?.version||0;lastSaved=result.workspace?.updatedAt||null;publish('saved');return result.workspace;
 }
 async function flush(){
  clearTimeout(timer);timer=null;
  if(stopped)throw Error('This account session has ended.');
  if(conflict)throw Error('Another device saved changes. Download your current changes before reloading.');
  if(active)return active;
  active=(async()=>{
   while(pending&&!stopped){
    const snapshot=pending;pending=null;publish('saving');
    try{
     const response=await request('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'"'+version+'"'},body:snapshot});
     const result=await response.json();if(!response.ok){if(response.status===409)conflict=true;throw Object.assign(Error(result.error||'Your changes could not be saved.'),{status:response.status});}
     version=result.version;lastSaved=result.updatedAt;
    }catch(error){if(!stopped){pending=pending||snapshot;publish(conflict?'conflict':'error',error.name==='TimeoutError'?'Saving took too long. Your changes are still open; retry the save.':error.message);}throw error;}
   }
   if(!stopped)publish('saved');
  })();
  try{return await active;}finally{active=null;}
 }
 function save(payload){if(stopped)return false;pending=JSON.stringify(payload);publish(conflict?'conflict':'saving',conflict?'Another device has newer changes. Download this version before reloading.':'');if(!conflict){clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),delay);}return true;}
 function stop(){stopped=true;clearTimeout(timer);pending=null;controller.abort();}
 return {request,load,save,flush,stop,get dirty(){return !!(pending||active);},get version(){return version;}};
}
