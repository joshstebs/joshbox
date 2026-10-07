import { owner,comfy,fail } from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(){try{await owner();const stats=await(await comfy('system_stats')).json() as {devices?:{name:string;vram_total:number;vram_free:number}[]};return Response.json({connected:true,devices:(stats.devices??[]).map(d=>({name:d.name,vramTotalGB:Math.round(d.vram_total/1024**3),vramFreeGB:Math.round(d.vram_free/1024**3)}))},{headers:{'Cache-Control':'no-store'}});}catch(e){return fail(e);}}
