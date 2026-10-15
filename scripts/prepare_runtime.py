#!/usr/bin/env python3
"""Prepare pinned, platform-native runtimes without using personal application data."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get('PAPERTRAIL_BUILD_CACHE') or (
    Path.home() / 'Library/Caches/PaperTrailBuild/downloads' if sys.platform == 'darwin'
    else Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'PaperTrailBuildCache/downloads'))
CACHE.mkdir(parents=True, exist_ok=True)
TARGET = sys.argv[1]
if TARGET not in ('macos-arm64', 'windows-x64'):
    raise SystemExit('Supported targets: macos-arm64, windows-x64')
DEST = ROOT / 'build/runtime' / TARGET
DEST.mkdir(parents=True, exist_ok=True)
PYTHON_VERSION = '3.13.16'
PYTHON_MAC = 'https://github.com/astral-sh/python-build-standalone/releases/download/20261001/cpython-3.13.16%2B20261001-aarch64-apple-darwin-install_only_stripped.tar.gz'


def download(url, name):
    path = CACHE / name
    if not path.is_file():
        temporary = path.with_suffix(path.suffix + '.part')
        print('Downloading ' + name, flush=True)
        request = urllib.request.Request(url, headers={'User-Agent': 'PaperTrail-build/1.0'})
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.replace(path)
    return path


def unpack_tar(archive, directory):
    with tarfile.open(archive) as bundle:
        bundle.extractall(directory)


if not (DEST / 'python/.ready').exists():
    if TARGET == 'macos-arm64':
        unpack_tar(download(PYTHON_MAC, 'cpython-macos-arm64-3.13.16.tar.gz'), DEST)
    else:
        archive = download(f'https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip', f'python-{PYTHON_VERSION}-embed-amd64.zip')
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(DEST / 'python')
    (DEST / 'python/.ready').write_text(PYTHON_VERSION)

# The packaged Electron executable supplies Node via ELECTRON_RUN_AS_NODE.
if (DEST / 'node').exists():
    shutil.rmtree(DEST / 'node')

module = ROOT / 'node_modules/playwright-core'
if not module.is_dir():
    raise SystemExit('Install project dependencies first.')
if (DEST / 'browser-module/playwright-core').exists():
    shutil.rmtree(DEST / 'browser-module/playwright-core')
shutil.copytree(module, DEST / 'browser-module/playwright-core')

metadata = json.load(urllib.request.urlopen('https://pypi.org/pypi/tzdata/2026.4/json'))
wheel = next(f for f in metadata['urls'] if f['filename'].endswith('.whl'))
with zipfile.ZipFile(download(wheel['url'], wheel['filename'])) as bundle:
    for member in bundle.infolist():
        if member.filename.startswith('tzdata/') or 'licenses/' in member.filename:
            bundle.extract(member, DEST)

if TARGET == 'macos-arm64':
    subprocess.run(['/usr/bin/swiftc', '-O', '-target', 'arm64-apple-macos14.0',
                    str(ROOT / 'build/config/keychain.swift'), '-o', str(DEST / 'keychain-helper')], check=True)

# Playwright chooses the matched browser revisions; only the target platform changes.
env = dict(os.environ, PLAYWRIGHT_BROWSERS_PATH=str(DEST / 'browsers'))
if TARGET == 'windows-x64':
    env['PLAYWRIGHT_HOST_PLATFORM_OVERRIDE'] = 'win64'
else:
    env['PLAYWRIGHT_HOST_PLATFORM_OVERRIDE'] = 'mac14-arm64'
subprocess.run([shutil.which('node'), str(module / 'cli.js'), 'install', '--no-shell', 'chromium', 'firefox'], env=env, check=True)
for name in ('chromium_headless_shell', 'ffmpeg'):
    for obsolete in (DEST / 'browsers').glob(name + '-*'):
        if obsolete.is_dir():
            shutil.rmtree(obsolete)
if TARGET == 'macos-arm64':
    browser_metadata = json.loads((module / 'browsers.json').read_text())
    revision = next(browser['revision'] for browser in browser_metadata['browsers'] if browser['name'] == 'firefox')
    resources = DEST / 'browsers' / ('firefox-' + revision) / 'firefox/Nightly.app/Contents/Resources'
    configuration = (resources / 'application.ini').read_text()
    configuration = configuration.replace('Vendor=Mozilla', 'Vendor=PaperTrail').replace('Name=Firefox', 'Name=PaperTrail')
    configuration = configuration.replace('RemotingName=firefox-default', 'RemotingName=papertrail').replace('EnableProfileMigrator=1', 'EnableProfileMigrator=0')
    (resources / 'browser').mkdir(exist_ok=True)
    (resources / 'browser/papertrail.ini').write_text(configuration)
(DEST / 'runtime-manifest.json').write_text(json.dumps({'target': TARGET, 'python': PYTHON_VERSION,
    'node': 'electron-run-as-node', 'playwright': json.loads((module / 'package.json').read_text())['version'],
    'tzdata': metadata['info']['version']}, indent=2))
print('Runtime ready: ' + TARGET, flush=True)
