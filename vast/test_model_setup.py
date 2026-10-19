import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx
from model_setup import CATALOG, ROOT, download, install_workflows, matches, selected_models, selected_installed_models
from workflow_readiness import fixed_controls, missing_requirements
from test_proxy import proxy


class ModelSetupTests(unittest.TestCase):
    def asset(self, content):
        return {'path':'diffusion_models/test.safetensors', 'size':len(content),
                'sha256':hashlib.sha256(content).hexdigest(), 'url':'https://huggingface.co/test/model'}

    def test_catalog_has_all_requested_models_and_pinned_verified_assets(self):
        self.assertEqual(set(CATALOG), {'wan22_5b','wan22_14b','ltx13b','hunyuan15','minimax_h3'})
        for model in CATALOG.values():
            for asset in model['assets']:
                self.assertRegex(asset['url'], r'https://huggingface.co/[^/]+/[^/]+/resolve/[0-9a-f]{40}/')
                self.assertRegex(asset['sha256'], r'^[0-9a-f]{64}$')
                self.assertGreater(asset['size'], 0)
                self.assertNotIn('..', Path(asset['path']).parts)
        self.assertEqual(selected_models('minimax_h3,ltx13b,minimax_h3'), ['minimax_h3','ltx13b'])
        with self.assertRaises(ValueError): selected_models('unsupported')

    def test_automatic_selection_only_includes_complete_local_catalog_packs(self):
        with tempfile.TemporaryDirectory() as folder:
            comfy = Path(folder)
            self.assertEqual(selected_installed_models('', comfy), [])
            with patch('model_setup.CATALOG', {'fixture': {'name':'fixture','assets':[{'path':'diffusion_models/model.safetensors','size':3}]}}):
                path = comfy / 'models/diffusion_models/model.safetensors'
                path.parent.mkdir(parents=True)
                path.write_bytes(b'abc')
                self.assertEqual(selected_installed_models('', comfy), ['fixture'])
                self.assertEqual(selected_installed_models('fixture', comfy), ['fixture'])
    def test_complete_download_rerun_never_uses_network_and_rechecks_corruption(self):
        content = b'complete-model-fixture'
        asset = self.asset(content)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            calls = []
            def handler(request):
                calls.append(request)
                return httpx.Response(200, content=content)
            with httpx.Client(transport=httpx.MockTransport(handler)) as client:
                path = download(client, asset, root)
                self.assertEqual(path.read_bytes(), content)
                download(client, asset, root)
                self.assertEqual(len(calls), 1)
                path.write_bytes(b'x' * len(content))
                self.assertFalse(matches(path, asset))

    def test_partial_resume_and_range_ignored_do_not_duplicate_bytes(self):
        content = b'complete-model-fixture'
        for resume in (True, False):
            with self.subTest(resume=resume), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                partial = root / 'diffusion_models/test.safetensors.part'
                partial.parent.mkdir()
                partial.write_bytes(content[:5])
                def handler(request):
                    self.assertEqual(request.headers['Range'], 'bytes=5-')
                    return httpx.Response(206, headers={'Content-Range':f'bytes 5-{len(content)-1}/{len(content)}'}, content=content[5:]) if resume else httpx.Response(200, content=content)
                with httpx.Client(transport=httpx.MockTransport(handler)) as client:
                    path = download(client, self.asset(content), root)
                self.assertEqual(path.read_bytes(), content)
                self.assertFalse(partial.exists())

    def test_bad_download_never_replaces_existing_model(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'diffusion_models/test.safetensors'
            target.parent.mkdir()
            target.write_bytes(b'operator-existing')
            with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b'wrong'))) as client:
                with self.assertRaises(ValueError): download(client, self.asset(b'right'), root)
            self.assertEqual(target.read_bytes(), b'operator-existing')

    def test_install_rerun_preserves_custom_paths_and_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            env = Path(folder) / 'runtime.env'
            env.write_text('VIDEO_PROXY_TOKEN=test-fixture\nWORKFLOW_MINIMAX_QUALITY_PATH=/custom/h3.json\n')
            install_workflows(env, list(CATALOG))
            before = env.read_bytes()
            install_workflows(env, list(CATALOG))
            self.assertEqual(env.read_bytes(), before)
            self.assertIn('WORKFLOW_MINIMAX_QUALITY_PATH=/custom/h3.json', env.read_text())
            self.assertIn('VIDEO_PROXY_TOKEN=test-fixture', env.read_text())
            self.assertIn('WORKFLOW_MINIMAX_FAST_PATH=', env.read_text())
            env.write_text('WORKFLOW_LTX13_FAST_PATH=\nWORKFLOW_LTX13_FAST_PATH=/custom/file\n')
            before = env.read_bytes()
            with self.assertRaises(ValueError): install_workflows(env, ['ltx13b'])
            self.assertEqual(env.read_bytes(), before)

    def test_workflows_have_connected_images_valid_links_and_matching_model_assets(self):
        for model in CATALOG.values():
            available = {Path(a['path']).name for a in model['assets']}
            for filename in model['workflows'].values():
                graph = json.loads((ROOT / 'workflows' / filename).read_text())
                self.assertIn('"$image"', json.dumps(graph))
                self.assertIn('"$prompt"', json.dumps(graph))
                def check(value):
                    if isinstance(value, list) and len(value)==2 and isinstance(value[0], str) and isinstance(value[1], int):
                        self.assertIn(value[0], graph)
                    elif isinstance(value, dict):
                        for v in value.values(): check(v)
                for node in graph.values():
                    check(node['inputs'])
                    for key, value in node['inputs'].items():
                        if key in ('ckpt_name','unet_name','clip_name','clip_name1','clip_name2','vae_name','lora_name'):
                            self.assertIn(value, available, (filename, key))
                self.assertTrue(any(n['class_type']=='SaveVideo' for n in graph.values()))

    def test_ready_requires_real_nodes_and_loader_files_and_fixed_schedules_are_reported(self):
        graph = {'1':{'class_type':'LoraLoaderModelOnly','inputs':{'model':['2',0],'lora_name':'turbo.safetensors','strength_model':1}},'2':{'class_type':'BasicScheduler','inputs':{'steps':8}}}
        info = {'LoraLoaderModelOnly':{'input':{'required':{'model':['MODEL'], 'lora_name':[['turbo.safetensors']], 'strength_model':['FLOAT']}}},'BasicScheduler':{'input':{'required':{'steps':['INT']}}}}
        self.assertEqual(missing_requirements(graph, info), [])
        self.assertEqual(fixed_controls(graph), {'steps':8})
        info['LoraLoaderModelOnly']['input']['required']['lora_name']=[[]]
        self.assertIn('Model file: turbo.safetensors', missing_requirements(graph, info))
        self.assertIn('Node: LoraLoaderModelOnly', missing_requirements(graph, {}))
        h = json.loads((ROOT/'workflows/hunyuan15-quality.json').read_text())
        self.assertEqual(fixed_controls(h), {'fps':24,'steps':50})

    def test_each_model_renders_concrete_image_prompt_seed_and_model_specific_settings(self):
        for model, frames, steps, fps, width, height in [
            ('minimax_h3',124,20,24,1344,768),('hunyuan15',121,50,24,1280,720),
            ('ltx13b',97,8,24,768,512),('wan22_14b',81,20,16,1024,576)]:
            for mode, filename in CATALOG[model]['workflows'].items():
                if model=='minimax_h3' and mode=='fast': steps=8
                key='WORKFLOW_'+CATALOG[model]['env']+'_'+mode.upper()+'_PATH'
                with self.subTest(model=model,mode=mode), patch.dict(os.environ, {key:str(ROOT/'workflows'/filename)}):
                    settings=proxy.Settings(request_id='00000000-0000-0000-0000-000000000001',owner_id='fixture',prompt='A breeze moves through a forest',model=model,mode=mode,width=width,height=height,frames=frames,steps=steps,fps=fps,seed=42)
                    graph=proxy.workflow(settings,'uploaded.png')
                    self.assertIn('uploaded.png',json.dumps(graph))
                    self.assertNotIn('"$image"',json.dumps(graph))
                    self.assertNotIn('"$prompt"',json.dumps(graph))
                    self.assertTrue(any(n['inputs'].get('noise_seed')==42 for n in graph.values()))
                    fixed=fixed_controls(json.loads((ROOT/'workflows'/filename).read_text()))
                    if 'steps' in fixed:
                        with self.assertRaises(proxy.HTTPException): proxy.workflow(settings.model_copy(update={'steps':3}),'uploaded.png')
                    if 'fps' in fixed:
                        with self.assertRaises(proxy.HTTPException): proxy.workflow(settings.model_copy(update={'fps':16}),'uploaded.png')
