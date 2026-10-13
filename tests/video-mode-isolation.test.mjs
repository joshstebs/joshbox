import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWorkflow,videoControls} from '../lib/engine.mts';

const template=JSON.stringify({'1':{class_type:'LoadImage',inputs:{image:'$image'}},'2':{class_type:'MiniMaxH3ImageToVideo',inputs:{prompt:'$prompt',length:'$frames',width:'$width',height:'$height'}}});
const input={kind:'video',prompt:'A breeze through a forest',negative:'',seed:42,mode:'quality',aspect:'portrait',duration:5,image:'ref.png'};

test('a malformed Fast workflow does not disable valid Quality generation',()=>{
  const config={qualityTemplate:template,fastTemplate:'broken json'};
  assert.deepEqual(videoControls(config),{ready:true,duration:true,aspect:true,fast:false,quality:true,h3:true});
  assert.equal(makeWorkflow(input,config)['2'].inputs.length,124);
  assert.throws(()=>makeWorkflow({...input,mode:'fast'},config));
});

test('a malformed Quality workflow does not disable valid Fast generation',()=>{
  const config={qualityTemplate:'broken json',fastTemplate:template};
  assert.deepEqual(videoControls(config),{ready:true,duration:true,aspect:true,fast:true,quality:false,h3:true});
  assert.equal(makeWorkflow({...input,mode:'fast'},config)['2'].inputs.length,124);
  assert.throws(()=>makeWorkflow(input,config));
});
