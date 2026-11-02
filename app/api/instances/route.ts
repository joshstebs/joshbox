import {eq} from 'drizzle-orm';
import {getDb} from '@/db';
import {jobs} from '@/db/schema';
import {owner,fail,json,ApiError} from '@/lib/server';
import {managedProvider,instanceAction,isActiveJobStatus} from '@/lib/instance-controls.mts';
import {gpuStatus,gpuChange} from '@/lib/cloud-gpu';

export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{
    await owner();
    const provider=managedProvider(new URL(request.url).searchParams.get('provider'));
    return Response.json(await gpuStatus(provider),{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return fail(error);}
}
export async function POST(request:Request){
  try{
    const user=await owner(request);
    const body=await json(request) as Record<string,unknown>;
    const provider=managedProvider(body.provider),action=instanceAction(body.action);
    if(body.confirm!==provider+':'+action)throw new ApiError('Confirm the selected provider and action before continuing.',400);
    // No force-stop endpoint. Keep GPU running when unfinished jobs may need saving.
    if(action==='stop'){
      const existing=await getDb().select({status:jobs.status}).from(jobs).where(eq(jobs.userId,user)).limit(100);
      if(existing.some(job=>isActiveJobStatus(job.status)))throw new ApiError('JoshBox has an unfinished video. Wait for it to finish and save before stopping the GPU.',409);
    }
    return Response.json(await gpuChange(provider,action),{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return fail(error);}
}
