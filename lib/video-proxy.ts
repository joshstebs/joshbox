import {endpoint} from './engine.mts';
import {bindings,ApiError} from './server';

export const videoProviders=['default','gcp','vast'] as const;
export type VideoProvider=(typeof videoProviders)[number];

export function parseVideoProvider(value:unknown):VideoProvider{
  if(value===undefined||value===null||value==='')return 'default';
  if(value==='default'||value==='gcp'||value==='vast')return value;
  throw new ApiError('Choose a supported GPU provider.',400);
}

export function videoJobRemoteId(provider:VideoProvider,id:string){
  return provider==='default'?'proxy:'+id:'proxy:'+provider+':'+id;
}

export function videoJobProvider(remoteId:string|null,id:string):VideoProvider|null{
  for(const provider of videoProviders)if(remoteId===videoJobRemoteId(provider,id))return provider;
  return null;
}

function providerConfig(provider:VideoProvider){
  const c=bindings();
  if(provider==='gcp')return {url:c.VIDEO_PROXY_GCP_URL,token:c.VIDEO_PROXY_GCP_TOKEN};
  if(provider==='vast')return {url:c.VIDEO_PROXY_VAST_URL,token:c.VIDEO_PROXY_VAST_TOKEN};
  return {url:c.VIDEO_PROXY_URL,token:c.VIDEO_PROXY_TOKEN};
}

export function configuredVideoProviders():Record<VideoProvider,boolean>{
  return Object.fromEntries(videoProviders.map(provider=>{
    const config=providerConfig(provider);
    return [provider,!!(config.url&&config.token)];
  })) as Record<VideoProvider,boolean>;
}

// Provider IDs are fixed. Browser input cannot specify an arbitrary upstream URL.
export async function videoProxy(path:string,init:RequestInit={},stream=false,provider:VideoProvider='default'){
  const c=providerConfig(provider);
  if(!c.url||!c.token)throw new ApiError('This GPU profile is not connected. Configure its private HTTPS endpoint and token.',503);
  let url:URL;try{url=endpoint(c.url,path);}catch{throw new ApiError('Configure a trusted HTTPS video proxy address.',503);}
  const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+c.token);
  let response:Response;try{response=await fetch(url,{...init,headers,redirect:'error'});}catch{throw new ApiError('The video proxy did not respond. Check the instance status and connection.',502);}
  if(!response.ok)throw new ApiError(response.status===401?'The video proxy rejected its access token.':response.status===409?'A generation already exists. Refresh its status.':response.status===503?'The video workflow is not configured on the proxy.':response.status===422?'The workflow does not support these settings. Check its verified input mapping.':'The video proxy returned an error.',response.status===409?409:502,response.status);
  return response;
}
