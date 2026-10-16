import json
import os
from pathlib import Path
import shlex
import tempfile
import unittest
from unittest.mock import patch

from install_wan5_workflow import install
from test_proxy import proxy

ROOT = Path(__file__).resolve().parent.parent


class Wan5Tests(unittest.TestCase):
    def test_exact_mappings_and_unmodified_links(self):
        graph = json.loads((ROOT / 'workflows/wan22-5b-quality.json').read_text())
        expected = {'6': {'text': '$prompt'}, '7': {'text': '$negative'},
                    '3': {'seed': '$seed', 'steps': '$steps', 'cfg': 5, 'sampler_name': 'uni_pc', 'latent_image': ['55', 0]},
                    '55': {'width': '$width', 'height': '$height', 'length': '$frames', 'vae': ['39', 0]},
                    '57': {'fps': '$fps', 'images': ['8', 0]},
                    '37': {'unet_name': 'wan2.2_ti2v_5B_fp16.safetensors'},
                    '38': {'clip_name': 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'},
                    '39': {'vae_name': 'wan2.2_vae.safetensors'}}
        self.assertEqual(len(graph), 11)
        for node, inputs in expected.items():
            for key, value in inputs.items():
                self.assertEqual(graph[node]['inputs'][key], value)
        self.assertNotIn('$image', json.dumps(graph))
        self.assertEqual(graph['58']['inputs']['video'], ['57', 0])

    def test_install_rerun_and_custom_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / 'private env'
            env.write_text('VIDEO_PROXY_TOKEN=test-fixture\nWORKFLOW_WAN5_QUALITY_PATH=\nWORKFLOW_WAN5_FAST_PATH=\n')
            destination = install(env)
            first = env.read_text()
            install(env)
            self.assertEqual(first, env.read_text())
            self.assertEqual(shlex.split(first.splitlines()[1].split('=', 1)[1]), [str(destination.resolve())])
            self.assertEqual(destination.read_bytes(), (ROOT / 'workflows' / destination.name).read_bytes())
            env.write_text('WORKFLOW_WAN5_QUALITY_PATH=/custom/quality.json\nWORKFLOW_WAN5_FAST_PATH=/custom/fast.json\n')
            before = env.read_bytes()
            install(env)
            self.assertEqual(before, env.read_bytes())

    def test_image_generation_fails_closed_before_submission(self):
        with patch.dict(os.environ, {'WORKFLOW_WAN5_QUALITY_PATH': str(ROOT / 'workflows/wan22-5b-quality.json'), 'WORKFLOW_WAN5_FAST_PATH': ''}):
            with self.assertRaises(proxy.HTTPException) as error:
                proxy.workflow(proxy.Settings(request_id='00000000-0000-0000-0000-000000000001', owner_id='fixture', prompt='A forest breeze', model='wan22_5b', frames=121, seed=42), 'uploaded.png')
            self.assertIn('no starting-image connection', error.exception.detail)
            with self.assertRaises(proxy.HTTPException):
                proxy.template_for('fast', 'wan22_5b')
