// Distinct model families must never share checkpoint or acceleration assumptions.
export const presets = [
  {id:'minimax',model:'minimax_h3',name:'MiniMax H3',detail:'I2V + native audio · optional 8-step turbo LoRA',mode:'quality',frames:124,fps:24,steps:20,fastSteps:8},
  {id:'wan14fast',model:'wan22_14b',name:'ϟ Wan 2.2 14B Fast',detail:'Requires a separate verified accelerated workflow',mode:'fast',frames:81,fps:16,steps:4,fastSteps:4},
  {id:'wan14quality',model:'wan22_14b',name:'✦ Wan 2.2 14B',detail:'Dual-expert I2V · 20-step quality',mode:'quality',frames:81,fps:16,steps:20,fastSteps:4},
  {id:'wan5',model:'wan22_5b',name:'Wan 2.2 5B',detail:'TI2V · smaller model',mode:'quality',frames:81,fps:16,steps:20,fastSteps:8},
  {id:'ltx13',model:'ltx13b',name:'LTX-Video 13B',detail:'0.9.8 distilled FP8 · fixed 8-step schedule',mode:'fast',frames:97,fps:24,steps:8,fastSteps:8},
  {id:'ltx',model:'ltx23',name:'LTX 2.3',detail:'Separate model · custom workflow required',mode:'fast',frames:121,fps:24,steps:8,fastSteps:8},
  {id:'hunyuan',model:'hunyuan15',name:'HunyuanVideo 1.5',detail:'720p I2V CFG-distilled FP8 · fixed 50 steps',mode:'quality',frames:121,fps:24,steps:50,fastSteps:50}
];

export function dimensionsFor(model, aspect) {
  const shapes = model === 'hunyuan15'
    ? {landscape:[1280,720],portrait:[720,1280],square:[720,720]}
    : model === 'minimax_h3'
    ? {landscape:[1344,768],portrait:[768,1344],square:[768,768]}
    : {landscape:[1024,576],portrait:[576,1024],square:[768,768]};
  return shapes[aspect];
}

export function stepsForMode(preset, mode) {
  return mode === 'fast' ? preset.fastSteps : preset.steps;
}
