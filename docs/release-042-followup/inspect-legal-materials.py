"""Read-only local material inventory; never prints source text or personal paths."""
from pathlib import Path
import hashlib
root = Path(__file__).resolve().parents[2]
for base in (root/'out', root.parent/'release-042-artifacts'/'delivered assets with spaces', root.parent/'release-0.4.2-artifacts'/'revision-02'/'native-source'/'upstream', root.parent/'release-042-artifacts'/'supply'/'review'):
    for p in base.rglob('*'):
        if p.is_file() and (p.name in ('libffmpeg.dylib', 'ffmpeg.dll') or 'ffmpeg-v' in p.name or ('modif' in p.name.lower()) or (p.parent == base and base.name == 'review')):
            print(p.relative_to(root.parent).as_posix(), p.stat().st_size)
            if p.name == 'libffmpeg.dylib':
                print('SHA256', hashlib.sha256(p.read_bytes()).hexdigest())
