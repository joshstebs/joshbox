import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeSSE} from '../public/sse.js';
test('POST SSE parser handles fragmented UTF-8, heartbeats and CRLF events',async()=>{
  const text=': heartbeat\r\n\r\nevent: progress\r\ndata: {"node":"Sampler ✦","step":2,"total":8}\r\n\r\nevent: completed\ndata: {"status":"complete"}\n\n';
  const bytes=new TextEncoder().encode(text);const chunks=Array.from(bytes,b=>Uint8Array.of(b));
  const stream=new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}});const events=[];
  await consumeSSE(new Response(stream),(event,data)=>events.push({event,data}));
  assert.deepEqual(events,[{event:'progress',data:{node:'Sampler ✦',step:2,total:8}},{event:'completed',data:{status:'complete'}}]);
});
test('SSE error handlers stop the stream instead of claiming a completed render',async()=>{
  const response=new Response('event: error\ndata: {"message":"Failed"}\n\n');
  await assert.rejects(()=>consumeSSE(response,()=>{throw new Error('Failed');}),/Failed/);
});
