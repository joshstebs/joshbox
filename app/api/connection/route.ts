import { owner,fail } from '@/lib/server';
import { videoProxy,parseVideoProvider,configuredVideoProviders } from '@/lib/video-proxy';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{
    await owner();
    const provider=parseVideoProvider(new URL(request.url).searchParams.get('provider'));
    const providers=configuredVideoProviders();
    if(!providers[provider])return Response.json({connected:false,provider,providers,error:'This GPU profile needs its private HTTPS proxy URL and token.'},{headers:{'Cache-Control':'no-store'}});
    const upstream=await(await videoProxy('api/capabilities',{},false,provider)).json();
    return Response.json({...upstream,provider,providers},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return fail(e);}
}
