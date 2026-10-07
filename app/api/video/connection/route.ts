import {owner,fail} from '@/lib/server';
import {videoProxy} from '@/lib/video-proxy';
export const dynamic='force-dynamic';
export async function GET(){try{await owner();return Response.json(await(await videoProxy('api/capabilities')).json(),{headers:{'Cache-Control':'no-store'}});}catch(e){return fail(e);}}
