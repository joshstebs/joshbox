import {consumeSSE,renderStatusLabel} from './sse.js';
import {extractLastFrame} from './last-frame.js';
import {suggestedPrompts,appendSuggestion} from './prompt-suggestions.js';

const $=id=>document.getElementById(id);
const presets=[
  {id:'minimax',model:'minimax_h3',name:'MiniMax H3',detail:'Image to video · native audio',mode:'quality',frames:124,fps:24,steps:20,fastSteps:8},
  {id:'wan14fast',model:'wan22_14b',name:'ϟ Wan 2.2 14B',detail:'4-step I2V LoRA profile',mode:'fast',frames:81,fps:16,steps:4,fastSteps:4},
  {id:'wan14quality',model:'wan22_14b',name:'✦ Wan 2.2 14B',detail:'Standard quality I2V profile',mode:'quality',frames:81,fps:16,steps:20,fastSteps:4},
  {id:'wan5',model:'wan22_5b',name:'Wan 2.2 5B',detail:'TI2V · smaller model',mode:'quality',frames:81,fps:16,steps:20,fastSteps:8},
  {id:'ltx',model:'ltx23',name:'LTX 2.3',detail:'I2V · distilled profile',mode:'fast',frames:121,fps:24,steps:8,fastSteps:8},
  {id:'hunyuan',model:'hunyuan15',name:'HunyuanVideo 1.5',detail:'Cinematic I2V profile',mode:'quality',frames:81,fps:24,steps:30,fastSteps:8}
];
const state={preset:presets[0],mode:'quality',capabilities:null,busy:false,unresolved:false,file:null,imageUrl:null,extension:null,current:null,jobs:[],requestId:null,pollTimer:null,logs:[]};
function notice(text,error=false){const box=$(error?'error':'notice');box.textContent=text;box.hidden=!text;}
function log(message){state.logs.push('['+new Date().toLocaleTimeString()+'] '+message);state.logs=state.logs.slice(-150);$('executionLog').textContent=state.logs.join('\n');}
async function api(url,options={}){const response=await fetch(url,{...options,cache:'no-store'});let value;try{value=await response.json();}catch{throw new Error('Sign in again or check your connection.');}if(!response.ok)throw new Error(value.error||value.detail||'The request failed.');return value;}
function profile(mode=state.mode){return state.capabilities?.profiles?.[state.preset.model]?.[mode];}
function applyCapabilities(){
  const info=profile(),controls=info?.controls||[];
  const connected=!!state.capabilities?.connected;
  $('generate').disabled=state.busy||state.unresolved||!connected||!info?.ready;
  $('fastMode').disabled=state.busy||(connected&&!profile('fast')?.ready);
  $('qualityMode').disabled=state.busy||(connected&&!profile('quality')?.ready);
  $('boost').disabled=state.busy||!connected||!profile('fast')?.ready;
  $('boostHint').textContent=profile('fast')?.ready?'Use this model’s configured Fast workflow.':'Requires a configured Fast workflow. No model is installed by this switch.';
  for(const [id,token] of [['frames','frames'],['fps','fps'],['steps','steps'],['motionBucket','motion_bucket'],['motionScale','motion_scale']]){
    const enabled=(!connected&&!id.startsWith('motion'))||controls.includes(token);
    const fixedH3=state.preset.model==='minimax_h3'&&id==='fps';
    $(id).disabled=state.busy||!enabled||fixedH3;$(id+'Slider').disabled=$(id).disabled;
  }
  $('aspectRatio').disabled=state.busy||(connected&&(!controls.includes('width')||!controls.includes('height')));
  $('negativePrompt').disabled=state.busy||(connected&&!controls.includes('negative'));
  $('seed').disabled=state.busy||$('randomSeed').checked;
  $('sourceImage').disabled=state.busy;$('positivePrompt').disabled=state.busy;
  $('randomSeed').disabled=state.busy;$('adultOnly').disabled=state.busy;
  $('generateLabel').textContent=state.busy?'Rendering…':state.unresolved?'Check existing generation':'Generate Video';
  $('renderSpinner').hidden=!state.busy;
  $('generationHint').textContent=state.unresolved?'Refresh the existing job before generating again.':!connected?'Connect the GPU proxy to generate. No instance is started by this app.':!info?.ready?'This setup needs an exported workflow on your GPU.':'Keep the GPU running until your video is saved to the gallery.';
  $('selectedModel').textContent=state.preset.name.replace(/^[ϟ✦] /,'');
  $('qualityMode').classList.toggle('selected',state.mode==='quality');$('qualityMode').setAttribute('aria-pressed',String(state.mode==='quality'));
  $('fastMode').classList.toggle('selected',state.mode==='fast');$('fastMode').setAttribute('aria-pressed',String(state.mode==='fast'));
  $('frames').step=state.preset.model==='minimax_h3'?'17':state.preset.model==='ltx23'?'8':'4';
  $('frames').min=state.preset.model==='minimax_h3'?'5':'1';
  $('framesSlider').step=$('frames').step;$('framesSlider').min=$('frames').min;$('framesSlider').value=$('frames').value;
  $('controlHint').textContent=state.preset.model==='minimax_h3'?'Native H3: 24 FPS, 17k+5 frame grid. Motion controls need an explicit workflow mapping.':'These are draft presets. The installed workflow determines supported controls; motion controls stay disabled unless mapped.';
  renderPicks();updateDuration();
  for(const button of document.querySelectorAll('[data-seconds]'))button.disabled=state.busy||(connected&&!controls.includes('frames'));
}
function renderPicks(){
  $('quickPicks').replaceChildren(...presets.map(p=>{const button=document.createElement('button');button.type='button';button.className='quick-pick'+(state.preset.id===p.id?' selected':'');button.setAttribute('aria-pressed',String(state.preset.id===p.id));button.disabled=state.busy;const title=document.createElement('strong');title.textContent=p.name;const detail=document.createElement('small');detail.textContent=p.detail;const badge=document.createElement('span');const available=state.capabilities?.profiles?.[p.model]?.[p.mode]?.ready;badge.className='preset-state'+(available?' available':'');badge.textContent=available?'WORKFLOW CONFIGURED':'SETUP NEEDED';button.append(title,detail,badge);button.addEventListener('click',()=>{state.preset=p;state.mode=p.mode;$('boost').checked=false;for(const id of ['frames','fps','steps']){$(id).value=p[id];$(id+'Slider').value=p[id];}applyCapabilities();notice(available?'Preset loaded. Review your image and prompt.':'Draft preset loaded. This model is not connected; no installation or generation was started.');});return button;}));
}
function updateSuggestions(){const prompt=$('positivePrompt').value;$('promptCount').textContent=prompt.length+' / 3000';const choices=prompt?suggestedPrompts(prompt,'video'):['Slow camera push','Gentle natural movement','Pan across the scene'];$('suggestions').replaceChildren(...choices.map(text=>{const button=document.createElement('button');button.type='button';button.textContent=text;button.disabled=state.busy||appendSuggestion(prompt,text).length>3000;button.onclick=()=>{$('positivePrompt').value=appendSuggestion($('positivePrompt').value,text);updateSuggestions();};return button;}));}
function setImage(file,extension=null){if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024**2)throw new Error('Use PNG, JPG, or WebP under 12 MB.');if(state.imageUrl)URL.revokeObjectURL(state.imageUrl);state.file=file;state.extension=extension;state.imageUrl=URL.createObjectURL(file);$('imagePreview').src=state.imageUrl;$('imagePreview').hidden=false;$('uploadCopy').hidden=true;$('removeImage').hidden=false;$('extensionNote').hidden=!extension;$('extensionNote').textContent=extension?'Starting from the previous video’s last frame. Describe the next scene.':'';}
async function checkConnection(){try{state.capabilities=await api('/api/video/connection');$('connectionBadge').classList.add('connected');$('connectionBadge').lastChild.textContent=' GPU responding';notice('Proxy is responding. Workflow configuration and a successful render are separate checks.');}catch(e){state.capabilities=null;$('connectionBadge').classList.remove('connected');$('connectionBadge').lastChild.textContent=' GPU not connected';notice(e.message);}finally{applyCapabilities();}}
function progress(data,archived=false){
  $('renderState').textContent=renderStatusLabel(data.status,archived);
  if(data.node)$('activeNode').textContent=data.node;
  const total=Number(data.total),step=Number(data.step);
  if(Number.isFinite(total)&&total>0&&Number.isFinite(step)){
    const percent=Math.max(0,Math.min(100,step/total*100));$('progressBar').style.width=percent+'%';$('progressBar').setAttribute('aria-valuenow',String(Math.round(percent)));$('progressTrack').classList.remove('indeterminate');$('stepLabel').textContent='Step '+step+' / '+total;
  }else{$('stepLabel').textContent='Step — / —';$('progressTrack').classList.toggle('indeterminate',!['complete','failed','uncertain'].includes(data.status));$('progressBar').style.width='0%';$('progressBar').removeAttribute('aria-valuenow');}
  if(data.message&&state.logs.at(-1)?.split('] ').slice(1).join('] ')!==data.message)log(data.message);
}
function mountVideo(job,index=0){state.current={job,index};$('videoPlayer').src='/api/media/'+job.id+'/'+index;$('videoPlayer').hidden=false;$('emptyPreview').hidden=true;$('download').href=$('videoPlayer').src+'?download';$('download').hidden=false;$('download').download='joshbox-'+job.id+'.mp4';$('fullscreen').disabled=false;$('extend').disabled=false;$('previewTag').textContent='SAVED TO PRIVATE GALLERY';}
async function finishJob(id){const saved=await api('/api/video/jobs/'+id);progress(saved,saved.status==='complete');if(saved.status==='complete'){state.busy=false;state.unresolved=false;state.requestId=null;clearTimeout(state.pollTimer);mountVideo(saved);await refreshGallery(false);notice('Video saved to your private gallery. You can download or extend it.');applyCapabilities();return true;}return false;}
async function monitor(id){
  clearTimeout(state.pollTimer);
  try{const job=await api('/api/video/jobs/'+id);progress(job,job.status==='complete');if(job.status==='complete'){state.busy=false;state.unresolved=false;state.requestId=null;mountVideo(job);await refreshGallery(false);applyCapabilities();return;}
    if(job.status==='failed'){state.busy=false;state.unresolved=false;state.requestId=null;notice(job.message||'Generation failed. Check the workflow.',true);applyCapabilities();return;}
    if(job.status==='uncertain'){state.busy=false;state.unresolved=true;notice(job.message||'The existing submission needs checking.',true);applyCapabilities();}
  }catch(e){notice(e.message,true);}
  state.pollTimer=setTimeout(()=>{if(!document.hidden)void monitor(id);else state.pollTimer=setTimeout(()=>void monitor(id),7000);},7000);
}
async function generate(event){
  event.preventDefault();notice('',true);notice('');
  if(state.busy||state.unresolved)return;
  if(!state.file){notice('Choose a starting image.',true);return;}
  if($('positivePrompt').value.trim().length<8){notice('Describe the scene in at least 8 characters.',true);$('positivePrompt').focus();return;}
  if(!$('adultOnly').checked){notice('Confirm that any people are fictional adults.',true);return;}
  const dimensions={landscape:[1024,576],portrait:[576,1024],square:[768,768]}[$('aspectRatio').value];
  const seed=$('randomSeed').checked?crypto.getRandomValues(new Uint32Array(1))[0]%2147483648:Number($('seed').value);$('seed').value=String(seed);
  const settings={request_id:state.requestId||crypto.randomUUID(),model:state.preset.model,mode:state.mode,prompt:$('positivePrompt').value.trim(),negative:$('negativePrompt').value,width:dimensions[0],height:dimensions[1],frames:Number($('frames').value),fps:Number($('fps').value),steps:Number($('steps').value),motion_bucket:Number($('motionBucket').value),motion_scale:Number($('motionScale').value),seed,extend_job_id:state.extension?.job.id,extend_index:state.extension?.index};
  for(const [id,min,max] of [['frames',1,362],['fps',1,60],['steps',1,100],['motion_bucket',0,255],['motion_scale',0,10],['seed',0,2147483647]])if(!Number.isFinite(settings[id])||settings[id]<min||settings[id]>max||(id!=='motion_scale'&&!Number.isInteger(settings[id]))){notice('Check the '+id.replace('_',' ')+' value.',true);return;}
  state.requestId=settings.request_id;state.busy=true;if(innerWidth<1024)document.querySelector('.monitor').scrollIntoView({behavior:'smooth',block:'start'});applyCapabilities();updateSuggestions();log('Sending the image and settings to your GPU proxy.');$('activeNode').textContent='Preparing the workflow';$('progressTrack').classList.add('indeterminate');
  const form=new FormData();form.append('settings',JSON.stringify(settings));form.append('image',state.file);
  let completed=false;
  try{const response=await fetch('/api/generate',{method:'POST',body:form});if(!response.ok){const value=await response.json();if([400,403,409,413,422,503].includes(response.status))state.requestId=null;throw new Error(value.error||'Generation request failed.');}
    if(!response.headers.get('content-type')?.includes('text/event-stream'))throw new Error('The proxy did not return a progress stream.');
    await consumeSSE(response,async(type,data)=>{progress(data);if(type==='completed'||data.status==='complete'){completed=await finishJob(settings.request_id);}else if(type==='error'){throw new Error(data.message||'Generation needs attention.');}});
    if(!completed){state.unresolved=true;state.busy=false;void monitor(settings.request_id);}
  }catch(e){state.busy=false;notice(e.message,true);log(e.message);await refreshGallery();const receipt=state.jobs.find(j=>j.id===settings.request_id);if(receipt&&!['complete','failed'].includes(receipt.status)){state.unresolved=true;void monitor(receipt.id);}else if(receipt?.status==='failed'){state.requestId=null;state.unresolved=false;}}
  finally{if(completed)state.busy=false;applyCapabilities();updateSuggestions();}
}
async function extendCurrent(){if(!state.current||state.busy)return;const previous=state.current;$('extend').disabled=true;notice('Preparing the last frame…');try{const frame=await extractLastFrame('/api/media/'+previous.job.id+'/'+previous.index);setImage(frame,previous);$('positivePrompt').value='';updateSuggestions();notice('Last frame selected. Write the next action to generate a new clip.');$('positivePrompt').scrollIntoView({behavior:'smooth',block:'center'});$('positivePrompt').focus({preventScroll:true});}catch(e){notice(e.message,true);}finally{$('extend').disabled=false;}}
async function useImage(job,index){const response=await fetch('/api/media/'+job.id+'/'+index);if(!response.ok)throw new Error('Saved image could not be loaded.');const blob=await response.blob();setImage(new File([blob],'gallery-image',{type:blob.type}));$('imagePicker').close();$('positivePrompt').scrollIntoView({behavior:'smooth',block:'center'});}
async function refreshGallery(resume=true){try{const result=await api('/api/studio');state.jobs=result.jobs;const outputs=result.jobs.filter(j=>j.status==='complete').flatMap(job=>job.media.map((media,index)=>({job,media,index})));$('gallery').replaceChildren();$('pickerImages').replaceChildren();let imageCount=0;
  for(const {job,media,index} of outputs){const item=document.createElement('article');item.className='gallery-item';const preview=document.createElement(media.kind==='video'?'video':'img');preview.src='/api/media/'+job.id+'/'+index;if(media.kind==='video'){preview.controls=true;preview.playsInline=true;preview.preload='metadata';}else{preview.alt=job.prompt.slice(0,120);preview.loading='lazy';}
    const prompt=document.createElement('p');prompt.textContent=job.prompt;const actions=document.createElement('div');actions.className='actions';const download=document.createElement('a');download.className='button subtle';download.textContent='↓ Download';download.href=preview.src+'?download';download.download='';const action=document.createElement('button');action.type='button';action.className='button primary';action.textContent=media.kind==='video'?'+ Extend Video':'Use image';action.onclick=()=>{if(media.kind==='video'){state.current={job,index};void extendCurrent();}else void useImage(job,index).catch(e=>notice(e.message,true));};actions.append(download,action);item.append(preview,prompt,actions);$('gallery').append(item);
    if(media.kind==='image'){imageCount++;const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','Use image: '+job.prompt.slice(0,60));const thumbnail=document.createElement('img');thumbnail.src=preview.src;thumbnail.alt=job.prompt.slice(0,120);button.append(thumbnail);button.onclick=()=>void useImage(job,index).catch(e=>notice(e.message,true));$('pickerImages').append(button);}}
  if(!outputs.length){const text=document.createElement('p');text.className='hint';text.textContent='No creations saved yet. Finished videos will be archived here before they become downloadable.';$('gallery').append(text);}
  $('pickerEmpty').hidden=imageCount>0;
  const pending=result.jobs.find(j=>j.backend==='proxy'&&!['complete','failed'].includes(j.status));if(resume&&pending&&!state.busy){state.requestId=pending.id;state.busy=true;applyCapabilities();void monitor(pending.id);}
  const latest=outputs.find(x=>x.media.kind==='video');if(latest&&!state.current)mountVideo(latest.job,latest.index);
}catch(e){notice(e.message,true);}}

function updateDuration(){$('durationReadout').textContent='~'+(Number($('frames').value)/Number($('fps').value)).toFixed(1)+' seconds · '+$('frames').value+' frames at '+$('fps').value+' FPS';}
for(const button of document.querySelectorAll('[data-seconds]'))button.onclick=()=>{const grid=Number($('frames').step),min=Number($('frames').min),frames=Math.min(min+Math.floor((362-min)/grid)*grid,min+Math.ceil((Number(button.dataset.seconds)*Number($('fps').value)-min)/grid)*grid);$('frames').value=String(frames);$('framesSlider').value=String(frames);updateDuration();};
for(const id of ['frames','fps','steps','motionBucket','motionScale']){for(const suffix of ['', 'Slider'])$(id+suffix).addEventListener('input',()=>{$(id+(suffix?'':'Slider')).value=$(id+suffix).value;updateDuration();});}
$('frames').addEventListener('change',()=>{const grid=Number($('frames').step),min=Number($('frames').min),value=Number($('frames').value);$('frames').value=String(Math.min(min+Math.floor((362-min)/grid)*grid,Math.max(min,min+Math.ceil((value-min)/grid)*grid)));$('framesSlider').value=$('frames').value;});
$('positivePrompt').addEventListener('input',updateSuggestions);
$('sourceImage').addEventListener('change',()=>{try{if($('sourceImage').files[0])setImage($('sourceImage').files[0]);}catch(e){notice(e.message,true);}});
$('removeImage').onclick=()=>{if(state.imageUrl)URL.revokeObjectURL(state.imageUrl);state.file=null;state.extension=null;state.imageUrl=null;$('imagePreview').hidden=true;$('uploadCopy').hidden=false;$('removeImage').hidden=true;$('extensionNote').hidden=true;$('sourceImage').value='';};
for(const type of ['dragenter','dragover'])$('uploadZone').addEventListener(type,e=>{e.preventDefault();if(!state.busy)$('uploadZone').classList.add('dragging');});
for(const type of ['dragleave','drop'])$('uploadZone').addEventListener(type,e=>{e.preventDefault();$('uploadZone').classList.remove('dragging');if(type==='drop'&&!state.busy)try{setImage(e.dataTransfer.files[0]);}catch(error){notice(error.message,true);}});
$('qualityMode').onclick=()=>{state.mode='quality';$('boost').checked=false;$('steps').value=state.preset.model==='hunyuan15'?30:20;$('stepsSlider').value=$('steps').value;applyCapabilities();};
$('fastMode').onclick=()=>{state.mode='fast';$('boost').checked=false;$('steps').value=state.preset.fastSteps;$('stepsSlider').value=$('steps').value;applyCapabilities();};
$('boost').onchange=()=>{state.mode=$('boost').checked?'fast':profile('quality')?.ready?'quality':'fast';$('steps').value=state.mode==='fast'?state.preset.fastSteps:state.preset.model==='hunyuan15'?30:20;$('stepsSlider').value=$('steps').value;applyCapabilities();};
$('randomSeed').onchange=applyCapabilities;$('generationForm').addEventListener('submit',generate);
$('loopVideo').onchange=()=>{$('videoPlayer').loop=$('loopVideo').checked;};
$('fullscreen').onclick=()=>{$('videoPlayer').requestFullscreen?.().catch(()=>notice('Fullscreen is unavailable on this device. Use the player controls.'));};
$('extend').onclick=()=>void extendCurrent();$('checkConnection').onclick=()=>void checkConnection();$('refreshGallery').onclick=()=>void refreshGallery();
$('chooseGallery').onclick=()=>{$('imagePicker').showModal();};$('closePicker').onclick=()=>{$('imagePicker').close();};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.requestId&&!state.busy)void monitor(state.requestId);});
updateSuggestions();applyCapabilities();void checkConnection();void refreshGallery();
