import {bindings,ApiError} from './server';
import {managedProvider,gcpInstanceUrl,vastInstanceUrl,actionAllowed,type ManagedProvider,type InstanceAction} from './instance-controls.mts';

type GpuStatus={provider:ManagedProvider;configured:boolean;name:string;status:string;hourlyUsd:number|null;message?:string};
const b64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replaceAll('+','-').replaceAll('/','_');
function gcpEnv(){
  const env=bindings();
  if(!env.GCP_INSTANCE_PROJECT||!env.GCP_INSTANCE_ZONE||!env.GCP_INSTANCE_NAME||!env.GCP_SERVICE_ACCOUNT_JSON)return null;
  return {project:env.GCP_INSTANCE_PROJECT,zone:env.GCP_INSTANCE_ZONE,name:env.GCP_INSTANCE_NAME,json:env.GCP_SERVICE_ACCOUNT_JSON};
}
function vastEnv(){
  const env=bindings();
  if(!env.VAST_API_KEY||!env.VAST_INSTANCE_ID)return null;
  return {key:env.VAST_API_KEY,id:env.VAST_INSTANCE_ID};
}
export function gpuConfigured(provider:ManagedProvider){return provider==='gcp'?!!gcpEnv():!!vastEnv();}
async function gcpToken(json:string):Promise<string>{
  let account:{client_email?:string;private_key?:string;type?:string};
  try{account=JSON.parse(json);}catch{throw new ApiError('Google Cloud service account secret is invalid.',503);}
  if(account.type!=='service_account'||!account.client_email||!account.private_key)throw new ApiError('Google Cloud needs a service account credential.',503);
  const now=Math.floor(Date.now()/1000),enc=new TextEncoder();
  const header=b64url(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload=b64url(enc.encode(JSON.stringify({iss:account.client_email,scope:'https://www.googleapis.com/auth/compute',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+900})));
  const raw=account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\s/g,'');
  let bytes:Uint8Array;
  try{bytes=Uint8Array.from(Array.from(atob(raw),ch=>ch.charCodeAt(0)));}catch{throw new ApiError('Google Cloud signing key is invalid.',503);}
  try{
    const key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(header+'.'+payload)));
    const assertion=header+'.'+payload+'.'+b64url(signature);
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Google Cloud OAuth refused the service account.');
    const result=await response.json() as {access_token?:string};
    if(!result.access_token)throw new Error('Google Cloud returned no access token.');
    return result.access_token;
  }catch{throw new ApiError('Google Cloud authorization failed. Check the service account permissions.',502);}
}
async function checkedJson(response:Response,provider:ManagedProvider):Promise<Record<string,unknown>>{
  if(!response.ok)throw new ApiError(provider==='vast'?'Vast.ai API rejected the request. Check the instance and API key.':'Google Cloud API rejected the request. Check VM state and IAM permissions.',502);
  try{return await response.json() as Record<string,unknown>;}catch{throw new ApiError('Provider returned an unreadable response.',502);}
}
async function gcpRequest(action?:InstanceAction):Promise<Record<string,unknown>>{
  const c=gcpEnv();if(!c)throw new ApiError('Google Cloud instance control is not configured.',503);
  let base:string;try{base=gcpInstanceUrl(c.project,c.zone,c.name);}catch{throw new ApiError('Google Cloud instance target is invalid.',503);}
  const token=await gcpToken(c.json);
  const response=await fetch(base+(action?'/'+action:''),{method:action?'POST':'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
  return checkedJson(response,'gcp');
}
async function vastRequest(action?:InstanceAction):Promise<Record<string,unknown>>{
  const c=vastEnv();if(!c)throw new ApiError('Vast.ai instance control is not configured.',503);
  let url:string;try{url=vastInstanceUrl(c.id);}catch{throw new ApiError('Vast.ai instance target is invalid.',503);}
  const response=await fetch(url,{method:action?'PUT':'GET',headers:{Authorization:'Bearer '+c.key,...(action?{'Content-Type':'application/json'}:{})},...(action?{body:JSON.stringify({state:action==='start'?'running':'stopped'})}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  const result=await checkedJson(response,'vast');
  if(action&&result.success===false)throw new ApiError('Vast.ai refused the operation. Check available capacity and your account.',409);
  return result;
}
export async function gpuStatus(provider:ManagedProvider):Promise<GpuStatus>{
  if(!gpuConfigured(provider))return {provider,configured:false,name:provider==='gcp'?'Google Cloud':'Vast.ai',status:'unconfigured',hourlyUsd:null};
  if(provider==='gcp'){
    const result=await gcpRequest();
    return {provider,configured:true,name:String(result.name||'Google Cloud VM'),status:String(result.status||'unknown'),hourlyUsd:null};
  }
  const response=await vastRequest();
  const data=response.instances??response.instance??response;
  const instance=Array.isArray(data)?data[0]:data as Record<string,unknown>;
  if(!instance||typeof instance!=='object')throw new ApiError('Vast.ai returned no instance details.',502);
  const rawRate=instance.dph_total;
  const rate=(typeof rawRate==='number'||(typeof rawRate==='string'&&rawRate.trim().length>0))?Number(rawRate):NaN;
  return {provider,configured:true,name:String(instance.label||'Vast.ai GPU'),status:String(instance.actual_status||instance.status||'unknown'),hourlyUsd:Number.isFinite(rate)&&rate>=0?rate:null};
}
export async function gpuChange(provider:ManagedProvider,action:InstanceAction){
  const status=await gpuStatus(provider);
  if(!status.configured)throw new ApiError('Instance controls are not configured.',503);
  if(!actionAllowed(provider,action,status.status))throw new ApiError('The instance is '+status.status+'. Refresh its status before trying this action.',409);
  if(provider==='gcp')await gcpRequest(action);
  else await vastRequest(action);
  return {provider,action,accepted:true,message:action==='start'?'Start requested. The GPU and JoshBox workflow may need time to initialize.':'Stop requested. Storage charges may continue.'};
}
