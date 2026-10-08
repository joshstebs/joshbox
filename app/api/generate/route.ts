import {z} from 'zod';
import {and,eq} from 'drizzle-orm';
import {getDb} from '@/db';
import {jobs} from '@/db/schema';
import {owner,bindings,fail,ApiError} from '@/lib/server';
import {videoProxy} from '@/lib/video-proxy';
const schema=z.object({request_id:z.string().uuid(),model:z.enum(['minimax_h3','wan22_14b','wan22_5b','ltx23','hunyuan15']).default('wan22_14b'),prompt:z.string().trim().min(8).max(3000),negative:z.string().max(1500).default(''),mode:z.enum(['quality','fast']),width:z.number().int().min(256).max(2048),height:z.number().int().min(256).max(2048),frames:z.number().int().min(5).max(362),fps:z.number().int().min(1).max(60),steps:z.number().int().min(1).max(100),motion_bucket:z.number().int().min(0).max(255),motion_scale:z.number().min(0).max(10),seed:z.number().int().min(0).max(2147483647),extend_job_id:z.string().uuid().optional(),extend_index:z.number().int().min(0).max(7).optional()});
export async function POST(request:Request){try{
  const userId=await owner(request);const c=bindings();if(!c.VIDEO_PROXY_URL||!c.VIDEO_PROXY_TOKEN)throw new ApiError('Connect the video proxy before generating. No GPU job was submitted.',503);
  if(Number(request.headers.get('content-length'))>14*1024**2)throw new ApiError('Choose an image smaller than 12 MB.',413);
  const form=await request.formData();const raw=form.get('settings');if(typeof raw!=='string'||raw.length>16000)throw new ApiError('Check the generation settings.');
  const input=schema.parse(JSON.parse(raw));const image=form.get('image');if(!(image instanceof File)||image.size>12*1024**2||image.size<12)throw new ApiError('Choose a PNG, JPG, or WebP image smaller than 12 MB.',413);
  const db=getDb(),scope=and(eq(jobs.id,input.request_id),eq(jobs.userId,userId));
  if(input.extend_job_id){const parent=await db.select().from(jobs).where(and(eq(jobs.id,input.extend_job_id),eq(jobs.userId,userId))).get();if(parent?.status!=='complete'||JSON.parse(parent.media)[input.extend_index??0]?.kind!=='video')throw new ApiError('Choose a saved video from your own gallery.',404);}
  const prior=await db.select().from(jobs).where(scope).get();if(prior&&prior.remoteId!=='proxy:'+input.request_id)throw new ApiError('This request ID belongs to another job.',409);
  if(prior?.status==='complete')return new Response('event: completed\ndata: '+JSON.stringify({id:prior.id,status:'complete',message:'Already saved in your gallery.'})+'\n\n',{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store'}});
  if(prior?.status==='failed')throw new ApiError('This request already failed. Review the settings and use a new request ID.',409);
  if(!prior){try{await db.insert(jobs).values({id:input.request_id,userId,kind:'video',prompt:input.prompt,negative:input.negative,mode:input.mode,aspect:input.width>input.height?'landscape':input.width<input.height?'portrait':'square',seed:input.seed,duration:null,parentJobId:input.extend_job_id??null,remoteId:'proxy:'+input.request_id,status:'submitting',media:'[]',createdAt:Date.now(),updatedAt:Date.now()});}catch{throw new ApiError('An active generation already exists. Check its status before starting another.',409);}}
  const body=new FormData();body.set('settings',JSON.stringify({...input,owner_id:userId}));body.set('image',image);
  try{const response=await videoProxy('api/generate',{method:'POST',body},true);if(!response.headers.get('content-type')?.includes('text/event-stream'))throw new ApiError('The video proxy did not return a progress stream.',502);if(prior?.status!=='archiving')await db.update(jobs).set({status:'queued',updatedAt:Date.now()}).where(scope);return new Response(response.body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-store','X-Accel-Buffering':'no'}});}
  catch(e){const rejected=e instanceof ApiError&&[400,401,403,404,409,422,503].includes(e.upstreamStatus??0);await db.update(jobs).set({status:rejected?'failed':'uncertain',message:rejected?'The proxy rejected this request. Check connection and workflow settings.':'Submission is unconfirmed. Refresh the existing job before retrying.',updatedAt:Date.now()}).where(scope);throw e;}
}catch(e){return fail(e);}}
