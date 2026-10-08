"""Download only selected, pinned assets; verify hashes; create model links.

Public models never receive HF_TOKEN. Private assets are opt-in and restricted
to the configured private repository. No weights or tokens belong in GitHub.
"""
import argparse
import hashlib
import json
import os
import shutil
import threading
import time
import re
from pathlib import Path

from model_library import load_manifest,relative_path,selected_assets

def atomic_json(path,value):
    path=Path(path);path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.tmp');temp.write_text(json.dumps(value,indent=2),encoding='utf-8');os.chmod(temp,0o600);temp.replace(path)

def checksum(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(8*1024**2),b''): h.update(chunk)
    return h.hexdigest()

def verify(path,asset,receipt_dir):
    path=Path(path)
    if not path.is_file() or path.stat().st_size!=asset['size']: return False
    record=Path(receipt_dir)/(asset['sha256']+'.json');stat=path.stat()
    identity={'size':stat.st_size,'mtime_ns':stat.st_mtime_ns,'sha256':asset['sha256'],'path':str(path.resolve())}
    try:
        if json.loads(record.read_text(encoding='utf-8'))==identity:return True
    except (OSError,ValueError):pass
    if checksum(path)!=asset['sha256']:return False
    atomic_json(record,identity);return True

def link_model(target,source,asset,receipt_dir):
    target=Path(target);source=Path(source).resolve();target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists() or target.is_symlink():
        if target.is_file() and verify(target,asset,receipt_dir):return
        raise ValueError('An existing model target differs from the manifest; it was preserved: '+asset['target'])
    target.symlink_to(source)

def sync(manifest,profiles,comfy_dir,library_dir,download,state_path,private_manifest=None,hf_token=None,max_gb=100):
    assets=selected_assets(manifest,profiles)
    if private_manifest:
        private=load_manifest(private_manifest);expected=os.environ.get('HF_ASSETS_REPO','')
        if not expected or not hf_token:raise ValueError('Private assets require a configured repository ID and read token.')
        if any(not a.get('private') or a['repo_id']!=expected for a in private['assets']):raise ValueError('Private assets must belong to the configured private repository.')
        assets+=private['assets']
    library=Path(library_dir);library.mkdir(mode=0o700,parents=True,exist_ok=True)
    receipts=library/'.checksums';models=Path(comfy_dir)/'models';models.mkdir(parents=True,exist_ok=True)
    total=sum(a['size'] for a in assets)
    if total>max_gb*1e9:raise ValueError('Selected assets exceed the model-download size budget.')
    pending=[]
    for asset in assets:
        target=models/relative_path(asset['target'])
        if target.is_file() and verify(target,asset,receipts):continue
        if target.exists() or target.is_symlink():raise ValueError('Existing model was preserved because it does not match: '+asset['target'])
        pending.append(asset)
    needed=sum(a['size'] for a in pending)
    if shutil.disk_usage(library).free<needed+2*1024**3:raise ValueError('Not enough free disk space for selected models plus a 2 GiB margin.')
    state={'state':'Downloading Models','message':'Preparing the selected model library.','completed_assets':0,'total_assets':len(pending),'completed_bytes':0,'total_bytes':needed,'profiles':profiles,'updated_at':time.time(),'pid':os.getpid()}
    lock=threading.Lock();stop=threading.Event()
    def emit():
        with lock:state['updated_at']=time.time();atomic_json(state_path,state)
    def heartbeat():
        while not stop.wait(10):emit()
    heartbeat_thread=threading.Thread(target=heartbeat,daemon=True);heartbeat_thread.start();emit()
    try:
        for asset in pending:
            with lock:state['message']='Downloading/verifying '+asset['id']
            emit()
            token=hf_token if asset.get('private') else False
            # Cache contains the only weight copy. Human-friendly library and ComfyUI paths link to it.
            source=Path(download(repo_id=asset['repo_id'],filename=asset['filename'],revision=asset['revision'],cache_dir=str(library/'.hf-cache'),token=token))
            if not verify(source,asset,receipts):raise ValueError('Downloaded model failed integrity verification: '+asset['id'])
            library_target=library/asset['family']/relative_path(asset['target'])
            link_model(library_target,source,asset,receipts);link_model(models/relative_path(asset['target']),source,asset,receipts)
            with lock:state['completed_assets']+=1;state['completed_bytes']+=asset['size']
            emit()
        with lock:state.update(state='Starting',message='Model library verified. Waiting for ComfyUI startup.')
        emit();return {'profiles':profiles,'assets':len(assets),'downloaded_assets':len(pending),'bytes':needed}
    except Exception:
        with lock:state.update(state='Error',message='Model setup failed. Check the private bootstrap log; no existing model was overwritten.')
        emit();raise
    finally:stop.set();heartbeat_thread.join(timeout=2)

def main():
    os.umask(0o077);os.environ['HF_HUB_DISABLE_TELEMETRY']='1';os.environ['HF_DEBUG']='0'
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);parser.add_argument('--profiles');parser.add_argument('--comfy-dir',required=True);parser.add_argument('--library-dir',default='/workspace/joshbox-models');parser.add_argument('--state-path',default='/workspace/joshbox-data/bootstrap-state.json');parser.add_argument('--private-manifest');parser.add_argument('--plan',action='store_true');parser.add_argument('--max-download-gb',type=float,default=100)
    args=parser.parse_args();manifest=load_manifest(args.manifest);profiles=args.profiles.split(',') if args.profiles else manifest['default_bootstrap_profiles'];assets=selected_assets(manifest,profiles)
    if args.plan:print(json.dumps({'profiles':profiles,'assets':len(assets),'total_bytes':sum(a['size'] for a in assets),'downloads_started':False}));return
    from huggingface_hub import hf_hub_download
    try:
        private_manifest=args.private_manifest
        revision=os.environ.get('HF_ASSETS_REVISION','')
        if not private_manifest and revision:
            repo=os.environ.get('HF_ASSETS_REPO','');token=os.environ.get('HF_TOKEN','')
            filename=os.environ.get('HF_ASSETS_MANIFEST','config/private-assets.json')
            if not re.fullmatch(r'[a-f0-9]{40}',revision) or not repo or not token:raise ValueError('Pinned private asset revision and read token are required.')
            relative_path(filename)
            private_manifest=hf_hub_download(repo_id=repo,filename=filename,revision=revision,cache_dir=str(Path(args.library_dir)/'.hf-cache'),token=token)
        result=sync(manifest,profiles,args.comfy_dir,args.library_dir,hf_hub_download,args.state_path,private_manifest,os.environ.get('HF_TOKEN'),args.max_download_gb)
    except Exception as error:
        # Never print provider exceptions which may contain authenticated redirect URLs.
        print('Model setup failed. Check disk space, repository access, pinned revisions, and existing model conflicts.');raise SystemExit(1) from None
    print(json.dumps(result))

if __name__=='__main__':main()
