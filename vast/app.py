"""Authenticated, single-owner-per-request ComfyUI proxy with durable job receipts.

No GPU provisioning, downloads, workflow installation, or automatic resubmission.
Run exactly one Uvicorn worker. The private Site supplies owner_id server-side.
"""
import asyncio
import copy
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlencode, urlparse
from uuid import UUID

import httpx
import websockets
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

DATA = Path(os.environ.get('JOSHBOX_DATA_DIR', '/workspace/joshbox-data'))
DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
DB = sqlite3.connect(DATA / 'jobs.sqlite3', check_same_thread=False, timeout=30)
DB.row_factory = sqlite3.Row
DB.execute('PRAGMA journal_mode=WAL')
DB.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)')
DB.execute("CREATE UNIQUE INDEX IF NOT EXISTS active_owner ON jobs(owner) WHERE status IN ('submitting','queued','running','saving','uncertain')")
DB.commit()
COMFY = os.environ.get('COMFY_URL', 'http://127.0.0.1:8188').rstrip('/')
if urlparse(COMFY).hostname not in ('127.0.0.1', 'localhost', '::1'):
    raise RuntimeError('The wrapper must connect to local ComfyUI.')
TOKEN = os.environ.get('VIDEO_PROXY_TOKEN', '')
tasks: dict[str, asyncio.Task] = {}
MODELS = {'minimax_h3': 'MINIMAX', 'wan22_14b': 'WAN14', 'wan22_5b': 'WAN5', 'ltx23': 'LTX23', 'hunyuan15': 'HUNYUAN15'}

class Settings(BaseModel):
    request_id: UUID
    owner_id: str = Field(min_length=1, max_length=100)
    prompt: str = Field(min_length=8, max_length=3000)
    negative: str = Field(default='', max_length=1500)
    mode: str = 'quality'
    model: str = 'minimax_h3'
    width: int = Field(default=1024, ge=256, le=2048)
    height: int = Field(default=576, ge=256, le=2048)
    frames: int = Field(default=124, ge=5, le=362)
    fps: int = Field(default=24, ge=1, le=60)
    steps: int = Field(default=20, ge=1, le=100)
    motion_bucket: int = Field(default=127, ge=0, le=255)
    motion_scale: float = Field(default=1, ge=0, le=10)
    seed: int = Field(ge=0, le=2147483647)

    @field_validator('mode')
    @classmethod
    def valid_mode(cls, value):
        if value not in ('fast', 'quality'): raise ValueError('Unknown mode')
        return value

    @field_validator('model')
    @classmethod
    def valid_model(cls, value):
        if value not in MODELS: raise ValueError('Unknown model profile')
        return value

async def auth(request: Request):
    if len(TOKEN) < 32: raise HTTPException(503, 'Proxy authentication is not configured.')
    supplied = request.headers.get('authorization', '')
    if not secrets.compare_digest(supplied.encode(), ('Bearer ' + TOKEN).encode()): raise HTTPException(401, 'Unauthorized')

def get_job(job_id: str, owner: str | None = None):
    try: UUID(job_id)
    except ValueError: raise HTTPException(404, 'Job not found')
    row = DB.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
    if not row or (owner is not None and row['owner'] != owner): raise HTTPException(404, 'Job not found')
    return json.loads(row['data'])

def update(job, event, **fields):
    job.update(fields)
    job['event'] = event
    job['revision'] = job.get('revision', 0) + 1
    if fields.get('message'):
        job['logs'] = (job.get('logs', []) + [{'time': time.time(), 'message': fields['message']}])[-100:]
    DB.execute('UPDATE jobs SET status=?,data=? WHERE id=?', (job['status'], json.dumps(job), job['id']))
    DB.commit()

