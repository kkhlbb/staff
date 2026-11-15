"""Hash-bound official npm materials for lock changes; no legal/release approval.

Usage: python3 scripts/build_dependency_supply.py BASELINE_LOCK OUTPUT_DIRECTORY
Run from repository root. Uses existing npm with an output-local cache; no
installation or npm lifecycle scripts.
The baseline is an explicit file, not a guessed revision. OUTPUT must be new.
"""
import base64
import hashlib
import io
import json
import pathlib
import re
import subprocess
import sys
import tarfile
import urllib.parse


def lock_delta(old, new):
    result = []
    before, after = old['packages'], new['packages']
    for name in sorted((before.keys() | after.keys()) - {''}):
        a, b = before.get(name), after.get(name)
        if a is None or b is None or any(a.get(k) != b.get(k) for k in ('version', 'integrity', 'resolved')):
            result.append({'path': name, 'status': 'added' if a is None else 'removed' if b is None else 'updated', 'before': a, 'after': b})
    return result


def verify_sri(data, integrity):
    supported = []
    for token in integrity.split():
        algorithm, _, encoded = token.partition('-')
        if algorithm in ('sha512', 'sha384', 'sha256'):
            supported.append((algorithm, encoded))
    if not supported:
        raise ValueError('SRI_UNSUPPORTED')
    # As SRI specifies, require the strongest available algorithm.
    algorithm = max((x[0] for x in supported), key=lambda x: int(x[3:]))
    digest = base64.b64encode(hashlib.new(algorithm, data).digest()).decode()
    if not any(a == algorithm and digest == expected for a, expected in supported):
        raise ValueError('SRI_MISMATCH')


def license_members(data):
    result = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            parts = pathlib.PurePosixPath(member.name).parts
            if not parts or parts[0] != 'package' or '..' in parts or '\\' in member.name:
                raise ValueError('UNSAFE_ARCHIVE')
            if member.issym() or member.islnk():
                raise ValueError('UNSAFE_ARCHIVE')
            if member.isfile() and re.match(r'^(licen[sc]e|copying|notice)([.\-_]|$)', parts[-1], re.I):
                source = archive.extractfile(member)
                assert source is not None
                result['/'.join(parts[1:])] = source.read()
    if not result:
        raise ValueError('LICENSE_MISSING')
    return result


