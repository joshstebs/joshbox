"""Pinned model-library metadata shared by bootstrap and the GPU wrapper."""
import json
import os
import re
from pathlib import Path, PurePosixPath

PROJECT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = Path(os.environ.get('JOSHBOX_MODEL_MANIFEST', PROJECT/'config/models.json'))
MODEL_KEYS = ('unet_name','clip_name','vae_name','lora_name','ckpt_name')
CATEGORIES = {'diffusion_models','text_encoders','vae','loras','checkpoints','embeddings'}

def relative_path(value):
    if not isinstance(value,str) or '\\' in value or ':' in value: raise ValueError('Invalid relative model path.')
    parts=PurePosixPath(value)
    if parts.is_absolute() or not parts.parts or any(x in ('..','.') for x in value.split('/')): raise ValueError('Model paths must stay inside their library directory.')
    return Path(*parts.parts)

def load_manifest(path=MANIFEST_PATH):
    data=json.loads(Path(path).read_text(encoding='utf-8'))
    if data.get('schema_version')!=1: raise ValueError('Unsupported model manifest version.')
    assets=data.get('assets',[]);seen=set();targets={}
    for asset in assets:
        key=asset.get('id','')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,200}',key) or key in seen: raise ValueError('Asset IDs must be unique safe names.')
        seen.add(key)
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',asset.get('repo_id','')): raise ValueError('Invalid Hugging Face repository ID.')
        if not re.fullmatch(r'[a-f0-9]{40}',asset.get('revision','')): raise ValueError('Model revisions must be pinned full commit hashes.')
        if not re.fullmatch(r'[a-f0-9]{64}',asset.get('sha256','')): raise ValueError('Every asset needs a SHA-256 checksum.')
        if not isinstance(asset.get('size'),int) or asset['size']<1: raise ValueError('Every asset needs its verified size.')
        relative_path(asset['filename']);target=relative_path(asset['target'])
        if target.parts[0] not in CATEGORIES or target.suffix!='.safetensors': raise ValueError('Only safetensors in known ComfyUI model directories are supported.')
        if not re.fullmatch(r'[A-Za-z0-9_-]+',asset.get('family','')): raise ValueError('Invalid model family.')
        if asset['target'] in targets and targets[asset['target']]!=asset['sha256']: raise ValueError('Conflicting model targets.')
        targets[asset['target']]=asset['sha256']
    for profile in data.get('profiles',{}).values():
        relative_path(profile['workflow'])
        if any(key not in seen for key in profile['required_assets']): raise ValueError('Profile references an unknown model asset.')
    revision=data.get('comfyui',{}).get('revision')
    if revision is not None and not re.fullmatch(r'[a-f0-9]{40}',revision):raise ValueError('ComfyUI revision must be pinned.')
    return data

def selected_assets(manifest,profiles):
    required=set()
    for name in profiles:
        if name not in manifest['profiles']: raise ValueError('Unknown bootstrap profile: '+name)
        required.update(manifest['profiles'][name]['required_assets'])
    return [asset for asset in manifest['assets'] if asset['id'] in required]

def profile_spec(model,mode):
    manifest=load_manifest()
    return next((value for value in manifest['profiles'].values() if value['model']==model and value['mode']==mode),None)

def model_files(graph):
    categories={'unet_name':'diffusion_models','clip_name':'text_encoders','vae_name':'vae','lora_name':'loras','ckpt_name':'checkpoints'}
    return [(categories[key],value) for node in graph.values() for key,value in node['inputs'].items() if key in categories and isinstance(value,str)]

def graph_assets_present(graph,comfy_dir):
    root=Path(comfy_dir)/'models'
    for category,name in model_files(graph):
        try: path=root/category/relative_path(name)
        except ValueError: return False
        if not path.is_file(): return False
    return True
