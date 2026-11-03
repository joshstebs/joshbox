import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from creative_catalog import read_catalog, resolve_workflow, resolve_lora, lora_slots, usable_loras

GRAPH = {
    '1': {'class_type': 'LoadImage', 'inputs': {'image': '$image'}},
    '2': {'class_type': 'LoraLoaderModelOnly', 'inputs': {
        'model': ['4', 0], 'lora_name': '$lora_name', 'strength_model': '$lora_strength'
    }},
}
CATALOG = {
    'workflows': [{'id': 'h3-pov', 'name': 'H3 POV', 'model': 'minimax_h3',
                   'mode': 'quality', 'path': '/workspace/joshbox-workflows/h3-pov.json'}],
    'loras': [{'id': 'h3-pov-lora', 'name': 'H3 POV', 'model': 'minimax_h3',
               'filename': 'h3-pov.safetensors'}],
}

class CatalogTests(unittest.TestCase):
    def test_no_manifest_is_safe_and_empty(self):
        with patch.dict(os.environ, {'JOSHBOX_WORKFLOW_CATALOG_PATH': ''}):
            self.assertEqual(read_catalog(), {'workflows': [], 'loras': []})

    def test_manifest_is_operator_registered_not_user_supplied(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            path.write_text(json.dumps(CATALOG))
            with patch.dict(os.environ, {'JOSHBOX_WORKFLOW_CATALOG_PATH': str(path)}):
                catalog = read_catalog()
            self.assertEqual(resolve_workflow(catalog,'minimax_h3','quality','h3-pov','default.json'),
                             '/workspace/joshbox-workflows/h3-pov.json')
            with self.assertRaises(HTTPException):
                resolve_workflow(catalog,'wan22_14b','quality','h3-pov','default.json')
            with self.assertRaises(HTTPException):
                resolve_workflow(catalog,'minimax_h3','quality','../../secrets','default.json')

    def test_only_compatible_existing_lora_is_selectable(self):
        self.assertTrue(lora_slots(GRAPH))
        values = resolve_lora(CATALOG,'minimax_h3',GRAPH,'h3-pov-lora',0.65)
        self.assertEqual(values, {'$lora_name':'h3-pov.safetensors','$lora_strength':0.65})
        with self.assertRaises(HTTPException):
            resolve_lora(CATALOG,'wan22_14b',GRAPH,'h3-pov-lora',1.0)
        with self.assertRaises(HTTPException):
            resolve_lora(CATALOG,'minimax_h3',GRAPH,'unknown',1.0)
        with self.assertRaises(HTTPException):
            resolve_lora(CATALOG,'minimax_h3',GRAPH,'h3-pov-lora',3.0)
        with self.assertRaises(HTTPException):
            resolve_lora(CATALOG,'minimax_h3',GRAPH,'',1.0)

    def test_not_advertised_without_installed_loader_file(self):
        info = {'LoraLoaderModelOnly': {'input': {'required': {'lora_name': [['h3-pov.safetensors']]}}}}
        self.assertEqual(len(usable_loras(CATALOG,'minimax_h3',GRAPH,info)),1)
        self.assertEqual(usable_loras(CATALOG,'wan22_14b',GRAPH,info),[])
        self.assertEqual(usable_loras(CATALOG,'minimax_h3',GRAPH,{}),[])

if __name__ == '__main__':
    unittest.main()
