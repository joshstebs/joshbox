export const videoProviders=['default','gcp','vast'] as const;
export type VideoProvider=(typeof videoProviders)[number];

export function parseVideoProviderValue(value:unknown):VideoProvider{
  if(value===undefined||value===null||value==='')return 'default';
  if(value==='default'||value==='gcp'||value==='vast')return value;
  throw new RangeError('Unsupported GPU provider.');
}

export function videoJobRemoteId(provider:VideoProvider,id:string){
  return provider==='default'?'proxy:'+id:'proxy:'+provider+':'+id;
}

export function videoJobProvider(remoteId:string|null,id:string):VideoProvider|null{
  for(const provider of videoProviders)if(remoteId===videoJobRemoteId(provider,id))return provider;
  return null;
}
