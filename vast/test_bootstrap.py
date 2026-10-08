import copy,hashlib,json,os,shutil,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from model_library import load_manifest,relative_path,selected_assets,PROJECT
from sync_models import sync

TEST_ROOT=PROJECT/'work';TEST_ROOT.mkdir(exist_ok=True)
PAYLOAD=b'fixture-safetensor-content'
def manifest():
    asset={'id':'fixture.v1','family':'wan22','repo_id':'Comfy-Org/Fixture','revision':'a'*40,'filename':'weights/fixture.safetensors','target':'diffusion_models/fixture.safetensors','size':len(PAYLOAD),'sha256':hashlib.sha256(PAYLOAD).hexdigest(),'private':False}
    return {'schema_version':1,'assets':[asset],'default_bootstrap_profiles':['fast'],'profiles':{'fast':{'workflow':'workflows/fixture.json','required_assets':['fixture.v1']}}}

class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=TEST_ROOT);self.root=Path(self.temp.name).resolve();self.calls=[]
        self.file=self.root/'cache.safetensors';self.file.write_bytes(PAYLOAD)
    def tearDown(self):
        self.assertTrue(self.root.is_relative_to(TEST_ROOT.resolve()));self.temp.cleanup()
    def download(self,**kwargs):self.calls.append(kwargs);return self.file
    def run_sync(self,data=None,**kwargs):
        # Linux CI tests actual links. Windows fixtures copy only small test bytes.
        def copy_link(target,source,**_):shutil.copyfile(source,target)
        context=patch.object(Path,'symlink_to',copy_link) if os.name=='nt' else patch.dict(os.environ,{})
        with context:return sync(data or manifest(),['fast'],self.root/'comfy',self.root/'library',self.download,self.root/'state.json',**kwargs)
    def test_public_download_never_receives_private_token_and_warm_boot_skips(self):
        first=self.run_sync(hf_token='private-fixture-token');self.assertEqual(first['downloaded_assets'],1);self.assertIs(self.calls[0]['token'],False)
        self.assertEqual((self.root/'comfy/models/diffusion_models/fixture.safetensors').read_bytes(),PAYLOAD)
        second=self.run_sync(hf_token='private-fixture-token');self.assertEqual(second['downloaded_assets'],0);self.assertEqual(len(self.calls),1)
        self.assertEqual(json.loads((self.root/'state.json').read_text())['state'],'Starting')
    def test_wrong_checksum_never_installs_or_reports_ready(self):
        data=manifest();data['assets'][0]['sha256']='0'*64
        with self.assertRaises(ValueError):self.run_sync(data)
        self.assertFalse((self.root/'comfy/models/diffusion_models/fixture.safetensors').exists())
        self.assertEqual(json.loads((self.root/'state.json').read_text())['state'],'Error')
    def test_existing_conflicting_file_is_preserved(self):
        target=self.root/'comfy/models/diffusion_models/fixture.safetensors';target.parent.mkdir(parents=True);target.write_bytes(b'existing-user-model')
        with self.assertRaises(ValueError):self.run_sync()
        self.assertEqual(target.read_bytes(),b'existing-user-model');self.assertEqual(self.calls,[])
    def test_path_traversal_and_unpinned_revision_are_rejected(self):
        for value in ('../secret','/absolute','loras/../../file','C:\\secret','loras/./file'):
            with self.assertRaises(ValueError):relative_path(value)
        path=self.root/'manifest.json';data=manifest();data['assets'][0]['revision']='main';path.write_text(json.dumps(data))
        with self.assertRaises(ValueError):load_manifest(path)
    def test_download_budget_rejects_before_network(self):
        with self.assertRaises(ValueError):self.run_sync(max_gb=0)
        self.assertEqual(self.calls,[])
    def test_private_token_cannot_be_sent_to_another_repository(self):
        private=manifest();private['assets'][0].update(private=True,repo_id='OtherOwner/Private')
        path=self.root/'private.json';path.write_text(json.dumps(private))
        with patch.dict(os.environ,{'HF_ASSETS_REPO':'GodofThrones/joshbox-assets'}):
            with self.assertRaises(ValueError):self.run_sync(private_manifest=path,hf_token='private-fixture-token')
        self.assertEqual(self.calls,[])
    def test_real_manifest_and_workflows_are_complete(self):
        data=load_manifest(PROJECT/'config/models.json');assets={a['id']:a for a in data['assets']}
        for name,profile in data['profiles'].items():
            graph=json.loads((PROJECT/profile['workflow']).read_text());self.assertTrue(graph)
            text=json.dumps(graph);self.assertIn('$prompt',text);self.assertIn('$image',text)
            required={assets[k]['target'].split('/')[-1] for k in profile['required_assets']}
            for node in graph.values():
                for key,value in node['inputs'].items():
                    if key in ('unet_name','clip_name','vae_name','lora_name'):self.assertIn(value,required)
                    if isinstance(value,list) and len(value)==2 and isinstance(value[0],str):self.assertIn(value[0],graph)
        self.assertEqual(data['default_profile'],'wan22-fast')
        self.assertEqual(len(selected_assets(data,data['default_bootstrap_profiles'])),6)

if __name__=='__main__':unittest.main()