def lock_bom(lock):
    components = []
    for name, node in sorted(lock['packages'].items()):
        if not name:
            continue
        package_name = node.get('name') or name.rsplit('node_modules/', 1)[-1]
        component = {'type': 'library', 'bom-ref': name, 'name': package_name, 'version': node.get('version', 'unknown'), 'scope': 'excluded' if node.get('dev') else 'required', 'properties': [{'name': 'cunlian:lockPath', 'value': name}, {'name': 'cunlian:devDependency', 'value': str(bool(node.get('dev'))).lower()}]}
        if node.get('license'):
            component['licenses'] = [{'expression': node['license']}]
        if node.get('resolved'):
            component['externalReferences'] = [{'type': 'distribution', 'url': node['resolved']}]
        if node.get('integrity'):
            component['properties'].append({'name': 'cunlian:npmIntegrity', 'value': node['integrity']})
        components.append(component)
    return {'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'version': 1, 'metadata': {'component': {'type': 'application', 'name': lock.get('name', 'cunlian'), 'version': lock.get('version', 'unknown')}, 'properties': [{'name': 'cunlian:scope', 'value': 'Full npm lock inventory, not emitted/runtime survival proof; dev dependencies excluded from deployment scope'}, {'name': 'cunlian:completeness', 'value': 'INCOMPLETE_NATIVE_AND_BUNDLE_PROVENANCE'}, {'name': 'cunlian:releaseApproval', 'value': 'BLOCKED'}]}, 'components': components, 'compositions': [{'aggregate': 'incomplete'}]}


def record(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def write_json(file, value):
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')


def download(url, destination, events):
    # npm uses the same TLS/network stack as the verified install. Keep its cache
    # in this output directory; do not depend on or write a global npm cache.
    common = ['--cache', str(destination.parent/'.npm-cache'), '--registry=https://registry.npmjs.org', '--fetch-retries=2', '--fetch-timeout=120000']
    if destination.name.endswith('.registry.json'):
        segments = urllib.parse.urlparse(url).path.strip('/').split('/')
        package = urllib.parse.unquote(segments[0])+'@'+segments[1]
        argv = ['npm', 'view', package, '--json', *common]
    else:
        argv = ['npm', 'pack', url, '--ignore-scripts', '--json', '--pack-destination', str(destination.parent), *common]
    result = subprocess.run(argv, capture_output=True)
    events.append({'url': url, 'file': destination.name, 'argv': argv, 'exitCode': result.returncode, 'stderr': result.stderr.decode(errors='replace')})
    write_json(destination.parent/'download-events.json', events)
    if result.returncode:
        raise RuntimeError('OFFICIAL_DOWNLOAD_FAILED: '+url)
    if destination.name.endswith('.registry.json'):
        destination.write_bytes(result.stdout)
    else:
        packed = destination.parent/json.loads(result.stdout)[0]['filename']
        packed.rename(destination)
    return destination.read_bytes()


def build(baseline, output):
    root = pathlib.Path.cwd()
    current_bytes = (root/'package-lock.json').read_bytes()
    old_bytes = pathlib.Path(baseline).read_bytes()
    current = json.loads(current_bytes)
    delta = lock_delta(json.loads(old_bytes), current)
    output = pathlib.Path(output)
    output.mkdir(parents=True, exist_ok=False)
    (output/'baseline-package-lock.json').write_bytes(old_bytes)
    (output/'package-lock.json').write_bytes(current_bytes)
    write_json(output/'lock-delta.json', delta)
    write_json(output/'BUILD-DEPENDENCIES.cdx.json', lock_bom(current))
    events, artifacts, notices = [], {}, []
    for change in delta:
        node = change['after']
        if node is None:
            continue
        url = node['resolved']
        if url in artifacts:
            artifacts[url]['lockPaths'].append(change['path'])
            continue
        name = node.get('name') or change['path'].rsplit('node_modules/', 1)[-1]
        version = node['version']
        key = re.sub(r'[^a-zA-Z0-9_.-]', '_', name)+'-'+version
        metadata_url = 'https://registry.npmjs.org/'+urllib.parse.quote(name, safe='')+'/'+version
        metadata = json.loads(download(metadata_url, output/(key+'.registry.json'), events))
        if metadata['name'] != name or metadata['version'] != version or metadata['dist']['tarball'] != url or metadata['dist']['integrity'] != node['integrity']:
            raise ValueError('REGISTRY_LOCK_MISMATCH: '+name)
        data = download(url, output/(key+'.tgz'), events)
        verify_sri(data, node['integrity'])
        licenses = license_members(data)
        license_records = {}
        for rel, raw in licenses.items():
            destination = output/'original-notices'/key/rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
            installed = root/change['path']/rel
            if not installed.is_file() or installed.read_bytes() != raw:
                raise ValueError('INSTALLED_NOTICE_MISMATCH: '+str(installed))
            license_records[rel] = record(raw)
            notices.append((f'\n===== {name}@{version} / {rel} =====\nOfficial archive: {url}\nSHA-256: {record(raw)["sha256"]}\n\n').encode()+raw+b'\n')
        artifacts[url] = {'name': name, 'version': version, 'declaredLicense': node.get('license'), 'dev': node.get('dev', False), 'lockPaths': [change['path']], 'registryMetadata': key+'.registry.json', 'archive': key+'.tgz', 'integrity': node['integrity'], 'archiveRecord': record(data), 'originalNotices': license_records, 'installedNoticesMatch': True}
        write_json(output/'official-license-index.json', list(artifacts.values()))
    header = b'Build dependency update notices (official npm originals)\nScope: changed/added lock nodes only. These development tools are not claimed as emitted application runtime.\nAll texts below are preserved verbatim between separators. SPDX fields are upstream declarations, not legal certification.\nRelease approval remains BLOCKED; native/transitive review and formal delivery remain pending.\n'
    (output/'BUILD-DEPENDENCY-NOTICES.txt').write_bytes(header+b''.join(notices))
    summary = {'baselineLock': record(old_bytes), 'currentLock': record(current_bytes), 'deltaNodes': len(delta), 'addedOrUpdatedNodes': sum(x['after'] is not None for x in delta), 'removedNodes': sum(x['after'] is None for x in delta), 'officialArtifacts': len(artifacts), 'originalNoticeFiles': sum(len(x['originalNotices']) for x in artifacts.values()), 'lockInventoryComponents': len(current['packages'])-1, 'legalCertification': False, 'releaseApproval': 'BLOCKED'}
    write_json(output/'receipt.json', summary)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    build(sys.argv[1], sys.argv[2])
