import test from 'node:test';
import assert from 'node:assert/strict';
import {presets,dimensionsFor,stepsForMode} from '../public/video-presets.js';

test('LTX 13B has a distinct profile and fixed distilled schedule',()=>{
  const p=presets.find(p=>p.model==='ltx13b');
  assert.equal(p.mode,'fast');assert.equal(stepsForMode(p,'fast'),8);
  assert.equal((p.frames-1)%8,0);
  assert.ok(presets.some(p=>p.model==='ltx23'));
});
test('Hunyuan CFG distillation keeps the required fifty steps and native 720p',()=>{
  const p=presets.find(p=>p.model==='hunyuan15');
  assert.equal(stepsForMode(p,'quality'),50);
  assert.deepEqual(dimensionsFor(p.model,'landscape'),[1280,720]);
  assert.equal((p.frames-1)%4,0);
});
test('H3 quality and turbo use the matching native audio/frame profile',()=>{
  const p=presets.find(p=>p.model==='minimax_h3');
  assert.equal(p.fps,24);assert.equal((p.frames-5)%17,0);
  assert.equal(stepsForMode(p,'quality'),20);assert.equal(stepsForMode(p,'fast'),8);
  assert.deepEqual(dimensionsFor(p.model,'portrait'),[768,1344]);
});
