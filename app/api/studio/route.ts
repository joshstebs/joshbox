import { desc,eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { characters,jobs } from '@/db/schema';
import { owner,fail,visibleJob } from '@/lib/server';
import { videoProxy } from '@/lib/video-proxy';
export const dynamic='force-dynamic';
export async function GET(){try{const id=await owner();const db=getDb();const [people,recent,capabilities]=await Promise.all([db.select().from(characters).where(eq(characters.userId,id)).orderBy(desc(characters.createdAt)).limit(100),db.select().from(jobs).where(eq(jobs.userId,id)).orderBy(desc(jobs.createdAt)).limit(100),videoProxy('api/capabilities').then(response=>response.json() as Promise<{connected?:boolean;profiles?:Record<string,Record<string,{ready?:boolean}>>}>).catch(()=>null)]);const connected=capabilities?.connected===true;const quality=!!capabilities?.profiles?.wan22_5b?.quality?.ready;const fast=!!capabilities?.profiles?.wan22_5b?.fast?.ready;const video={ready:quality||fast,duration:false,aspect:true,fast,quality,h3:false};return Response.json({characters:people.map(({userId:_,...p})=>p),jobs:recent.map(visibleJob),connection:{configured:connected,imageReady:false,videoReady:connected&&video.ready,video}},{headers:{'Cache-Control':'no-store'}});}catch(e){return fail(e);}}
