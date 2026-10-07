import { desc,eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { characters,jobs } from '@/db/schema';
import { owner,fail,bindings,visibleJob,videoConfig } from '@/lib/server';
import { videoControls } from '@/lib/engine.mts';
export const dynamic='force-dynamic';
export async function GET(){try{const id=await owner();const db=getDb();const c=bindings();const video=videoControls(videoConfig());const configured=!!(c.COMFY_URL&&c.COMFY_TOKEN);const [people,recent]=await Promise.all([db.select().from(characters).where(eq(characters.userId,id)).orderBy(desc(characters.createdAt)).limit(100),db.select().from(jobs).where(eq(jobs.userId,id)).orderBy(desc(jobs.createdAt)).limit(100)]);return Response.json({characters:people.map(({userId:_,...p})=>p),jobs:recent.map(visibleJob),connection:{configured,imageReady:configured&&!!(c.COMFY_IMAGE_WORKFLOW||c.COMFY_CHECKPOINT),videoReady:configured&&video.ready,video}},{headers:{'Cache-Control':'no-store'}});}catch(e){return fail(e);}}
