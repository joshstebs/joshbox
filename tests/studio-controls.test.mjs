
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWorkflow,videoControls} from '../lib/engine.mts';
import {suggestedPrompts,appendSuggestion} from '../lib/prompt-suggestions.ts';
const base={kind:'video',prompt:'A breeze through a forest',negative:'',seed:42,mode:'quality',aspect:'portrait',duration:5,image:'ref.png'};
const graph={'1':{class_type:'LoadImage',inputs:{image:'$image'}},'2':{class_type:'MiniMaxH3ImageToVideo',inputs:{prompt:'$prompt',width:'$width',height:'$height',length:'$frames',first_frame:['1',0]}},'3':{class_type:'PrimitiveBoolean',inputs:{value:'$turbo'}},'4':{class_type:'PrimitiveInt',inputs:{value:'$steps'}},'5':{class_type:'CreateVideo',inputs:{fps:'$fps'}}};
const template=JSON.stringify(graph);
test('H3 durations use valid 24 fps grid and portrait/landscape dimensions',()=>{
  for(const [duration,frames] of [[5,124],[10,243],[15,362]]){
    const result=makeWorkflow({...base,duration},{template});assert.equal(result['2'].inputs.length,frames);assert.equal((frames-5)%17,0);assert.equal(result['5'].inputs.fps,24);
  }
  const portrait=makeWorkflow(base,{template});assert.equal(portrait['2'].inputs.width,768);assert.equal(portrait['2'].inputs.height,1344);
  const landscape=makeWorkflow({...base,aspect:'landscape'},{template});assert.equal(landscape['2'].inputs.width,1344);assert.equal(landscape['2'].inputs.height,768);
});
test('Fast/Boost requires a configured turbo mapping or an explicit Fast workflow',()=>{
  const fast=makeWorkflow({...base,mode:'fast'},{template});assert.equal(fast['3'].inputs.value,true);assert.equal(fast['4'].inputs.value,8);
  const quality=makeWorkflow(base,{template});assert.equal(quality['3'].inputs.value,false);assert.equal(quality['4'].inputs.value,20);
  const fixed=structuredClone(graph);delete fixed['3'];delete fixed['4'];const fixedTemplate=JSON.stringify(fixed);
  assert.equal(videoControls({template:fixedTemplate}).fast,false);
  assert.throws(()=>makeWorkflow({...base,mode:'fast'},{template:fixedTemplate}),/mode has not been configured/);
  assert.equal(videoControls({qualityTemplate:fixedTemplate,fastTemplate:fixedTemplate}).fast,true);
});
test('Controls do not promise duration or aspect changes for fixed templates',()=>{
  const fixed={'1':{class_type:'LoadImage',inputs:{image:'$image'}},'2':{class_type:'MiniMaxH3ImageToVideo',inputs:{prompt:'$prompt',width:768,height:1344,length:124,first_frame:['1',0]}}};
  const config={template:JSON.stringify(fixed)};
  assert.equal(videoControls(config).duration,false);assert.equal(videoControls(config).aspect,false);
  assert.throws(()=>makeWorkflow(base,config),/duration/);
  assert.equal(videoControls({template:'broken json'}).ready,false);
});
test('Suggestions adapt to existing prompt content and stay opt-in',()=>{
  const prompt='A character walks through a forest';
  const options=suggestedPrompts(prompt,'video');
  assert.ok(options.some(x=>x.includes('ambient')));assert.ok(options.some(x=>x.includes('natural')));
  const amended=appendSuggestion(prompt,'The camera slowly pushes in.');
  assert.ok(amended.startsWith(prompt));assert.equal(prompt,'A character walks through a forest');
  assert.ok(!suggestedPrompts(amended,'video').some(x=>x.includes('pushes')));
  assert.equal(appendSuggestion('An image.','Soft light.'),'An image. Soft light.');
  assert.ok(suggestedPrompts('A portrait','image').some(x=>x.includes('expression')));
});
