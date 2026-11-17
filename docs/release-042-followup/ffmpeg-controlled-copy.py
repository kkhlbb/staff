"""2026-11-17: new evidence-only controlled FFmpeg copy helper; no product edits.
Default is read-only. Never re-signs, disables hashes, or edits the source app.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT.parent / 'release-042-artifacts' / 'followup-source' / 'legal'
LIBS = {
    'macos-arm64': 'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib',
    'windows-x64': 'ffmpeg.dll',
}

def require(ok, message):
    if not ok:
        raise ValueError(message)

def plain(path):
    p = Path(os.path.abspath(path))
    for part in (p, *p.parents):
        require(not part.is_symlink(), 'symlink path refused')
    return p

def read_library(path):
    p = plain(path)
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and 8 <= info.st_size <= 128 * 1024 * 1024,
                'library must be regular and between 8 bytes and 128 MiB')
        with os.fdopen(fd, 'rb', closefd=False) as f:
            data = f.read(128 * 1024 * 1024 + 1)
        require(len(data) == info.st_size, 'library changed while reading')
        return data
    finally:
        os.close(fd)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def tree(root):
    result = {}
    for p in sorted(root.rglob('*')):
        rel = p.relative_to(root).as_posix()
        if p.is_symlink():
            # Preserve framework aliases, but reject links escaping the copied bundle.
            require(p.resolve().is_relative_to(root.resolve()), 'escaping bundle symlink refused')
            result[rel] = {'symlink': os.readlink(p)}
        elif p.is_file():
            result[rel] = {'sha256': sha(p.read_bytes()), 'mode': stat.S_IMODE(p.stat().st_mode)}
    return result

def run(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--platform', choices=LIBS, required=True)
    p.add_argument('--product', required=True, help='.app directory or Windows application directory')
    p.add_argument('--candidate', required=True)
    p.add_argument('--original-sha256', required=True)
    p.add_argument('--candidate-sha256', required=True)
    p.add_argument('--apply', action='store_true', help='copy into NEW evidence run, then replace only the whitelisted library')
    p.add_argument('--run-name', help='new direct child of followup-source/legal; required with --apply')
    a = p.parse_args(argv)
    for value in (a.original_sha256, a.candidate_sha256):
        require(bool(re.fullmatch('[0-9a-f]{64}', value)), 'expected lowercase 64-digit SHA256')
    product = plain(a.product)
    require(product.is_dir(), 'product directory missing')
    require(a.platform != 'macos-arm64' or product.suffix == '.app', 'expected .app directory')
    rel = LIBS[a.platform]
    before = read_library(product / rel)
    candidate = read_library(a.candidate)
    require(sha(before) == a.original_sha256, 'original hash mismatch')
    require(sha(candidate) == a.candidate_sha256, 'candidate hash mismatch')
    require(before != candidate, 'candidate equals original; not a replacement witness')
    require(candidate[:4] == (b'\xcf\xfa\xed\xfe' if a.platform == 'macos-arm64' else b'MZ\x90\x00'),
            'candidate native image magic mismatch (not ABI validation)')
    report = {'mode': 'READ_ONLY_PLAN', 'platform': a.platform, 'library': rel,
              'originalSha256': sha(before), 'candidateSha256': sha(candidate),
              'sourceUnchanged': True, 'hashChecksDisabled': False,
              'nativeRebuildExecuted': False, 'runtimeTested': False,
              'legalCertification': False, 'releaseApproval': 'BLOCKED'}
    if a.apply:
        require(bool(a.run_name and re.fullmatch('[A-Za-z0-9][A-Za-z0-9_-]{0,63}', a.run_name)),
                'apply requires a safe new run name')
        evidence = plain(EVIDENCE)
        require(not evidence.is_relative_to(product), 'output cannot be inside source product')
        evidence.mkdir(parents=True, exist_ok=True)
        work = evidence / a.run_name
        work.mkdir(exist_ok=False)
        original_tree = tree(product)
        copied = work / ('product.app' if a.platform == 'macos-arm64' else 'product')
        shutil.copytree(product, copied, symlinks=True)
        require(tree(copied) == original_tree, 'copy differs from source')
        target = plain(copied / rel)
        require(target.is_relative_to(copied), 'target escaped copied product')
        require(sha(read_library(target)) == a.original_sha256, 'copied original hash mismatch')
        stage = target.with_name(target.name + '.controlled-new')
        with stage.open('xb') as f:
            f.write(candidate)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(stage, stat.S_IMODE(target.stat().st_mode))
        os.replace(stage, target)
        after = tree(copied)
        changed = sorted(k for k in original_tree.keys() | after.keys() if original_tree.get(k) != after.get(k))
        require(changed == [rel], 'unexpected changed bundle files')
        require(sha(read_library(target)) == a.candidate_sha256, 'installed candidate hash mismatch')
        require(tree(product) == original_tree, 'source product changed')
        report.update(mode='COPIED_AND_REPLACED', changedFiles=changed,
                      copyTreeVerified=True, sourceTreeVerifiedUnchanged=True,
                      evidenceRun='followup-source/legal/' + a.run_name)
        with (work / 'replacement.json').open('x') as f:
            json.dump(report, f, indent=2)
            f.write('\n')
    print(json.dumps(report, indent=2))
    return report

if __name__ == '__main__':
    try:
        run()
    except (ValueError, OSError):
        # Do not publish arbitrary local paths or raw OS errors.
        print('REFUSED: validation or filesystem precondition failed; no source product edit', file=sys.stderr)
        sys.exit(2)
