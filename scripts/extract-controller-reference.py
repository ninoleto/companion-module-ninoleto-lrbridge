"""Extract code/metadata for offline contract tests; never start LRBridge."""
import json
import struct
import sys
import zipfile
from pathlib import Path

archive, destination = Path(sys.argv[1]), Path(sys.argv[2]).resolve()
if destination.exists():
    raise SystemExit('Choose a new reference directory; existing files are preserved.')
destination.mkdir(parents=True)

def write(relative, data):
    target = (destination / relative).resolve()
    if not target.is_relative_to(destination):
        raise ValueError('Archive path escapes reference directory')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)

with zipfile.ZipFile(archive) as z:
    data = z.read('resources/app.asar')
    base = 8 + struct.unpack_from('<I', data, 4)[0]
    length = struct.unpack_from('<I', data, 12)[0]
    header = json.loads(data[16:16 + length])

    def extract(tree, prefix=''):
        for name, entry in tree.get('files', {}).items():
            relative = prefix + name
            if relative == 'node_modules' or relative.startswith('node_modules/'):
                continue
            if 'files' in entry:
                extract(entry, relative + '/')
            elif 'offset' in entry and not entry.get('unpacked'):
                start = base + int(entry['offset'])
                write(relative, data[start:start + entry['size']])
    extract(header)
    for member in z.namelist():
        if member.startswith('lightroom/') and not member.endswith('/'):
            write(member, z.read(member))
print('Reference extracted:', destination)
