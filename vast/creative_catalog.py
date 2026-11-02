"""Trusted on-disk catalogue for optional named workflows and model-scoped LoRA slots.

Only the operator installs files and edits the catalogue. User input selects IDs, never paths.
"""
import json
import os
import re
from pathlib import Path

from fastapi import HTTPException

ID = re.compile(r'^[a-z0-9][a-z0-9_-]{0,63}$')
SAFE_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*[.](?:safetensors|pt|ckpt)$", re.I)
ALLOWED_MODELS = {'minimax_h3','wan22_14b','wan22_5b','ltx13b','ltx23','hunyuan15'}
ALLOWED_MODES = {'fast','quality'}
LORA_NODES = {'LoraLoader','LoraLoaderModelOnly','LoraLoaderModelOnlyAdvanced'}

def read_catalog():
    path = os.environ.get('JOSHBOX_WORKFLOW_CATALOG_PATH', '').strip()
    if not path:
        return {'workflows': [], 'loras': []}
    try:
        data = json.loads(Path(path).read_text())
        workflows, loras = data.get('workflows', []), data.get('loras', [])
        if not isinstance(workflows, list) or not isinstance(loras, list) or len(workflows)>40 or len(loras)>80:
            raise ValueError('Catalogue too large.')
        if len({x['id'] for x in workflows}) != len(workflows) or len({x['id'] for x in loras}) != len(loras):
            raise ValueError('Duplicate catalogue ID.')
        for entry in workflows:
            if (not ID.fullmatch(entry['id']) or entry['model'] not in ALLOWED_MODELS
                or entry['mode'] not in ALLOWED_MODES or not isinstance(entry['name'], str)
                or not 1 <= len(entry['name']) <= 80 or not Path(entry['path']).is_absolute()):
                raise ValueError('Invalid workflow entry.')
        for entry in loras:
            if (not ID.fullmatch(entry['id']) or entry['model'] not in ALLOWED_MODELS
                or not SAFE_FILENAME.fullmatch(entry['filename'])
                or not isinstance(entry['name'], str) or not 1 <= len(entry['name']) <= 80):
                raise ValueError('Invalid LoRA entry.')
        return {'workflows': workflows, 'loras': loras}
    except Exception:
        raise HTTPException(503, 'The operator-managed workflow catalogue needs repair.')

def resolve_workflow(catalog, model, mode, workflow_id, default_path):
    if not workflow_id or workflow_id == 'default':
        return default_path
    chosen = next((w for w in catalog['workflows'] if w['id'] == workflow_id), None)
    if not chosen or chosen['model'] != model or chosen['mode'] != mode:
        raise HTTPException(422, 'This workflow is not registered for the selected model and mode.')
    return chosen['path']

def lora_slots(graph):
    # Only an explicit placeholder inside a recognised local ComfyUI loader is editable.
    return any(
        node.get('class_type') in LORA_NODES
        and node.get('inputs', {}).get('lora_name') == '$lora_name'
        and node.get('inputs', {}).get('strength_model') == '$lora_strength'
        for node in graph.values()
    )

def resolve_lora(catalog, model, graph, lora_id, strength):
    if not lora_id:
        if lora_slots(graph):
            raise HTTPException(422, 'Select an installed LoRA for this workflow.')
        return {}
    if not lora_slots(graph):
        raise HTTPException(422, 'This workflow has no editable LoRA loader. Choose a compatible LoRA workflow.')
    entry = next((l for l in catalog['loras'] if l['id'] == lora_id and l['model'] == model), None)
    if not entry:
        raise HTTPException(422, 'That LoRA is not approved for this model.')
    if not 0 <= strength <= 2:
        raise HTTPException(422, 'LoRA strength must be between 0 and 2.')
    return {'$lora_name': entry['filename'], '$lora_strength': strength}

def usable_loras(catalog, model, graph, object_info):
    if not lora_slots(graph): return []
    choices = set()
    for kind in LORA_NODES:
        try:
            raw = object_info[kind]['input']['required']['lora_name'][0]
            if isinstance(raw,list): choices.update(raw)
        except (KeyError,TypeError,IndexError): pass
    return [{'id': l['id'], 'name':l['name']} for l in catalog['loras']
            if l['model']==model and l['filename'] in choices]
