import { z } from 'zod';
import { getDb } from '@/db';
import { characters } from '@/db/schema';
import { owner,json,fail } from '@/lib/server';
const schema=z.object({name:z.string().trim().min(1).max(80),description:z.string().trim().min(10).max(1500),adultOnly:z.literal(true)});
export async function POST(request:Request){try{const userId=await owner(request);const input=schema.parse(await json(request));const row={id:crypto.randomUUID(),userId,name:input.name,description:input.description,createdAt:Date.now()};await getDb().insert(characters).values(row);return Response.json({id:row.id,name:row.name,description:row.description,createdAt:row.createdAt},{status:201});}catch(e){return fail(e);}}
