"""DISK://REAPER — анализатор дискового пространства. Точка входа."""

import ctypes
import json
import os
import shutil
import string
import subprocess
import sys
import threading
import time

import webview
from send2trash import send2trash

from scanner import Scanner


def _app_dir():
    """Каталог ресурсов: распаковка PyInstaller (_MEIPASS) или папка проекта."""
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


UI_DIR = os.path.join(_app_dir(), 'ui')
ICON_PATH = os.path.join(_app_dir(), 'assets', 'icon.ico')

# Win32 styles for frameless window: resize borders + min/max from taskbar
GWL_STYLE = -16
WS_MINIMIZEBOX = 0x00020000
WS_MAXIMIZEBOX = 0x00010000
WS_THICKFRAME = 0x00040000
SWP_FRAMECHANGED = 0x0020
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_NOZORDER = 0x0004


def _browser_view(window):
    try:
        from webview.platforms import winforms
        return winforms.BrowserView.instances.get(window.uid)
    except Exception:
        return None


def _run_on_ui(window, fn):
    browser = _browser_view(window)
    if browser is None:
        fn()
        return
    try:
        from webview.platforms import winforms
        if browser.InvokeRequired:
            browser.Invoke(winforms.Func[winforms.Type](fn))
        else:
            fn()
    except Exception:
        fn()


def _fix_frameless_window(window):
    """В frameless-режиме WinForms снимает рамку — возвращаем resize и системные min/max."""
    if sys.platform != 'win32':
        return

    def _apply():
        browser = _browser_view(window)
        if browser is None:
            return
        try:
            hwnd = browser.Handle.ToInt32()
            user32 = ctypes.windll.user32
            style = user32.GetWindowLongW(hwnd, GWL_STYLE)
            style |= WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_THICKFRAME
            user32.SetWindowLongW(hwnd, GWL_STYLE, style)
            user32.SetWindowPos(
                hwnd, None, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
            )
        except Exception:
            pass

    _run_on_ui(window, _apply)


def _is_admin():
    if sys.platform != 'win32':
        return True
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _request_admin():
    """Запросить права администратора через UAC. Возвращает True, если можно продолжать."""
    if sys.platform != 'win32' or _is_admin():
        return True

    if getattr(sys, 'frozen', False):
        executable = sys.executable
        params = ' '.join(f'"{arg}"' for arg in sys.argv[1:])
    else:
        executable = sys.executable
        script = os.path.abspath(sys.argv[0])
        params = ' '.join([f'"{script}"', *(f'"{arg}"' for arg in sys.argv[1:])])

    ret = ctypes.windll.shell32.ShellExecuteW(
        None, 'runas', executable, params, None, 1,
    )
    # > 32 — elevated процесс запущен; иначе пользователь отменил UAC или ошибка
    if ret <= 32 and sys.platform == 'win32':
        ctypes.windll.user32.MessageBoxW(
            0,
            'Для удаления защищённых файлов программе нужны права администратора.',
            'DISK://REAPER',
            0x30,
        )
    return False


