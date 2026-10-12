"""Apply the bundled Lua test update to an extracted matching reference."""
import hashlib
import json
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
updates = Path(__file__).resolve().parent.parent / 'reference-update'
manifest = json.loads((updates / 'manifest.json').read_text())
pending = []
for item in manifest['files']:
    target = (root / item['path']).resolve()
    source = (updates / item['path']).resolve()
    if not target.is_relative_to(root) or not source.is_relative_to(updates):
        raise SystemExit('Update path escapes its directory.')
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != item['updated_sha256']:
        raise SystemExit('Bundled update checksum mismatch: ' + item['path'])
    current = hashlib.sha256(target.read_bytes()).hexdigest()
    if current not in [item['baseline_sha256'], item['updated_sha256'], *item.get('previous_update_sha256', [])]:
        raise SystemExit('Wrong reference version; nothing changed: ' + item['path'])
    pending.append((target, data))
for target, data in pending:
    target.write_bytes(data)
print('Matching Lightroom test update applied:', manifest.get('plugin_update', manifest['module']), root)
