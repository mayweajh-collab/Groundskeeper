import {createBusinessTransport} from '/assets/business-client.js';
import {emptyBusinessWorkspace,privateWorkspacePayload} from '/assets/business-seed.js';

export function createBusinessAccess(api){
 const {esc,icon}=api,legacyKey='groundskeeper-workspace-v2';
 let clerk=null,ownerId=null,transport=null,seed=null,onWorkspace=null,sessionGeneration=0,accountModal=null,saveState={status:'saved',message:''},unsubscribe=null;
 const authRoot=document.createElement('section');authRoot.id='business-access';authRoot.setAttribute('aria-label','Groundskeeper account access');document.body.prepend(authRoot);
 function today(){const parts=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),value=type=>parts.find(part=>part.type===type).value;return value('year')+'-'+value('month')+'-'+value('day');}
 const branding=`<a class="auth-brand" href="/">${icon('leaf')}groundskeeper<span>.</span></a>`;
 function frame(content){authRoot.innerHTML=`<div class="auth-layout"><aside class="auth-story">${branding}<div class="auth-story-copy"><span class="auth-eyebrow">ROOM TO GROW</span><h1>Your business.<br>Your workspace.</h1><p>A clearer plan for the work ahead.<br>Bring your people, projects, and costs together.</p><div class="auth-plan-card"><div><span class="auth-plan-icon">${icon('calendar')}</span><strong>A well-planned workday</strong><span class="auth-mini-pill">Ready</span></div><article><span class="auth-plan-line"></span><div><strong>Crews with a clear plan</strong><small>The right work, in the right order.</small></div>${icon('check')}</article><article><span class="auth-plan-line muted"></span><div><strong>Costs you can understand</strong><small>Know what each job needs to earn.</small></div>${icon('check')}</article><footer>${icon('users')}Built for growing landscaping businesses</footer></div></div><p class="auth-story-footer">A little less admin. A little more growing.</p></aside><main class="auth-main"><div class="auth-card">${content}</div><p class="auth-bottom-note">Your workspace belongs to your business.</p></main></div>`;}
 function login(message='',ready=!!clerk){
  document.body.dataset.accountState='locked';
  frame(`<span class="auth-eyebrow">GROUNDSKEEPER ACCOUNT</span><h2>Welcome back.</h2><p class="auth-intro">Sign in to manage your clients, crews, and the work ahead.</p>${message?`<div class="auth-notice" role="status">${esc(message)}</div>`:''}<button class="button primary auth-primary" data-business="sign-in" ${ready?'':'disabled'}>${icon('lock')}Sign in securely ${icon('arrow')}</button><div class="auth-divider"><span>New to Groundskeeper?</span></div><button class="button secondary auth-primary" data-business="sign-up" ${ready?'':'disabled'}>Create a business account</button><div class="auth-assurance">${icon('check')}<p>Secure sign-in, password recovery, and account settings in one place. Your business records stay in your own workspace.</p></div>${config?.developmentInstance?'<p class="auth-mode-note">Preview accounts · Production setup is required before adding real customer records.</p>':''}${!ready?'<button class="ops-link auth-retry" data-business="reload">Retry connection</button>':''}`);
 }
 function pending(message='Connecting to your account…'){document.body.dataset.accountState='loading';frame(`<span class="auth-eyebrow">YOUR BUSINESS WORKSPACE</span><h2>Getting things ready.</h2><p class="auth-intro" role="status">${esc(message)}</p><span class="auth-progress" aria-hidden="true"></span>`);}
 function locked(message='Your session has ended. Please sign in again.'){
  ++sessionGeneration;transport?.stop();transport=null;ownerId=null;
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());api.onLock();login(message);
 }
 function failed(message){document.body.dataset.accountState='locked';frame(`<span class="auth-eyebrow">ACCOUNT CONNECTION</span><h2>Let’s reconnect.</h2><p class="auth-intro">${esc(message)}</p><button class="button primary auth-primary" data-business="reload">Retry connection</button><button class="ops-link auth-retry" data-business="sign-out-force">Sign out</button>`);}
 async function script(){if(window.Clerk)return window.Clerk;await new Promise((resolve,reject)=>{const element=document.createElement('script');element.src='/vendor/clerk/clerk.browser.js';element.async=true;element.crossOrigin='anonymous';element.setAttribute('data-clerk-publishable-key',config.publishableKey);element.onload=resolve;element.onerror=()=>reject(Error('Secure sign-in could not connect. Please retry.'));document.head.append(element);});return window.Clerk;}
 let config=null;
 async function start(options){
  seed=options.seed;onWorkspace=options.onWorkspace;pending();
  try{
   const response=await fetch('/api/account/config',{cache:'no-store'});if(!response.ok)throw Error('The account service could not connect. Please retry.');config=await response.json();
   if(!config.configured){login('Secure accounts are being connected. Sign-in will be available once setup is complete.',false);return;}
   clerk=await script();await clerk.load({signInForceRedirectUrl:location.origin+'/#today',signUpForceRedirectUrl:location.origin+'/#today',afterSignOutUrl:location.origin+'/',telemetry:{disabled:true}});
   unsubscribe?.();unsubscribe=clerk.addListener(({user,session})=>{if(ownerId&&(!session||user?.id!==ownerId))locked('Your account session changed. Sign in to open the correct business workspace.');},{skipInitialEmit:true});
   if(!clerk.user||!clerk.session){login();return;}
   await openAccount();
  }catch(error){failed(error.message);}
 }
 async function openAccount(){
  pending('Loading your private business workspace…');ownerId=clerk.user.id;const generation=++sessionGeneration,pinnedOwner=ownerId;
  transport=createBusinessTransport({getToken:async()=>{if(clerk.user?.id!==pinnedOwner||!clerk.session)return null;const token=await clerk.session.getToken();return clerk.user?.id===pinnedOwner?token:null;},onStatus:updateSaveState,onUnauthorized:()=>locked()});
  const saved=await transport.load();if(generation!==sessionGeneration)return;
  if(saved)await activate(saved);else onboarding();
 }
 function legacyExists(){try{return !!localStorage.getItem(legacyKey);}catch{return false;}}
 function onboarding(){
  document.body.dataset.accountState='onboarding';frame(`<span class="auth-eyebrow">WELCOME${clerk.user.firstName?', '+esc(clerk.user.firstName).toUpperCase():''}</span><h2>Make room for your business.</h2><p class="auth-intro">Give your workspace a name, then start with your customers or explore a sample workday.</p><form id="business-onboarding-form"><label class="field-label" for="business-name">Business name</label><input id="business-name" required maxlength="120" autocomplete="organization" placeholder="Your landscaping business"><div class="auth-start-options"><label><input type="radio" name="business-start" value="empty" checked><span><strong>Start fresh</strong><small>A clean workspace for your customers and crews.</small></span></label><label><input type="radio" name="business-start" value="sample"><span><strong>Explore sample work</strong><small>Fictional customers, projects, and costs.</small></span></label>${legacyExists()?'<label><input type="radio" name="business-start" value="browser"><span><strong>Import this browser’s previous workspace</strong><small>Choose this only if the existing records belong to your business. The original browser copy is retained.</small></span></label>':''}</div><p id="business-onboarding-error" class="form-error" role="alert"></p><button class="button primary auth-primary" type="submit">Create my workspace ${icon('arrow')}</button></form><button class="ops-link auth-retry" data-business="sign-out-force">Sign out</button>`);
 }
 async function activate(saved){
  await onWorkspace(saved);document.body.dataset.accountState='ready';authRoot.innerHTML='';paintIdentity();paintSaveState();
 }
 function paintIdentity(){
  if(!ownerId||!clerk?.user)return;
  const data=api.getData(),user=clerk.user,name=user.fullName||user.primaryEmailAddress?.emailAddress||'Business owner',initials=name.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase();
  const company=document.querySelector('.company strong');if(company)company.textContent=data?.company||'Your business';
  const owner=document.querySelector('.owner-profile strong');if(owner)owner.textContent=name;
  const role=document.querySelector('.owner-profile small');if(role)role.textContent='Business owner';
  document.querySelectorAll('.owner-profile .avatar,.topbar .avatar').forEach(element=>element.textContent=initials);
  const pill=document.querySelector('.demo-pill');if(pill)pill.innerHTML=icon('lock')+(config?.developmentInstance?'Preview · Private workspace':data?.synthetic?'Private sample workspace':'Private business workspace');
  document.querySelector('.footer span:last-child').textContent=data?.landscape?.sample?'Sample project ledger · USD · Before tax':'Private business records · USD';
 }
 function updateSaveState(value){saveState=value;paintSaveState();}
 function paintSaveState(){
  const footer=document.getElementById('ops-persistence');if(!footer)return;
  const text=saveState.status==='saved'?'Saved to your business account':saveState.status==='saving'?'Saving to your account…':saveState.status==='conflict'?'Another device has changes · Open Account to review':'Changes not saved · Open Account to retry';footer.textContent=text;footer.dataset.saveStatus=saveState.status;
  const status=document.getElementById('business-save-message');if(status)status.textContent=saveState.message||text;
 }
 function queueSave(){if(!transport||!ownerId)return false;return transport.save(privateWorkspacePayload(api.getData(),api.getState()));}
 async function authenticatedFetch(path,options){if(!transport)throw Error('Sign in to continue.');return transport.request(path,options);}
 function backup(){if(!api.getData())return;api.download(JSON.stringify({format:'groundskeeper-workspace',exportedAt:new Date().toISOString(),...privateWorkspacePayload(api.getData(),api.getState())},null,2),'groundskeeper-private-backup-'+today()+'.json');api.toast('Private backup downloaded. Store it somewhere safe.');}
 function account(){
  if(!ownerId)return;
  if(!accountModal){accountModal=document.createElement('dialog');accountModal.id='business-account-dialog';accountModal.className='modal ops-modal';document.body.append(accountModal);}
  accountModal.setAttribute('aria-labelledby','business-account-title');accountModal.innerHTML=`<div class="dialog-top"><div><p class="eyebrow">YOUR GROUNDSKEEPER ACCOUNT</p><h2 id="business-account-title">Business account</h2></div><button class="ops-icon-button" type="button" data-business="close-account" aria-label="Close business account">${icon('close')}</button></div><p class="dialog-copy">${esc(clerk.user.primaryEmailAddress?.emailAddress||'Signed-in business owner')}<br>Your account has its own private saved workspace.</p><form id="business-name-form"><label class="field-label" for="business-company-name">Business name</label><input id="business-company-name" required maxlength="120" value="${esc(api.getData().company)}"><button type="submit" class="button secondary">Save business name</button></form><div class="business-save-box"><strong>Workspace saving</strong><p id="business-save-message" role="status"></p><div class="action-group"><button class="button secondary" data-business="retry-save">Retry save</button><button class="button secondary" data-business="backup">Download backup</button><button class="ops-link" data-business="reload">Reload saved version</button></div></div><button class="button secondary auth-primary" data-business="profile">Manage sign-in & security ${icon('arrow')}</button><p class="field-hint">Manage your profile, password, and available security methods through secure account settings.</p><p id="business-account-error" class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" data-business="close-account">Close</button><button class="button primary" data-business="sign-out">Sign out</button></div><button class="ops-link business-force-signout" data-business="sign-out-force" hidden>Sign out without saving these changes</button>`;paintSaveState();accountModal.showModal();
 }
 async function signOut(force=false){
  try{if(!force&&transport)await transport.flush();transport?.stop();++sessionGeneration;ownerId=null;api.onLock();document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());pending('Signing out…');await clerk?.signOut({redirectUrl:location.origin+'/'});location.replace('/');}
  catch{const error=document.getElementById('business-account-error');if(error){error.textContent='Your latest changes could not be saved. Retry saving or download a backup before signing out.';document.querySelector('.business-force-signout').hidden=false;}else failed('Sign-out did not finish. Retry the connection to continue.');}
 }
 document.addEventListener('click',async event=>{
  const element=event.target.closest('[data-business]');if(!element)return;const action=element.dataset.business;
  try{
   if(action==='sign-in')await clerk?.redirectToSignIn({signInForceRedirectUrl:location.origin+'/#today',signUpForceRedirectUrl:location.origin+'/#today'});
   else if(action==='sign-up')await clerk?.redirectToSignUp({signInForceRedirectUrl:location.origin+'/#today',signUpForceRedirectUrl:location.origin+'/#today'});
   else if(action==='account')account();
   else if(action==='close-account')accountModal?.close();
   else if(action==='profile'){await transport.flush();await clerk.redirectToUserProfile();}
   else if(action==='sign-out'||action==='sign-out-force')await signOut(action==='sign-out-force');
   else if(action==='reload'){if(transport?.dirty){backup();}location.reload();}
   else if(action==='retry-save'){await transport.flush();api.toast('Your latest changes are saved to your account.');}
   else if(action==='backup')backup();
   else if(action==='new-job')document.getElementById('manual-open').click();
  }catch(error){api.toast(error.message);}
 });
 document.addEventListener('submit',async event=>{
  if(event.target.id==='business-onboarding-form'){
   event.preventDefault();const button=event.target.querySelector('button[type=submit]');button.disabled=true;
   try{
    const name=document.getElementById('business-name').value.trim();if(!name||/[<>]/.test(name))throw Error('Enter your business name using plain text.');
    const mode=event.target.elements['business-start'].value;let initial;
    if(mode==='browser'){let stored;try{stored=JSON.parse(localStorage.getItem(legacyKey));}catch{}if(!stored?.data?.jobs)throw Error('The previous browser workspace could not be read. Start fresh and import its spreadsheet instead.');initial={data:structuredClone(stored.data),state:{...stored.state}};initial.data.company=name;}
    else initial={data:mode==='sample'?{...structuredClone(seed),company:name}:emptyBusinessWorkspace(seed,name,today()),state:{viewDate:mode==='sample'?seed.date:today()}};
    await onWorkspace(initial);transport.save(privateWorkspacePayload(api.getData(),api.getState()));await transport.flush();await activate(initial);api.toast('Your private business workspace is ready.');
   }catch(error){document.getElementById('business-onboarding-error').textContent=error.message;}finally{button.disabled=false;}
  }
  if(event.target.id==='business-name-form'){event.preventDefault();const name=document.getElementById('business-company-name').value.trim();if(!name||/[<>]/.test(name)){document.getElementById('business-account-error').textContent='Enter your business name using plain text.';return;}api.getData().company=name;queueSave();paintIdentity();api.toast('Business name updated.');}
 });
 window.addEventListener('beforeunload',event=>{if(transport?.dirty){event.preventDefault();event.returnValue='';}});
 return {start,queueSave,authenticatedFetch,paintIdentity,paintSaveState,get status(){return saveState.status;},get signedIn(){return !!ownerId;}};
}
