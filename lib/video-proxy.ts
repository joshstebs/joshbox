import {endpoint} from './engine.mts';
import {bindings,ApiError} from './server';
export async function videoProxy(path:string,init:RequestInit={},stream=false){
  const c=bindings();if(!c.VIDEO_PROXY_URL||!c.VIDEO_PROXY_TOKEN)throw new ApiError('The video proxy is not connected yet. Your existing GPU setup has not been changed.',503);
  let url:URL;try{url=endpoint(c.VIDEO_PROXY_URL,path);}catch{throw new ApiError('Configure a trusted HTTPS video proxy address.',503);}
  const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+c.VIDEO_PROXY_TOKEN);
  let response:Response;try{response=await fetch(url,{...init,headers,redirect:'error',signal:AbortSignal.timeout(stream?30*60*1000:20000)});}catch{throw new ApiError('The video proxy did not respond. Check the instance status and connection.',502);}
  if(!response.ok)throw new ApiError(response.status===401?'The video proxy rejected its access token.':response.status===409?'A generation already exists. Refresh its status.':response.status===503?'The video workflow is not configured on the proxy.':response.status===422?'The workflow does not support these settings. Check its verified input mapping.':'The video proxy returned an error.',response.status===409?409:502,response.status);
  return response;
}
