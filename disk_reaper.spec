# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller: один файл DISK-REAPER.exe с UI, иконкой и UAC admin."""

import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

project_dir = os.path.dirname(os.path.abspath(SPEC))

datas = [
    (os.path.join(project_dir, 'ui'), 'ui'),
    (os.path.join(project_dir, 'assets'), 'assets'),
]
datas += collect_data_files('webview')
datas += collect_data_files('send2trash')

hiddenimports = collect_submodules('webview')
hiddenimports += [
    'webview.platforms.winforms',
    'webview.platforms.edgechromium',
    'send2trash',
    'clr_loader',
    'pythonnet',
]

a = Analysis(
    [os.path.join(project_dir, 'main.py')],
    pathex=[project_dir],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='DISK-REAPER',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(project_dir, 'assets', 'icon.ico'),
    uac_admin=True,
)