def template_for(mode, model='minimax_h3'):
    name = 'WORKFLOW_' + MODELS[model] + '_' + mode.upper() + '_PATH'
    filename = os.environ.get(name, '') or (os.environ.get('WORKFLOW_' + mode.upper() + '_PATH', '') if model=='minimax_h3' else '')
    if not filename or not Path(filename).is_file(): raise HTTPException(503, f'The {mode} workflow has not been configured.')
    try: graph = json.loads(Path(filename).read_text())
    except (ValueError, OSError): raise HTTPException(503, 'Workflow file could not be read.')
    if not isinstance(graph, dict) or not 1 <= len(graph) <= 180: raise HTTPException(503, 'Use an API-format workflow export.')
    for node in graph.values():
        if not isinstance(node, dict) or not isinstance(node.get('inputs'), dict) or not isinstance(node.get('class_type'), str): raise HTTPException(503, 'Use API-format workflow JSON, not a node-editor export.')
        if re.search(r'api|openai|replicate|falai|runway|kling|luma|gemini|anthropic', node['class_type'], re.I): raise HTTPException(503, 'Only trusted local GPU workflows are supported.')
    text = json.dumps(graph)
    if '"$prompt"' not in text or '"$image"' not in text: raise HTTPException(503, 'Map the workflow prompt and starting image inputs first.')
    return graph

def workflow(settings, image):
    graph = template_for(settings.mode, settings.model)
    h3 = any(n['class_type'] == 'MiniMaxH3ImageToVideo' for n in graph.values())
    if h3 and (settings.fps != 24 or (settings.frames - 5) % 17): raise HTTPException(422, 'Native H3 requires 24 FPS and a 17k+5 frame count (124, 243, or 362 for about 5, 10, or 15 seconds).')
    if settings.width % 32 or settings.height % 32: raise HTTPException(422, 'Dimensions must be multiples of 32.')
    values = {'$prompt': settings.prompt, '$negative': settings.negative, '$image': image, '$width': settings.width, '$height': settings.height, '$frames': settings.frames, '$fps': settings.fps, '$steps': settings.steps, '$seed': settings.seed, '$motion_bucket': settings.motion_bucket, '$motion_scale': settings.motion_scale}
    def replace(value):
        if isinstance(value, str) and value.startswith('$'):
            if value not in values: raise HTTPException(503, 'Unknown workflow input placeholder.')
            return values[value]
        if isinstance(value, list): return [replace(x) for x in value]
        if isinstance(value, dict): return {k: replace(v) for k, v in value.items()}
        return value
    return replace(copy.deepcopy(graph))

async def archive(client, job, entry):
    if entry.get('status', {}).get('status_str') == 'error':
        update(job, 'error', status='failed', message='ComfyUI reported an execution error. Check its private log.'); return
    files = []
    for node in entry.get('outputs', {}).values():
        for key in ('images', 'gifs', 'videos'):
            for file in node.get(key, []) if isinstance(node.get(key), list) else []:
                name, folder = file.get('filename', ''), file.get('subfolder', '')
                if file.get('type', 'output') != 'output' or not name.lower().endswith('.mp4') or '/' in name or '\\' in name or '..' in name or '..' in re.split(r'[/\\]', folder): continue
                if (name, folder) not in [(x['filename'], x['subfolder']) for x in files]: files.append({'filename': name, 'subfolder': folder, 'type': 'output'})
    if not files: update(job, 'error', status='failed', message='The workflow finished without a saved MP4. Configure SaveVideo for MP4.'); return
    update(job, 'status', status='saving', message='Saving the finished MP4.')
    directory = DATA / job['id']; directory.mkdir(exist_ok=True)
    saved = []
    for index, file in enumerate(files[:8]):
        path = directory / f'{index}.mp4'; partial = path.with_suffix('.part')
        try:
            async with client.stream('GET', COMFY + '/view', params=file, timeout=120) as response:
                response.raise_for_status(); size = 0
                with partial.open('wb') as output:
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 512 * 1024 ** 2: raise RuntimeError('Output exceeds the 512 MB limit.')
                        output.write(chunk)
            if size < 12: raise RuntimeError('Empty video output.')
            partial.replace(path); saved.append({'filename': file['filename'], 'index': index, 'kind': 'video'})
        finally:
            if partial.exists(): partial.unlink()
    update(job, 'completed', status='complete', media=saved, message='Video saved. Ready to download.')

async def locate_receipt(client, job):
    queue = (await client.get(COMFY + '/queue')).json()
    for row in queue.get('queue_running', []) + queue.get('queue_pending', []):
        if len(row) > 3 and isinstance(row[3], dict) and row[3].get('client_id') == job['id']: return row[1]
    history = (await client.get(COMFY + '/history', params={'max_items': 100})).json()
    for pid, entry in history.items():
        prompt = entry.get('prompt', [])
        if len(prompt) > 3 and isinstance(prompt[3], dict) and prompt[3].get('client_id') == job['id']: return pid
    return None

