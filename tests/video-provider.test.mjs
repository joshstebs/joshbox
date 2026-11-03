import test from 'node:test';
import assert from 'node:assert/strict';
import {videoProviders,parseVideoProviderValue,videoJobRemoteId,videoJobProvider} from '../lib/video-provider.mts';

const id='6aab2a89-0bb0-4bbb-b222-889900aaccdd';
test('fixed GPU profiles reject arbitrary browser-provided destinations',()=>{
  assert.deepEqual([...videoProviders],['default','gcp','vast']);
  assert.equal(parseVideoProviderValue(null),'default');
  assert.equal(parseVideoProviderValue(''),'default');
  for(const provider of videoProviders)assert.equal(parseVideoProviderValue(provider),provider);
  for(const bad of ['https://evil.example','aws','vast/../default','GCP',{},42])
    assert.throws(()=>parseVideoProviderValue(bad),RangeError);
});
test('new provider IDs preserve old jobs and pin jobs to their original GPU',()=>{
  assert.equal(videoJobRemoteId('default',id),'proxy:'+id);
  assert.equal(videoJobRemoteId('gcp',id),'proxy:gcp:'+id);
  assert.equal(videoJobRemoteId('vast',id),'proxy:vast:'+id);
  for(const provider of videoProviders){
    const remote=videoJobRemoteId(provider,id);
    assert.equal(videoJobProvider(remote,id),provider);
    assert.equal(videoJobProvider(remote,'another-id'),null);
  }
  assert.equal(videoJobProvider('proxy:other:'+id,id),null);
  assert.equal(videoJobProvider(null,id),null);
});
