"""Check real ComfyUI nodes and loader choices, not only local JSON presence."""
LOADER_KEYS = {'ckpt_name', 'unet_name', 'clip_name', 'clip_name1', 'clip_name2', 'vae_name', 'lora_name'}


def fixed_controls(graph):
    import json
    text = json.dumps(graph)
    fixed = {}
    for key in ('fps', 'steps'):
        if json.dumps('$' + key) in text:
            continue
        values = [n['inputs'][key] for n in graph.values()
                  if key in n['inputs'] and isinstance(n['inputs'][key], (int, float))]
        if key == 'steps' and not values:
            values = [len(n['inputs']['sigmas'].split(',')) - 1 for n in graph.values()
                      if n['class_type'] == 'ManualSigmas' and isinstance(n['inputs'].get('sigmas'), str)]
        if values and len(set(values)) == 1:
            fixed[key] = values[0]
    return fixed


def missing_requirements(graph, object_info):
    missing = []
    if not isinstance(object_info, dict):
        return ['ComfyUI node information unavailable']
    for node in graph.values():
        kind = node['class_type']
        info = object_info.get(kind)
        if not isinstance(info, dict):
            missing.append('Node: ' + kind)
            continue
        groups = info.get('input', {})
        schema = {**groups.get('required', {}), **groups.get('optional', {})}
        for key in groups.get('required', {}):
            if key not in node['inputs']:
                missing.append('Input: ' + kind + '.' + key)
        for key, value in node['inputs'].items():
            if key not in LOADER_KEYS or not isinstance(value, str) or value.startswith('$'):
                continue
            definition = schema.get(key, [])
            choices = definition[0] if definition else None
            if not isinstance(choices, list) or value not in choices:
                missing.append('Model file: ' + value)
    return sorted(set(missing))
