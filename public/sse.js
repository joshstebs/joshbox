export async function consumeSSE(response,onEvent){
  if(!response.body)throw new Error('Missing progress stream.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  try{
    while(true){
      const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
      if(buffer.length>256000)throw new Error('Progress event exceeds the supported size. Refresh the existing job.');
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);let event='message';const lines=[];for(const line of packet.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))lines.push(line.slice(5).trimStart());}if(lines.length)await onEvent(event,JSON.parse(lines.join('\n')));}
      if(done)break;
    }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
