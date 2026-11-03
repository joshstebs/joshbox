/** Server-only bridge to the existing authenticated JoshBox Cloudflare D1 data service. */
export type SqlMethod = 'run'|'all'|'values'|'get';
export async function queryDataService(sql:string,params:unknown[],method:SqlMethod):Promise<{rows:unknown}>{
  const base=process.env.DATA_SERVICE_URL,token=process.env.DATA_SERVICE_TOKEN;
  if(!base||!token||token.length<32)throw new Error('JoshBox data service credentials are missing.');
  const url=new URL(base);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('JoshBox data service address is invalid.');
  const controller=AbortSignal.timeout(20000);
  const response=await fetch(new URL('/query',url),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params,method}),cache:'no-store',redirect:'error',signal:controller});
  if(!response.ok)throw new Error('JoshBox data service did not complete the query.');
  const result=await response.json() as {rows:unknown[][]};
  if(!Array.isArray(result.rows))throw new Error('The data service returned an invalid query result.');
  return {rows:method==='get'?result.rows[0]:result.rows};
}
