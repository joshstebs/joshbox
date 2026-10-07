export type GenerationInput = {kind:'image'|'video';prompt:string;negative:string;mode:'fast'|'quality';aspect:'portrait'|'square'|'landscape';seed:number;image?:string;duration?:5|10|15};
export type WorkflowConfig = {checkpoint?:string;template?:string;fastTemplate?:string;qualityTemplate?:string};
type Node = {class_type:string;inputs:Record<string,unknown>;[key:string]:unknown};
export type Graph = Record<string,Node>;
export const sizes = {portrait:[768,1024],square:[1024,1024],landscape:[1024,768]} as const;
export function endpoint(base:string,path:string):URL {
  const url=new URL(base);const h=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||h==='localhost'||h.endsWith('.local')||h.endsWith('.internal')||h.includes(':')||/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h))throw new Error('Configure a public HTTPS ComfyUI endpoint without credentials or query parameters.');
  return new URL(url.toString().replace(/\/$/,'')+'/'+path.replace(/^\//,''));
}
export function validateGraph(value:unknown):Graph {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The workflow must be a ComfyUI API-format object.');
  const entries=Object.entries(value);if(!entries.length||entries.length>180)throw new Error('The workflow must contain 1–180 nodes.');
  for(const [,raw] of entries){const n=raw as Node;if(!n||typeof n.class_type!=='string'||!n.inputs||typeof n.inputs!=='object'||Array.isArray(n.inputs))throw new Error('Export the workflow in API format, not the visual editor format.');if(/api|openai|replicate|falai|runway|kling|luma|ideogram|gemini|anthropic|stabilityapi/i.test(n.class_type))throw new Error('Only local GPU workflows are supported. Remove hosted-service API nodes.');}
  return value as Graph;
}
export function videoControls(config:WorkflowConfig) {
  const result={ready:false,duration:false,aspect:false,fast:false,quality:false,h3:false};
  try {
    const quality=config.qualityTemplate||config.template;
    const fast=config.fastTemplate||config.template;
    const inspect=(template?:string)=>{
      if(!template)return null;
      const graph=validateGraph(JSON.parse(template));const text=JSON.stringify(graph);
      const has=(token:string)=>text.includes(JSON.stringify(token));
      return {valid:has('$prompt')&&has('$image'),h3:Object.values(graph).some(n=>n.class_type==='MiniMaxH3ImageToVideo'),duration:has('$duration')||has('$frames'),aspect:has('$width')&&has('$height'),turbo:has('$turbo'),steps:has('$steps')};
    };
    const q=inspect(quality),f=inspect(fast);
    result.quality=!!q?.valid;
    result.fast=!!f?.valid&&!!(config.fastTemplate||f.turbo||(!f.h3&&f.steps));
    const supported=[...(result.quality&&q?[q]:[]),...(result.fast&&f?[f]:[])];
    result.ready=supported.length>0;
    result.duration=result.ready&&supported.every(x=>x.duration&&x.h3);
    result.aspect=result.ready&&supported.every(x=>x.aspect);
    result.h3=result.ready&&supported.every(x=>x.h3);
  }catch{/* Invalid setup is shown as unavailable; templates stay private. */}
  return result;
}
export function makeWorkflow(input:GenerationInput,config:WorkflowConfig):Graph {
  const template=input.kind==='video'?(input.mode==='fast'?config.fastTemplate:config.qualityTemplate)||config.template:config.template;
  const graph=template?validateGraph(JSON.parse(template)):undefined;
  const h3=input.kind==='video'&&!!graph&&Object.values(graph).some(n=>n.class_type==='MiniMaxH3ImageToVideo');
  const [width,height]=h3?({portrait:[768,1344],square:[768,768],landscape:[1344,768]} as const)[input.aspect]:sizes[input.aspect];
  if(input.kind==='video'&&graph){const text=JSON.stringify(graph);if(!input.image||!text.includes('"$image"'))throw new Error('Animation needs an uploaded image and a $image placeholder.');const controls=videoControls(config);if(!controls[input.mode])throw new Error('This video mode has not been configured. Choose a supported mode.');if(input.duration!==undefined&&!controls.duration)throw new Error('This workflow does not support the requested duration. Configure the MiniMax H3 duration input first.');}
  const duration=input.duration??5;
  // Native H3 runs at 24 fps on its 17k+5 frame grid. Keep old custom templates compatible.
  const frames=h3?({5:124,10:243,15:362} as const)[duration]:input.mode==='fast'?49:81;
  const tokens:Record<string,string|number|boolean>={'$prompt':input.prompt,'$negative':input.negative,'$seed':input.seed,'$width':width,'$height':height,'$steps':h3?(input.mode==='fast'?8:20):input.mode==='fast'?20:32,'$image':input.image??'','$fps':h3?24:16,'$frames':frames,'$duration':duration,'$turbo':input.mode==='fast','$turbo_steps':8};
  if(graph){const text=JSON.stringify(graph);if(!text.includes('"$prompt"'))throw new Error('The workflow needs a $prompt input placeholder.');if(input.kind==='video'&&(!input.image||!text.includes('"$image"')))throw new Error('Animation needs an uploaded image and a $image placeholder.');
    function replace(v:unknown):unknown {if(typeof v==='string'){if(Object.hasOwn(tokens,v))return tokens[v];if(/^\$[a-z]/.test(v))throw new Error('Unknown workflow input placeholder: '+v);return v;}if(Array.isArray(v))return v.map(replace);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)]));return v;}
    return validateGraph(replace(graph));
  }
  if(input.kind==='video')throw new Error('An image-to-video API workflow has not been configured yet.');if(!config.checkpoint)throw new Error('Configure an SDXL checkpoint or an image API workflow first.');
  return {'1':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:config.checkpoint}},'2':{class_type:'CLIPTextEncode',inputs:{text:input.prompt,clip:['1',1]}},'3':{class_type:'CLIPTextEncode',inputs:{text:input.negative,clip:['1',1]}},'4':{class_type:'EmptyLatentImage',inputs:{width,height,batch_size:1}},'5':{class_type:'KSampler',inputs:{seed:input.seed,steps:tokens.$steps,cfg:6.5,sampler_name:'dpmpp_2m',scheduler:'karras',denoise:1,model:['1',0],positive:['2',0],negative:['3',0],latent_image:['4',0]}},'6':{class_type:'VAEDecode',inputs:{samples:['5',0],vae:['1',2]}},'7':{class_type:'SaveImage',inputs:{filename_prefix:'JoshBox',images:['6',0]}}};
}
export function historyFiles(entry:{outputs?:Record<string,Record<string,unknown>>}):{filename:string;subfolder:string;type:string;kind:'image'|'video'}[] {
  const out:ReturnType<typeof historyFiles>=[];for(const node of Object.values(entry.outputs??{}))for(const field of ['images','gifs','videos']){const list=node[field];if(!Array.isArray(list))continue;for(const f of list){if(!f||typeof f.filename!=='string'||!/\.(png|jpe?g|webp|mp4|webm|gif)$/i.test(f.filename))continue;const folder=typeof f.subfolder==='string'?f.subfolder:'';if(f.filename.includes('/')||f.filename.includes('\\')||f.filename.includes('..')||folder.split(/[\\/]/).includes('..'))continue;const type=f.type??'output';if(type!=='output')continue;out.push({filename:f.filename,subfolder:folder,type,kind:/\.(mp4|webm)$/i.test(f.filename)?'video':'image'});}}return out.slice(0,8);
}
