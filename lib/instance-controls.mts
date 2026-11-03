// Fixed-target instance controls. Only server env may choose an account, VM, or instance ID.
export type ManagedProvider='gcp'|'vast';
export type InstanceAction='start'|'stop';

export function managedProvider(value:unknown):ManagedProvider{
  if(value==='gcp'||value==='vast')return value;
  throw new RangeError('Select Google Cloud or Vast.ai.');
}
export function instanceAction(value:unknown):InstanceAction{
  if(value==='start'||value==='stop')return value;
  throw new RangeError('Only start and stop are supported.');
}
export function gcpInstanceUrl(project:string,zone:string,name:string):string{
  if(!/^[a-z][a-z0-9-]{3,61}[a-z0-9]$/.test(project)||!/^[a-z]+-[a-z]+[0-9]-[a-z]$/.test(zone)||!/^[a-z]([-a-z0-9]*[a-z0-9])?$/.test(name))throw new RangeError('GCP instance configuration is invalid.');
  return 'https://compute.googleapis.com/compute/v1/projects/'+project+'/zones/'+zone+'/instances/'+name;
}
export function vastInstanceUrl(id:string):string{
  if(!/^[1-9][0-9]{0,15}$/.test(id))throw new RangeError('Vast instance ID is invalid.');
  return 'https://cloud.vast.ai/api/v0/instances/'+id+'/';
}
export function actionAllowed(provider:ManagedProvider,action:InstanceAction,status:string):boolean{
  const s=status.toLowerCase();
  return provider==='gcp'
    ? action==='start'?s==='terminated':s==='running'
    : action==='start'?s==='stopped':s==='running';
}
export function isActiveJobStatus(status:string):boolean{
  return ['submitting','queued','running','archiving','saving','uncertain'].includes(status);
}
