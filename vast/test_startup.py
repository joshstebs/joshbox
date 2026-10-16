"""Readiness must require the authenticated backend, including on retries."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import httpx
from verify_capabilities import verify


class StartupReadinessTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('bash'), 'Bash is required for the downloader check')
    def test_installed_models_need_no_download_or_free_space_check(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for subdir, name in [('diffusion_models', 'wan2.2_ti2v_5B_fp16.safetensors'), ('text_encoders', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'), ('vae', 'wan2.2_vae.safetensors')]:
                path = root / 'models' / subdir / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            # Simulate complete existing model sizes and an unavailable disk/network.
            # A rerun must finish without consulting either dependency.
            script = '''
stat() { printf '10000000000\\n'; }
curl() { printf 'unexpected network call\\n' >&2; return 1; }
df() { printf 'unexpected disk check\\n' >&2; return 1; }
source "$1"
'''
            env = dict(os.environ, COMFY_DIR=root.as_posix())
            result = subprocess.run(['bash', '-c', script, 'test', Path(__file__).with_name('bootstrap_wan22_5b.sh').as_posix()], env=env, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.count('Already present:'), 3)

    def test_connected_backend_and_token_stay_in_header(self):
        with patch.dict(os.environ, {'VIDEO_PROXY_TOKEN': 'test-' * 8}):
            response = httpx.Response(200, json={'connected': True}, request=httpx.Request('GET', 'https://example.com'))
            with patch('verify_capabilities.httpx.get', return_value=response) as get:
                self.assertTrue(verify('https://example.com/'))
                args, kwargs = get.call_args
                self.assertEqual(args, ('https://example.com/api/capabilities',))
                self.assertEqual(kwargs['headers']['Authorization'], 'Bearer ' + 'test-' * 8)
                self.assertFalse(kwargs['follow_redirects'])

    def test_unready_malformed_unauthorized_and_redirect_are_not_ready(self):
        with patch.dict(os.environ, {'VIDEO_PROXY_TOKEN': 'test-' * 8}):
            for status, value in [(200, {'connected': False}), (200, []), (200, {'connected': 'true'}), (401, {}), (302, {})]:
                with self.subTest(status=status, value=value):
                    response = httpx.Response(status, json=value, request=httpx.Request('GET', 'https://example.com'))
                    with patch('verify_capabilities.httpx.get', return_value=response):
                        self.assertFalse(verify('https://example.com'))

    def test_missing_token_and_timeout_fail_without_disclosing_response(self):
        with patch.dict(os.environ, {'VIDEO_PROXY_TOKEN': ''}):
            with patch('verify_capabilities.httpx.get') as get:
                self.assertFalse(verify('https://example.com'))
                get.assert_not_called()
        with patch.dict(os.environ, {'VIDEO_PROXY_TOKEN': 'test-' * 8}):
            with patch('verify_capabilities.httpx.get', side_effect=httpx.ReadTimeout('timeout')):
                self.assertFalse(verify('https://example.com'))
