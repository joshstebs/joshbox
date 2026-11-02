import test from 'node:test';
import assert from 'node:assert/strict';
import {managedProvider,instanceAction,gcpInstanceUrl,vastInstanceUrl,actionAllowed,isActiveJobStatus} from '../lib/instance-controls.mts';

test('only preconfigured provider types and start/stop actions are accepted',()=>{
  assert.equal(managedProvider('gcp'),'gcp');
  assert.equal(managedProvider('vast'),'vast');
  assert.equal(instanceAction('start'),'start');
  assert.equal(instanceAction('stop'),'stop');
  for(const value of ['default','aws','https://evil.example',{},null])assert.throws(()=>managedProvider(value),RangeError);
  for(const value of ['destroy','reboot','create',null])assert.throws(()=>instanceAction(value),RangeError);
});
test('fixed cloud targets cannot be replaced with arbitrary URLs',()=>{
  assert.equal(gcpInstanceUrl('project-1234','us-central1-c','joshbox-gcp'),'https://compute.googleapis.com/compute/v1/projects/project-1234/zones/us-central1-c/instances/joshbox-gcp');
  assert.equal(vastInstanceUrl('123456'),'https://cloud.vast.ai/api/v0/instances/123456/');
  assert.throws(()=>gcpInstanceUrl('evil/path','us-central1-c','vm'));
  assert.throws(()=>vastInstanceUrl('123/path'));
});
test('transitional states fail closed; active jobs block stop',()=>{
  assert.equal(actionAllowed('gcp','start','TERMINATED'),true);
  assert.equal(actionAllowed('gcp','stop','RUNNING'),true);
  assert.equal(actionAllowed('gcp','stop','STOPPING'),false);
  assert.equal(actionAllowed('vast','start','stopped'),true);
  assert.equal(actionAllowed('vast','stop','running'),true);
  assert.equal(actionAllowed('vast','start','scheduling'),false);
  assert.equal(actionAllowed('vast','stop','offline'),false);
  for(const status of ['submitting','queued','running','archiving','saving','uncertain'])assert.equal(isActiveJobStatus(status),true);
  assert.equal(isActiveJobStatus('complete'),false);
  assert.equal(isActiveJobStatus('failed'),false);
});