class Api:
    """Методы, доступные фронтенду через window.pywebview.api.

    Важно: все внутренние поля должны начинаться с '_', иначе pywebview
    рекурсивно обходит их при инъекции JS API и ломает мост.
    """

    def __init__(self):
        self._scanner = Scanner()
        self._window = None

    # ---------- служебное ----------

    def _js(self, fn, payload):
        if self._window is None:
            return
        try:
            self._window.evaluate_js(f'{fn}({json.dumps(payload)})')
        except Exception:
            pass

    # ---------- выбор цели ----------

    def get_drives(self):
        drives = []
        for letter in string.ascii_uppercase:
            root = f'{letter}:\\'
            if not os.path.exists(root):
                continue
            try:
                usage = shutil.disk_usage(root)
            except OSError:
                continue
            drives.append({
                'path': root,
                'letter': letter,
                'total': usage.total,
                'used': usage.used,
                'free': usage.free,
            })
        return drives

    def is_elevated(self):
        return _is_admin()

    def choose_folder(self):
        """Открыть диалог выбора папки (WinForms; tkinter только при сбое)."""
        if self._window is None:
            return None

        start_dir = os.path.expanduser('~')
        outcome = {'path': None, 'ok': False}
        done = threading.Event()

        def _webview_dialog():
            try:
                dialog_result = self._window.create_file_dialog(
                    webview.FileDialog.FOLDER,
                    directory=start_dir,
                )
                outcome['ok'] = True
                if dialog_result:
                    outcome['path'] = (
                        dialog_result[0]
                        if isinstance(dialog_result, (list, tuple))
                        else dialog_result
                    )
            except Exception:
                outcome['ok'] = False
            finally:
                done.set()

        _run_on_ui(self._window, _webview_dialog)
        done.wait(120)

        if outcome['ok']:
            return outcome['path']

        # Запасной диалог — только если основной не открылся (ошибка), не при «Отмена»
        done.clear()
        outcome = {'path': None}

        def _tk_dialog():
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                path = filedialog.askdirectory(initialdir=start_dir, parent=root)
                root.destroy()
                if path:
                    outcome['path'] = path
            except Exception:
                pass
            finally:
                done.set()

        _run_on_ui(self._window, _tk_dialog)
        done.wait(120)
        return outcome['path']

    # ---------- сканирование ----------

    def start_scan(self, path):
        if not path or not os.path.isdir(path):
            return {'ok': False, 'error': 'Путь не существует или недоступен'}
        started = self._scanner.start(
            path,
            progress_cb=lambda data: self._js('App.onProgress', data),
            done_cb=lambda summary: self._js('App.onScanDone', summary),
            dup_done_cb=lambda data: self._js('App.onDupScanDone', data),
        )
        if not started:
            return {'ok': False, 'error': 'Сканирование уже запущено'}
        return {'ok': True}

    def cancel_scan(self):
        self._scanner.cancel()
        return True

    # ---------- результаты ----------

    def get_top_files(self, limit=100):
        return self._scanner.get_top_files(limit)

    def get_folder(self, path=None):
        return self._scanner.get_folder(path)

    def get_stats(self):
        return self._scanner.get_stats()

    def get_junk(self, limit=200):
        return self._scanner.get_junk(limit)

    def get_duplicates(self, limit=80):
        return self._scanner.get_duplicates(limit)

    # ---------- действия с файлами ----------

    def delete_items(self, paths, permanent=False):
        deleted, failed = [], []
        for raw in paths:
            path = os.path.normpath(raw)
            info = self._item_info(raw)
            try:
                if permanent:
                    if os.path.isdir(path) and not os.path.islink(path):
                        shutil.rmtree(path)
                    else:
                        os.remove(path)
                else:
                    send2trash(path)
                deleted.append(info)
            except Exception as exc:
                failed.append({'path': raw, 'error': str(exc)})
        if deleted:
            self._scanner.forget_paths([d['path'] for d in deleted])
        return {'deleted': deleted, 'failed': failed}

    def _item_info(self, raw):
        path = os.path.normpath(raw)
        name = os.path.basename(path) or path
        is_dir = os.path.isdir(path) and not os.path.islink(path)
        size = 0
        node = self._scanner._index.get(os.path.normcase(path))
        if node is not None:
            size = node['s']
        elif os.path.isfile(path):
            try:
                size = os.path.getsize(path)
            except OSError:
                pass
        return {
            'path': raw,
            'name': name,
            'size': size,
            'isDir': is_dir,
        }

    def open_in_explorer(self, path):
        path = os.path.normpath(path)
        if not os.path.exists(path):
            return False
        subprocess.Popen(['explorer', '/select,', path])
        return True

    # ---------- управление окном (кастомный title bar) ----------

    def window_minimize(self):
        if self._window is not None:
            self._window.minimize()
        return True

    def window_close(self):
        if self._window is not None:
            self._window.destroy()
        return True

    def window_is_maximized(self):
        return {'maximized': self._is_window_maximized()}

    def _is_window_maximized(self):
        browser = _browser_view(self._window) if self._window else None
        if browser is None:
            return False
        try:
            from System.Windows.Forms import FormWindowState
            return browser.WindowState == FormWindowState.Maximized
        except Exception:
            return False

    def window_toggle_maximize(self):
        if self._window is None:
            return {'maximized': False}

        result = {'maximized': False}

        def _toggle():
            browser = _browser_view(self._window)
            if browser is None:
                return
            try:
                from System.Windows.Forms import FormWindowState
                if browser.WindowState == FormWindowState.Maximized:
                    browser.WindowState = FormWindowState.Normal
                    result['maximized'] = False
                else:
                    browser.WindowState = FormWindowState.Maximized
                    result['maximized'] = True
            except Exception:
                if self._is_window_maximized():
                    self._window.restore()
                    result['maximized'] = False
                else:
                    self._window.maximize()
                    result['maximized'] = True

        _run_on_ui(self._window, _toggle)
        return result


def _bootstrap_ui(api):
    """Дождаться JS-моста и передать список дисков в интерфейс."""
    time.sleep(0.2)
    for _ in range(60):
        try:
            api._window.evaluate_js(
                'window.App && App.onBridgeReady && App.onBridgeReady()'
            )
            drives = api.get_drives()
            api._js('App.applyDrives', drives)
            api._js('App.onElevated', api.is_elevated())
            return
        except Exception:
            pass
        time.sleep(0.5)


def main():
    api = Api()
    webview.settings['DRAG_REGION_DIRECT_TARGET_ONLY'] = True
    window = webview.create_window(
        'DISK://REAPER — disk space analyzer',
        os.path.join(UI_DIR, 'index.html'),
        js_api=api,
        width=1280,
        height=820,
        min_size=(1200, 660),
        background_color='#05080a',
        frameless=True,
        easy_drag=False,
        shadow=True,
    )
    api._window = window
    window.events.loaded += lambda: threading.Thread(
        target=_bootstrap_ui, args=(api,), daemon=True
    ).start()
    window.events.shown += lambda: _fix_frameless_window(window)
    window.events.loaded += lambda: threading.Timer(0.5, lambda: _fix_frameless_window(window)).start()
    window.events.maximized += lambda: api._js('App.onWindowMaximized', True)
    window.events.restored += lambda: api._js('App.onWindowMaximized', False)
    icon = ICON_PATH if os.path.isfile(ICON_PATH) else None
    webview.start(icon=icon)


if __name__ == '__main__':
    if not _request_admin():
        sys.exit(0)
    main()
