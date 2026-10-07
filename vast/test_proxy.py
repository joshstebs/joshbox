import asyncio
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

TEST_ROOT = (Path(__file__).resolve().parent.parent / 'work').resolve()
TEST_ROOT.mkdir(exist_ok=True)
TEMP = tempfile.TemporaryDirectory(dir=TEST_ROOT)
os.environ['JOSHBOX_DATA_DIR'] = TEMP.name
os.environ['VIDEO_PROXY_TOKEN'] = 'test-only-token-not-a-production-secret-123456789'
spec = importlib.util.spec_from_file_location('joshbox_proxy', Path(__file__).with_name('app.py'))
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)

GRAPH = {'1': {'class_type':'LoadImage','inputs':{'image':'$image'}}, '2':{'class_type':'MiniMaxH3ImageToVideo','inputs':{'prompt':'$prompt','width':'$width','height':'$height','length':'$frames','first_frame':['1',0]}}, '3':{'class_type':'SaveVideo','inputs':{'filename_prefix':'video/JoshBox','video':['2',0]}}}
workflow_path = Path(TEMP.name)/'quality.json'
workflow_path.write_text(json.dumps(GRAPH))
os.environ['WORKFLOW_QUALITY_PATH'] = str(workflow_path)

class Reply:
    def __init__(self,data): self.data=data; self.status_code=200
    def json(self): return self.data
    def raise_for_status(self): pass

class OutputStream:
    async def __aenter__(self): return self
    async def __aexit__(self,*args): pass
    def raise_for_status(self): pass
    async def aiter_bytes(self): yield b'\x00\x00\x00\x18ftypmp42test-output'

class ComfyFixture:
    submits=0
    def __init__(self,*args,**kwargs): pass
    async def __aenter__(self): return self
    async def __aexit__(self,*args): pass
    async def post(self,url,**kwargs):
        if url.endswith('/upload/image'): return Reply({'name':'source.png','subfolder':''})
        self.__class__.submits+=1
        self.__class__.last_graph=kwargs['json']['prompt']
        return Reply({'prompt_id':'fixture-prompt'})
    async def get(self,url,**kwargs):
        if url.endswith('/system_stats'): return Reply({'devices':[{'name':'Test GPU fixture'}]})
        return Reply({'fixture-prompt':{'status':{'completed':True,'status_str':'success'},'outputs':{'9':{'videos':[{'filename':'result.mp4','type':'output','subfolder':'video'}]}}}})
    def stream(self,*args,**kwargs): return OutputStream()

class ProxyTests(unittest.TestCase):
    def settings(self,**changes):
        return {'request_id':str(uuid4()),'owner_id':'test-owner','prompt':'A breeze through a forest','mode':'quality','model':'minimax_h3','width':1024,'height':576,'frames':124,'fps':24,'steps':20,'seed':42,**changes}

    def test_auth_and_missing_fast_profile(self):
        with TestClient(proxy.app) as client:
            self.assertEqual(client.get('/api/capabilities').status_code,401)
            self.assertEqual(client.get('/healthz').status_code,200)
        with self.assertRaises(proxy.HTTPException): proxy.template_for('fast')
        with self.assertRaises(proxy.HTTPException): proxy.template_for('quality','wan22_14b')

    def test_grid_and_graph_mapping(self):
        settings=proxy.Settings(**self.settings())
        graph=proxy.workflow(settings,'uploaded.png')
        self.assertEqual(graph['1']['inputs']['image'],'uploaded.png')
        self.assertEqual(graph['2']['inputs']['length'],124)
        self.assertEqual(GRAPH['1']['inputs']['image'],'$image')
        with self.assertRaises(proxy.HTTPException): proxy.workflow(proxy.Settings(**self.settings(frames=120)),'image.png')
        with self.assertRaises(proxy.HTTPException): proxy.workflow(proxy.Settings(**self.settings(fps=16)),'image.png')

    def test_sse_completion_is_saved_and_retries_do_not_resubmit(self):
        settings=self.settings(); headers={'Authorization':'Bearer '+os.environ['VIDEO_PROXY_TOKEN']}
        ComfyFixture.submits=0
        with patch.object(proxy.httpx,'AsyncClient',ComfyFixture),patch.object(proxy.websockets,'connect',AsyncMock(side_effect=OSError('Fixture uses history fallback'))):
            with TestClient(proxy.app) as client:
                response=client.post('/api/generate',headers=headers,data={'settings':json.dumps(settings)},files={'image':('source.png',b'\x89PNG\r\n\x1a\nfixture','image/png')})
                self.assertEqual(response.status_code,200);self.assertIn('event: completed',response.text)
                self.assertEqual(ComfyFixture.submits,1)
                job=client.get('/api/jobs/'+settings['request_id'],params={'owner_id':'test-owner'},headers=headers)
                self.assertEqual(job.json()['status'],'complete')
                saved=client.get('/api/media/'+settings['request_id']+'/0',params={'owner_id':'test-owner'},headers=headers)
                self.assertEqual(saved.status_code,200);self.assertGreater(len(saved.content),12)
                denied=client.get('/api/media/'+settings['request_id']+'/0',params={'owner_id':'another-owner'},headers=headers)
                self.assertEqual(denied.status_code,404)
                retry=client.post('/api/generate',headers=headers,data={'settings':json.dumps(settings)})
                self.assertEqual(retry.status_code,200);self.assertIn('event: completed',retry.text)
                self.assertEqual(ComfyFixture.submits,1)

    def test_single_active_job_per_owner(self):
        owner='active-fixture-owner'
        proxy.DB.execute('INSERT INTO jobs VALUES (?,?,?,?)',(str(uuid4()),owner,'uncertain','{}'));proxy.DB.commit()
        with self.assertRaises(proxy.sqlite3.IntegrityError): proxy.DB.execute('INSERT INTO jobs VALUES (?,?,?,?)',(str(uuid4()),owner,'submitting','{}'))
        proxy.DB.rollback()
        proxy.DB.execute('DELETE FROM jobs WHERE owner=?',(owner,));proxy.DB.commit()

def tearDownModule():
    proxy.DB.close()
    assert Path(TEMP.name).resolve().is_relative_to(TEST_ROOT)
    TEMP.cleanup()

if __name__=='__main__': unittest.main()
