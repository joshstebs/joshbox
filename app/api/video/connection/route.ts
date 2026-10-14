import {owner,fail,ApiError} from '@/lib/server';
import {videoProxy} from '@/lib/video-proxy';
export const dynamic='force-dynamic';
export async function GET(){try{await owner();try{return Response.json(await(await videoProxy('api/capabilities')).json(),{headers:{'Cache-Control':'no-store'}});}catch(e){if(e instanceof ApiError)return Response.json({connected:false,proxy_connected:false,profiles:{},lifecycle:{state:'Offline',message:e.message},vast_automation:false},{headers:{'Cache-Control':'no-store'}});throw e;}}catch(e){return fail(e);}}