async def run_job(job, graph=None, upload=None):
    submitted = graph is None
    try:
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            # Connect before submitting so the first progress event is not lost.
            ws_url = COMFY.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws?' + urlencode({'clientId': job['id']})
            try: ws = await websockets.connect(ws_url, open_timeout=10, max_size=2*1024**2)
            except Exception: ws = None  # History polling still confirms completion.
            try:
                if graph is not None:
                    response = await client.post(COMFY + '/upload/image', files={'image': upload}, data={'overwrite': 'false'}); response.raise_for_status(); info = response.json()
                    image = (info.get('subfolder', '') + '/' + info['name']).lstrip('/')
                    graph = workflow(Settings(**job['settings']), image)
                    submitted = True
                    response = await client.post(COMFY + '/prompt', json={'prompt': graph, 'client_id': job['id']})
                    if response.status_code in (400, 401, 403, 404, 422): update(job, 'error', status='failed', message='ComfyUI rejected the workflow. Verify its installed models and inputs.'); return
                    response.raise_for_status(); pid = response.json().get('prompt_id')
                    if not pid: raise RuntimeError('Missing receipt')
                    update(job, 'status', status='queued', prompt_id=pid, message='Accepted by ComfyUI.')
                if not job.get('prompt_id'):
                    pid = await locate_receipt(client, job)
                    if not pid: update(job, 'error', status='uncertain', message='Submission is unconfirmed. Check the GPU queue before retrying.'); return
                    update(job, 'status', status='queued', prompt_id=pid, message='Recovered the existing GPU job.')
                deadline = time.monotonic() + 6*3600
                while time.monotonic() < deadline:
                    if ws:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), 2)
                            if isinstance(raw, str):
                                message = json.loads(raw); data = message.get('data', {}); event = message.get('type')
                                if data.get('prompt_id') == job['prompt_id'] or (data.get('prompt_id') is None and job['status']=='running'):
                                    if event == 'executing' and data.get('node'):
                                        node_id = str(data['node']); name = graph.get(node_id, {}).get('_meta', {}).get('title', graph.get(node_id, {}).get('class_type', 'ComfyUI node')) if graph else 'ComfyUI node ' + node_id
                                        update(job, 'progress', status='running', node=name, step=0, total=0, message='Running: ' + name)
                                    elif event == 'progress': update(job, 'progress', status='running', step=data.get('value', 0), total=data.get('max', 0))
                        except asyncio.TimeoutError: pass
                        except Exception: await ws.close(); ws = None
                    else: await asyncio.sleep(2)
                    response = await client.get(COMFY + '/history/' + job['prompt_id']); response.raise_for_status(); entry = response.json().get(job['prompt_id'])
                    if entry and (entry.get('status', {}).get('completed') or entry.get('status', {}).get('status_str') == 'error'):
                        await archive(client, job, entry); return
                update(job, 'error', status='uncertain', message='The monitor timed out. The GPU job may still be running; do not resubmit.')
            finally:
                if ws: await ws.close()
    except Exception:
        update(job, 'error', status='uncertain' if submitted else 'failed', message='GPU communication or saving was interrupted. Refresh to reconcile the existing job; no automatic resubmission.' if submitted else 'The starting image could not be prepared. No workflow was submitted.')
    finally: tasks.pop(job['id'], None)

def start_task(job, graph=None, upload=None):
    if job['id'] not in tasks: tasks[job['id']] = asyncio.create_task(run_job(job, graph, upload))

@asynccontextmanager
async def lifespan(_app):
    for row in DB.execute("SELECT data FROM jobs WHERE status NOT IN ('complete','failed')").fetchall(): start_task(json.loads(row['data']))
    yield
    for task in list(tasks.values()): task.cancel()
    await asyncio.gather(*list(tasks.values()), return_exceptions=True)

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)

@app.get('/healthz')
async def healthz(): return {'service': 'JoshBox', 'running': True}

