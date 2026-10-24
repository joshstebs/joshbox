import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVideoPrompt} from '../public/prompt-builder.js';

test('builder requires subject and action and preserves opt-in flow',()=>{
  assert.equal(buildVideoPrompt({subject:'A person'}),'');
  assert.equal(buildVideoPrompt({action:'walks'}),'');
  assert.equal(buildVideoPrompt({subject:' A person ',action:'walks',camera:'The camera pans'}),'A person walks. The camera pans.');
});
test('builder composes detailed scenes without empty clauses',()=>{
  const prompt=buildVideoPrompt({subject:'A dancer.',action:'spins gracefully.',setting:'on a rooftop',lighting:'Warm golden-hour light',details:'Wind moves the fabric.'});
  assert.equal(prompt,'A dancer spins gracefully. The scene takes place on a rooftop. Warm golden-hour light. Wind moves the fabric.');
});
test('builder trims and caps long input to video prompt limit',()=>{
  assert.ok(buildVideoPrompt({subject:'A person',action:'walks',details:'detail '.repeat(1000)}).length<=3000);
});
