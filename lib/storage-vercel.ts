/** Private Vercel Blob storage; every read must be guarded by an owner-scoped job lookup. */
import {get,put} from '@vercel/blob';
import 'server-only';

type Payload=Uint8Array|ArrayBuffer|ReadableStream<Uint8Array>;
export async function storePrivate(key:string,body:Payload,contentType:string){
  if(!process.env.BLOB_READ_WRITE_TOKEN)throw new Error('Private media storage is not configured.');
  if(!/^[a-z0-9:_-]+\/(?:inputs|outputs)\/[a-z0-9-_/.]+$/i.test(key)||key.includes('..'))throw new Error('Invalid media storage key.');
  const input=body instanceof Uint8Array?Buffer.from(body):body;
  await put(key,input,{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType,multipart:true});
}
export async function readPrivate(key:string,range:string|null=null):Promise<Response|null>{
  if(!process.env.BLOB_READ_WRITE_TOKEN)throw new Error('Private media storage is not configured.');
  if(!/^[a-z0-9:_-]+\/(?:inputs|outputs)\/[a-z0-9-_/.]+$/i.test(key)||key.includes('..'))return null;
  if(range&&!/^bytes=\d*-\d*$/.test(range))return new Response(null,{status:416});
  const result=await get(key,{access:'private',useCache:false,headers:range?{Range:range}:undefined});
  if(!result)return null;
  if(result.statusCode!==200)return new Response(null,{status:result.statusCode});
  const headers=new Headers({'Content-Type':result.blob.contentType,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'});
  const contentRange=result.headers?.get('content-range');
  if(contentRange)headers.set('Content-Range',contentRange);
  const contentLength=result.headers?.get('content-length');
  if(contentLength)headers.set('Content-Length',contentLength);
  return new Response(result.stream,{status:contentRange?206:200,headers});
}
