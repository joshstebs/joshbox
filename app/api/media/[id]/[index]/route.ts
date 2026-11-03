import {and,eq} from 'drizzle-orm';
import {getDb} from '@/db';
import {jobs} from '@/db/schema';
import {owner,fail,ApiError} from '@/lib/server';
import {readPrivate} from '@/lib/storage-vercel';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string;index:string}>}){
  try{
    const userId=await owner(),{id,index}=await params;
    if(!/^\d$/.test(index))throw new ApiError('Output not found.',404);
    const job=await getDb().select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.userId,userId))).get();
    const media=job?JSON.parse(job.media)[Number(index)]:null;
    if(!media?.key||typeof media.key!=='string'||!media.key.startsWith(userId+'/outputs/'+id+'/'))throw new ApiError('Output not found.',404);
    const object=await readPrivate(media.key,request.headers.get('range'));
    if(!object||object.status===404)throw new ApiError('Output not found.',404);
    if(object.status===416)return new Response(null,{status:416});
    const headers=new Headers(object.headers);
    headers.set('Cache-Control','private, no-store');
    headers.set('X-Content-Type-Options','nosniff');
    const ext=typeof media.filename==='string'?media.filename.split('.').pop()?.replace(/[^a-z0-9]/gi,''):'mp4';
    headers.set('Content-Disposition',`${new URL(request.url).searchParams.has('download')?'attachment':'inline'}; filename="joshbox-${id}.${ext||'mp4'}"`);
    return new Response(object.body,{status:object.status,headers});
  }catch(error){return fail(error);}
}
