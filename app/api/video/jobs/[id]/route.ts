import {and,eq,or,lt} from 'drizzle-orm';
import {getDb} from '@/db';
import {jobs} from '@/db/schema';
import {owner,bindings,fail,ApiError,visibleJob} from '@/lib/server';
import {videoProxy} from '@/lib/video-proxy';
export const dynamic='force-dynamic';
type Remote={status:string;node?:string;step?:number;total?:number;message?:string;logs?:{time:number;message:string}[];media?:{kind:string;filename:string;index:number}[]};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{
  const userId=await owner(),{id}=await params,db=getDb(),scope=and(eq(jobs.id,id),eq(jobs.userId,userId));let job=await db.select().from(jobs).where(scope).get();if(!job||job.remoteId!=='proxy:'+id)throw new ApiError('Video job not found.',404);
  if(['complete','failed'].includes(job.status))return Response.json(visibleJob(job),{headers:{'Cache-Control':'no-store'}});
  const remote=await(await videoProxy('api/jobs/'+encodeURIComponent(id)+'?'+new URLSearchParams({owner_id:userId}))).json() as Remote;
  if(remote.status==='complete'){
    const claim=await db.update(jobs).set({status:'archiving',updatedAt:Date.now()}).where(and(scope,or(eq(jobs.status,'submitting'),eq(jobs.status,'queued'),eq(jobs.status,'running'),eq(jobs.status,'uncertain'),and(eq(jobs.status,'archiving'),lt(jobs.updatedAt,Date.now()-180000))))).returning().get();
    if(!claim)return Response.json({...visibleJob(job),status:'archiving'});
    try{const media=[];for(const m of (remote.media??[]).slice(0,8)){if(m.kind!=='video'||!Number.isInteger(m.index)||m.index<0||m.index>7||!m.filename.endsWith('.mp4'))continue;const response=await videoProxy('api/media/'+id+'/'+m.index+'?'+new URLSearchParams({owner_id:userId}),{},true);const length=Number(response.headers.get('content-length'));if(!response.body||!Number.isInteger(length)||length<12||length>512*1024**2)throw new ApiError('Video archive size is unsupported.',502);const key=userId+'/outputs/'+id+'/'+m.index+'.mp4';const stream=new FixedLengthStream(length);await Promise.all([response.body.pipeTo(stream.writable),bindings().BUCKET.put(key,stream.readable,{httpMetadata:{contentType:'video/mp4'}})]);media.push({...m,key});}if(!media.length)throw new Error('Missing video');job={...job,status:'complete',media:JSON.stringify(media),message:null};await db.update(jobs).set({status:'complete',media:job.media,message:null,updatedAt:Date.now()}).where(scope);}
    catch{await db.update(jobs).set({status:'running',message:'Your video is ready on the GPU but could not be copied to the private gallery. Keep it running and refresh to retry saving.',updatedAt:Date.now()}).where(scope);throw new ApiError('Saving the video failed. Keep the GPU running and refresh to retry.',502);}
  }else{const status=remote.status==='failed'?'failed':remote.status==='uncertain'?'uncertain':remote.status==='submitting'?'submitting':remote.status==='queued'?'queued':'running';job={...job,status,message:remote.message??null};await db.update(jobs).set({status,message:job.message,updatedAt:Date.now()}).where(scope);}
  return Response.json({...visibleJob(job),node:remote.node,step:remote.step,total:remote.total,logs:remote.logs},{headers:{'Cache-Control':'no-store'}});
}catch(e){return fail(e);}}
