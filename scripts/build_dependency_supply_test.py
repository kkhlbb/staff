import importlib.util
import io
import tarfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('supply', Path(__file__).with_name('build_dependency_supply.py'))
assert spec is not None and spec.loader is not None
supply = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supply)


class SupplyTest(unittest.TestCase):
    def test_diff_includes_added_updated_removed_and_dedupes_artifacts(self):
        old = {'packages': {'node_modules/a': {'version': '1'}, 'node_modules/gone': {'version': '1'}}}
        new = {'packages': {'node_modules/a': {'version': '2'}, 'node_modules/b': {'version': '3'}}}
        delta = supply.lock_delta(old, new)
        self.assertEqual([(x['path'], x['status']) for x in delta], [('node_modules/a', 'updated'), ('node_modules/b', 'added'), ('node_modules/gone', 'removed')])

    def test_sri_requires_actual_matching_digest(self):
        import base64
        import hashlib
        sri = 'sha512-' + base64.b64encode(hashlib.sha512(b'real').digest()).decode()
        supply.verify_sri(b'real', sri)
        with self.assertRaisesRegex(ValueError, 'SRI_MISMATCH'):
            supply.verify_sri(b'changed', sri)
        with self.assertRaisesRegex(ValueError, 'SRI_UNSUPPORTED'):
            supply.verify_sri(b'real', 'md5-no')

    def test_archive_preserves_notice_bytes_and_rejects_traversal(self):
        def archive(name, data):
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode='w:gz') as tf:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tf.addfile(info, io.BytesIO(data))
            return out.getvalue()
        raw = b'Original copyright  \n\n'
        self.assertEqual(supply.license_members(archive('package/LICENSE', raw)), {'LICENSE': raw})
        with self.assertRaisesRegex(ValueError, 'UNSAFE_ARCHIVE'):
            supply.license_members(archive('package/../LICENSE', raw))
        with self.assertRaisesRegex(ValueError, 'LICENSE_MISSING'):
            supply.license_members(archive('package/README.md', raw))

    def test_bom_labels_dev_and_keeps_release_blocked(self):
        bom = supply.lock_bom({'packages': {'': {'name': 'app', 'version': '1'}, 'node_modules/a': {'version': '2', 'dev': True, 'license': 'BlueOak-1.0.0', 'integrity': 'sha512-eA=='}}})
        self.assertEqual(bom['components'][0]['scope'], 'excluded')
        self.assertEqual(bom['components'][0]['licenses'], [{'expression': 'BlueOak-1.0.0'}])
        self.assertIn({'name': 'cunlian:releaseApproval', 'value': 'BLOCKED'}, bom['metadata']['properties'])


if __name__ == '__main__':
    unittest.main()