@app.get('/api/capabilities', dependencies=[Depends(auth)])
async def capabilities():
    async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
        try: (await client.get(COMFY + '/system_stats')).raise_for_status()
        except Exception: raise HTTPException(503, 'ComfyUI is not responding.')
    profiles = {}
    for model in MODELS:
        modes = {}
        for mode in ('quality', 'fast'):
            try:
                graph = template_for(mode, model); text = json.dumps(graph)
                modes[mode] = {'ready': True, 'controls': [x for x in ('width','height','frames','fps','steps','seed','negative','motion_bucket','motion_scale') if json.dumps('$'+x) in text], 'h3': any(n['class_type']=='MiniMaxH3ImageToVideo' for n in graph.values())}
            except HTTPException: modes[mode] = {'ready': False, 'controls': []}
        profiles[model] = modes
    return {'connected': True, 'profiles': profiles, 'modes': profiles['minimax_h3']}

@app.post('/api/generate', dependencies=[Depends(auth)])
async def generate(request: Request):
    if int(request.headers.get('content-length', '0')) > 14*1024**2: raise HTTPException(413, 'Image exceeds the upload limit.')
    form = await request.form()
    try:
        try: settings = Settings.model_validate_json(str(form['settings']))
        except Exception: raise HTTPException(422, 'Check the generation settings.')
        job_id = str(settings.request_id)
        existing = DB.execute('SELECT owner,data FROM jobs WHERE id=?', (job_id,)).fetchone()
        if existing:
            if existing['owner'] != settings.owner_id: raise HTTPException(404, 'Job not found')
            job = json.loads(existing['data'])
            if job['status'] not in ('complete','failed'): start_task(job)
        else:
            graph = workflow(settings, 'pending.png')
            image = form.get('image')
            if not image or not hasattr(image, 'read'): raise HTTPException(422, 'Select a starting image.')
            content = await image.read(12*1024**2 + 1)
            if len(content) > 12*1024**2: raise HTTPException(413, 'Image exceeds 12 MB.')
            ext = 'png' if content.startswith(b'\x89PNG\r\n\x1a\n') else 'jpg' if content.startswith(b'\xff\xd8\xff') else 'webp' if content[:4]==b'RIFF' and content[8:12]==b'WEBP' else None
            if not ext: raise HTTPException(422, 'Use PNG, JPG, or WebP.')
            job = {'id': job_id, 'status': 'submitting', 'settings': settings.model_dump(mode='json'), 'revision': 0, 'event': 'status', 'step': 0, 'total': 0, 'node': '', 'media': [], 'logs': []}
            try: DB.execute('INSERT INTO jobs VALUES (?,?,?,?)', (job_id, settings.owner_id, 'submitting', json.dumps(job))); DB.commit()
            except sqlite3.IntegrityError: raise HTTPException(409, 'An active generation already exists. Refresh its status.')
            start_task(job, graph, (job_id+'.'+ext, content, 'image/jpeg' if ext=='jpg' else 'image/'+ext))
        async def events():
            revision = -1
            while True:
                current = get_job(job_id, settings.owner_id)
                if current['revision'] != revision:
                    revision = current['revision']; public = {k:v for k,v in current.items() if k != 'settings'}
                    yield 'event: '+current['event']+'\ndata: '+json.dumps(public)+'\n\n'
                if current['status'] in ('complete','failed','uncertain'): break
                yield ': heartbeat\n\n'; await asyncio.sleep(1)
        return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

    finally:
        await form.close()

@app.get('/api/jobs/{job_id}', dependencies=[Depends(auth)])
async def job_status(job_id: str, owner_id: str):
    job = get_job(job_id, owner_id)
    if job['status'] not in ('complete','failed'): start_task(job)
    return {k:v for k,v in job.items() if k != 'settings'}

@app.get('/api/media/{job_id}/{index}', dependencies=[Depends(auth)])
async def media(job_id: str, index: int, owner_id: str):
    job = get_job(job_id, owner_id)
    if job['status'] != 'complete' or not 0 <= index < len(job['media']): raise HTTPException(404, 'Media not found')
    return FileResponse(DATA / job_id / f'{index}.mp4', media_type='video/mp4', filename=job['media'][index]['filename'])
