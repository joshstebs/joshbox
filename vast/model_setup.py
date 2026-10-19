"""Pinned local video model installation. No GPU rental or provider API calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

import httpx

ROOT = Path(__file__).resolve().parent.parent
CATALOG = json.loads((ROOT / 'vast/model_catalog.json').read_text())['models']


def selected_models(value):
    names = list(dict.fromkeys(x.strip() for x in value.split(',') if x.strip()))
    if not names or any(x not in CATALOG for x in names):
        raise ValueError('JOSHBOX_MODELS must contain supported catalog model IDs.')
    return names


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def matches(path, asset):
    if not path.is_file() or path.stat().st_size != asset['size']:
        return False
    # Size alone cannot detect truncated uploads or damaged model weights.
    receipt = path.with_name(path.name + '.joshbox-verified.json')
    expected = {'size': asset['size'], 'mtime_ns': path.stat().st_mtime_ns,
                'sha256': asset['sha256']}
    try:
        if json.loads(receipt.read_text()) == expected:
            return True
    except (OSError, ValueError):
        pass
    if digest(path) != asset['sha256']:
        return False
    receipt.write_text(json.dumps(expected))
    return True


def download(client, asset, root):
    path = root / asset['path']
    path.parent.mkdir(parents=True, exist_ok=True)
    if matches(path, asset):
        print('Verified existing:', path.name)
        return path
    partial = path.with_name(path.name + '.part')
    if partial.exists() and partial.stat().st_size > asset['size']:
        raise ValueError('Oversized partial model file; inspect ' + path.name)
    offset = partial.stat().st_size if partial.exists() else 0
    if offset == asset['size']:
        if digest(partial) != asset['sha256']:
            raise ValueError('Model checksum mismatch; inspect ' + partial.name)
        partial.replace(path)
    else:
        if shutil.disk_usage(path.parent).free < asset['size'] - offset + 1024 ** 3:
            raise ValueError('Insufficient model-volume space for ' + path.name)
        headers = {'Range': f'bytes={offset}-'} if offset else {}
        token = os.environ.get('HF_TOKEN', '')
        if token:
            headers['Authorization'] = 'Bearer ' + token
        print('Downloading:', path.name)
        with client.stream('GET', asset['url'], headers=headers) as response:
            response.raise_for_status()
            resumed = offset and response.status_code == 206
            if offset and not resumed and shutil.disk_usage(path.parent).free < asset['size'] + 1024 ** 3:
                raise ValueError('The server restarted the download; more volume space is needed for ' + path.name)
            if response.status_code == 206:
                expected_start = offset if resumed else 0
                if not response.headers.get('Content-Range', '').startswith(f'bytes {expected_start}-'):
                    raise ValueError('Unexpected download range for ' + path.name)
            count = offset if resumed else 0
            with partial.open('ab' if resumed else 'wb') as output:
                for chunk in response.iter_bytes(8 * 1024 * 1024):
                    count += len(chunk)
                    if count > asset['size']:
                        raise ValueError('Model download exceeded the pinned size: ' + path.name)
                    output.write(chunk)
        if partial.stat().st_size != asset['size'] or digest(partial) != asset['sha256']:
            raise ValueError('Model size or checksum mismatch: ' + path.name)
        partial.replace(path)
    if not matches(path, asset):
        raise ValueError('Model verification failed: ' + path.name)
    return path


def install_workflows(env_file, names):
    env_file = Path(env_file)
    directory = env_file.parent / 'joshbox-workflows'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    lines = env_file.read_text().splitlines()
    # Validate all assignments before changing the runtime file or bundled copies.
    for name in names:
        for mode in CATALOG[name]['workflows']:
            key = 'WORKFLOW_' + CATALOG[name]['env'] + '_' + mode.upper() + '_PATH'
            if sum(line.startswith(key + '=') for line in lines) > 1:
                raise ValueError('Duplicate workflow setting: ' + key)
    for name in names:
        for mode, filename in CATALOG[name]['workflows'].items():
            key = 'WORKFLOW_' + CATALOG[name]['env'] + '_' + mode.upper() + '_PATH'
            dest = directory / filename
            source = ROOT / 'workflows' / filename
            if not dest.exists() or dest.read_bytes() != source.read_bytes():
                temporary = dest.with_suffix('.json.tmp')
                temporary.write_bytes(source.read_bytes())
                os.chmod(temporary, 0o600)
                temporary.replace(dest)
            matches_ = [i for i, line in enumerate(lines) if line.startswith(key + '=')]
            assignment = key + '=' + shlex.quote(str(dest.resolve()))
            if not matches_:
                lines.append(assignment)
            elif lines[matches_[0]].split('=', 1)[1].strip() in ('', "''", '""'):
                lines[matches_[0]] = assignment
    content = '\n'.join(lines) + '\n'
    if env_file.read_text() != content:
        temporary = env_file.with_suffix('.tmp')
        temporary.write_text(content, newline='\n')
        os.chmod(temporary, 0o600)
        temporary.replace(env_file)


def install_nodes(comfy, names, python):
    nodes = {n['name']: n for name in names for n in CATALOG[name].get('custom_nodes', [])}
    for name, node in nodes.items():
        destination = comfy / 'custom_nodes' / name
        if destination.exists():
            print('Preserving existing custom nodes:', name)
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(name + '.installing')
        if temporary.exists():
            raise ValueError('An interrupted custom-node install needs inspection: ' + name)
        subprocess.run(['git', 'clone', '--quiet', node['url'], str(temporary)], check=True)
        subprocess.run(['git', '-C', str(temporary), 'checkout', '--quiet', node['commit']], check=True)
        subprocess.run([python, '-m', 'pip', 'install', '-q', '-r', str(temporary / 'requirements.txt')], check=True)
        temporary.rename(destination)
        print('Installed pinned custom nodes:', name)


def sync_models(comfy, model_root, names):
    assets = {a['path']: a for name in names for a in CATALOG[name]['assets']}
    with httpx.Client(follow_redirects=True, timeout=120, trust_env=False) as client:
        for asset in assets.values():
            linked = comfy / 'models' / asset['path']
            # Reuse an existing valid ComfyUI file even if a separate volume is configured.
            if matches(linked, asset):
                print('Verified existing:', linked.name)
                continue
            target = download(client, asset, model_root)
            if target.absolute() != linked.absolute():
                linked.parent.mkdir(parents=True, exist_ok=True)
                if linked.exists() or linked.is_symlink():
                    raise ValueError('Existing model path differs from the persistent copy: ' + linked.name)
                linked.symlink_to(target.resolve())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', default=os.environ.get('JOSHBOX_MODELS', ','.join(CATALOG)))
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--sync', action='store_true')
    args = parser.parse_args()
    names = selected_models(args.models)
    install_workflows(args.env_file, names)
    if args.sync:
        comfy = Path(os.environ.get('COMFY_DIR', '/workspace/ComfyUI'))
        model_root = Path(os.environ.get('JOSHBOX_MODEL_ROOT', str(comfy / 'models')))
        install_nodes(comfy, names, os.environ.get('COMFY_PYTHON', 'python3'))
        sync_models(comfy, model_root, names)
    print('Configured:', ', '.join(CATALOG[name]['name'] for name in names))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, httpx.HTTPError, subprocess.SubprocessError):
        # Network exceptions can contain signed URLs; never copy them to logs.
        print('Model setup failed. Check volume space, model integrity, private Hugging Face access, and node dependencies.', file=sys.stderr)
        sys.exit(1)
