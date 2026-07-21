"""Движок сканирования диска: фоновый поток, прогресс, отмена, топ файлов и папок."""

import hashlib
import heapq
import os
import sys
import threading
import time

sys.setrecursionlimit(50000)

TOP_FILES_KEEP = 300
JUNK_KEEP = 500
MIN_DUP_SIZE = 1
HASH_CHUNK = 1024 * 1024

CATEGORY_EXT = {
    'video': {'.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
              '.mpg', '.mpeg', '.ts', '.vob', '.m2ts'},
    'audio': {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.mid'},
    'images': {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif',
               '.svg', '.ico', '.raw', '.heic', '.psd', '.ai'},
    'documents': {'.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
                  '.rtf', '.odt', '.ods', '.csv', '.md', '.epub', '.djvu'},
    'archives': {'.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso',
                 '.cab', '.img', '.dmg'},
    'code': {'.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.scss', '.cpp',
             '.c', '.h', '.hpp', '.java', '.cs', '.go', '.rs', '.rb', '.php',
             '.json', '.xml', '.yml', '.yaml', '.sql', '.sh', '.bat', '.ps1'},
    'executables': {'.exe', '.dll', '.msi', '.sys', '.bin', '.apk', '.appx', '.jar'},
}

_EXT_TO_CATEGORY = {ext: cat for cat, exts in CATEGORY_EXT.items() for ext in exts}

CATEGORY_LABELS = {
    'video': 'Видео',
    'audio': 'Аудио',
    'images': 'Изображения',
    'documents': 'Документы',
    'archives': 'Архивы / образы',
    'code': 'Код / конфиги',
    'executables': 'Программы / библиотеки',
    'other': 'Прочее',
}

JUNK_REASON_LABELS = {
    'temp': 'Временный',
    'cache': 'Кэш',
    'log': 'Лог',
    'backup': 'Бэкап / старый',
    'dump': 'Дамп / crash',
    'system': 'Системный',
}

JUNK_EXT = {
    '.tmp', '.temp', '.log', '.old', '.bak', '.cache', '.dmp', '.mdmp', '.chk',
    '.gid', '.swp', '.swo', '.crdownload', '.part', '.download',
}
JUNK_NAMES = {'thumbs.db', 'desktop.ini', '.ds_store', 'iconcache.db'}
JUNK_DIR_NAMES = {
    'temp', 'tmp', 'cache', 'caches', 'logs', 'log', 'prefetch', 'crashdumps',
    'inetcache', 'temporary internet files', 'thumbcache', 'wercache', 'history',
    'cookies', 'recent', 'installer', 'servicehub', 'packages', 'code cache',
}
JUNK_PATH_MARKERS = (
    '\\appdata\\local\\temp\\',
    '\\appdata\\local\\temp',
    '\\windows\\temp\\',
    '\\windows\\temp',
    '\\temp\\',
    '\\tmp\\',
    '\\inetcache\\',
    '\\thumbcache\\',
    '\\prefetch\\',
    '\\crashdumps\\',
    '\\wercache\\',
    '\\code cache\\',
    '\\gpuarchitectures\\',
)


def categorize(ext):
    return _EXT_TO_CATEGORY.get(ext.lower(), 'other')


def classify_junk(path, name, ext):
    lower_path = path.lower().replace('/', '\\')
    lower_name = name.lower()
    ext = ext.lower()

    if lower_name in JUNK_NAMES:
        return 'system'
    if ext in {'.tmp', '.temp'} or lower_name.endswith('~'):
        return 'temp'
    if ext == '.log':
        return 'log'
    if ext in {'.bak', '.old'}:
        return 'backup'
    if ext in {'.dmp', '.mdmp'} or 'crash' in lower_name:
        return 'dump'
    if ext in {'.cache', '.crdownload', '.part'} or 'cache' in lower_name:
        return 'cache'
    for marker in JUNK_PATH_MARKERS:
        if marker in lower_path:
            if 'temp' in marker or 'tmp' in marker:
                return 'temp'
            if 'log' in marker:
                return 'log'
            return 'cache'
    for part in lower_path.split('\\'):
        if part in JUNK_DIR_NAMES:
            if part in ('temp', 'tmp'):
                return 'temp'
            if part in ('logs', 'log'):
                return 'log'
            return 'cache'
    return None


class Scanner:
    """Рекурсивный обход os.scandir в фоновом потоке."""

    def __init__(self):
        self._thread = None
        self._dup_thread = None
        self._cancel = threading.Event()
        self._lock = threading.Lock()
        self._progress_cb = None
        self._dup_done_cb = None
        self._last_report = 0.0
        self._current_path = ''
        self.running = False
        self._reset()

    def _reset(self):
        self.root_path = None
        self.tree = None
        self._index = {}
        self._top_heap = []
        self._junk_heap = []
        self._junk_total_count = 0
        self._junk_total_size = 0
        self._size_buckets = {}
        self.categories = {}
        self.duplicate_groups = []
        self.dup_running = False
        self.dup_done = False
        self.dup_checked = 0
        self.dup_total = 0
        self.total_size = 0
        self.total_files = 0
        self.total_dirs = 0
        self.errors = 0
        self.started_at = 0.0
        self.finished_at = 0.0
        self.cancelled = False

    def start(self, path, progress_cb, done_cb, dup_done_cb=None):
        with self._lock:
            if self.running:
                return False
            self.running = True
        self._reset()
        self._cancel.clear()
        self.root_path = os.path.normpath(path)
        self._progress_cb = progress_cb
        self._dup_done_cb = dup_done_cb
        self.started_at = time.time()
        self._thread = threading.Thread(
            target=self._run, args=(done_cb,), daemon=True)
        self._thread.start()
        return True

    def cancel(self):
        self._cancel.set()

    def _run(self, done_cb):
        try:
            self.tree = self._walk(self.root_path)
        except Exception:
            self.errors += 1
        self.finished_at = time.time()
        self.cancelled = self._cancel.is_set()
        self.running = False
        done_cb(self.get_summary())
        if not self.cancelled and self.total_files > 0:
            self._dup_thread = threading.Thread(target=self._find_duplicates, daemon=True)
            self._dup_thread.start()

    def _walk(self, path):
        node = {'n': os.path.basename(path) or path, 'p': path, 's': 0, 'c': []}
        self._index[os.path.normcase(os.path.normpath(path))] = node
        try:
            entries = list(os.scandir(path))
        except OSError:
            self.errors += 1
            return node

        for entry in entries:
            if self._cancel.is_set():
                break
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    self.total_dirs += 1
                    child = self._walk(entry.path)
                    node['s'] += child['s']
                    node['c'].append(child)
                elif entry.is_file(follow_symlinks=False):
                    size = entry.stat(follow_symlinks=False).st_size
                    node['s'] += size
                    self.total_size += size
                    self.total_files += 1
                    name = entry.name
                    _, ext = os.path.splitext(name)
                    self._push_top(size, entry.path)
                    self._track_size_bucket(size, entry.path)
                    reason = classify_junk(entry.path, name, ext)
                    if reason:
                        self._push_junk(size, entry.path, reason, name)
                    cat = categorize(ext)
                    stat = self.categories.setdefault(cat, {'size': 0, 'count': 0})
                    stat['size'] += size
                    stat['count'] += 1
            except OSError:
                self.errors += 1

        self._current_path = path
        self._report_progress()
        return node

    def _push_top(self, size, path):
        if len(self._top_heap) < TOP_FILES_KEEP:
            heapq.heappush(self._top_heap, (size, path))
        elif size > self._top_heap[0][0]:
            heapq.heapreplace(self._top_heap, (size, path))

    def _push_junk(self, size, path, reason, name):
        self._junk_total_count += 1
        self._junk_total_size += size
        item = (size, path, reason, name)
        if len(self._junk_heap) < JUNK_KEEP:
            heapq.heappush(self._junk_heap, item)
        elif size > self._junk_heap[0][0]:
            heapq.heapreplace(self._junk_heap, item)

    def _track_size_bucket(self, size, path):
        if size < MIN_DUP_SIZE:
            return
        self._size_buckets.setdefault(size, []).append(path)

    def _file_hash(self, path):
        h = hashlib.md5()
        with open(path, 'rb') as f:
            while True:
                if self._cancel.is_set():
                    break
                chunk = f.read(HASH_CHUNK)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()

    def _find_duplicates(self):
        self.dup_running = True
        self.dup_done = False
        self.duplicate_groups = []
        candidates = [
            (size, paths) for size, paths in self._size_buckets.items()
            if len(paths) >= 2
        ]
        self.dup_total = sum(len(paths) for _, paths in candidates)
        self.dup_checked = 0

        for size, paths in sorted(candidates, key=lambda x: -x[0]):
            if self._cancel.is_set():
                break
            hash_groups = {}
            for path in paths:
                if self._cancel.is_set():
                    break
                try:
                    if not os.path.isfile(path):
                        self.dup_checked += 1
                        continue
                    digest = self._file_hash(path)
                except OSError:
                    self.dup_checked += 1
                    continue
                hash_groups.setdefault(digest, []).append(path)
                self.dup_checked += 1
                if self._progress_cb and self.dup_checked % 40 == 0:
                    self._report_dup_progress()

            for digest, group in hash_groups.items():
                if len(group) < 2:
                    continue
                wasted = size * (len(group) - 1)
                self.duplicate_groups.append({
                    'hash': digest[:8],
                    'size': size,
                    'wasted': wasted,
                    'count': len(group),
                    'files': [
                        {
                            'path': p,
                            'name': os.path.basename(p),
                            'dir': os.path.dirname(p),
                        }
                        for p in sorted(group)
                    ],
                })

        self.duplicate_groups.sort(key=lambda g: g['wasted'], reverse=True)
        self.dup_running = False
        self.dup_done = True
        if self._dup_done_cb:
            self._dup_done_cb(self.get_duplicates())

    def _report_progress(self, force=False):
        now = time.time()
        if not force and now - self._last_report < 0.15:
            return
        self._last_report = now
        if self._progress_cb:
            self._progress_cb({
                'phase': 'scan',
                'files': self.total_files,
                'dirs': self.total_dirs,
                'size': self.total_size,
                'errors': self.errors,
                'current': self._current_path,
                'elapsed': now - self.started_at,
            })

    def _report_dup_progress(self):
        if self._progress_cb:
            self._progress_cb({
                'phase': 'duplicates',
                'dup_checked': self.dup_checked,
                'dup_total': self.dup_total,
                'dup_groups': len(self.duplicate_groups),
                'elapsed': time.time() - self.started_at,
            })

    def get_summary(self):
        return {
            'root': self.root_path,
            'files': self.total_files,
            'dirs': self.total_dirs,
            'size': self.total_size,
            'errors': self.errors,
            'elapsed': (self.finished_at or time.time()) - self.started_at,
            'cancelled': self.cancelled,
        }

    def get_top_files(self, limit=100):
        items = sorted(self._top_heap, key=lambda t: t[0], reverse=True)[:limit]
        result = []
        for size, path in items:
            name = os.path.basename(path)
            _, ext = os.path.splitext(name)
            result.append({
                'path': path,
                'name': name,
                'dir': os.path.dirname(path),
                'size': size,
                'ext': ext.lower(),
            })
        return result

    def get_junk(self, limit=200):
        items = sorted(self._junk_heap, key=lambda t: t[0], reverse=True)
        files = []
        for size, path, reason, name in items[:limit]:
            if not os.path.exists(path):
                continue
            files.append({
                'path': path,
                'name': name,
                'dir': os.path.dirname(path),
                'size': size,
                'reason': reason,
                'reasonLabel': JUNK_REASON_LABELS.get(reason, reason),
            })
        return {
            'files': files,
            'totalCount': self._junk_total_count,
            'totalSize': self._junk_total_size,
            'shown': len(files),
        }

    def get_duplicates(self, limit=80):
        self._prune_duplicate_groups()
        groups = []
        for g in self.duplicate_groups[:limit]:
            groups.append({
                'hash': g['hash'],
                'size': g['size'],
                'wasted': g['wasted'],
                'count': g['count'],
                'files': g['files'],
            })
        total_wasted = sum(g['wasted'] for g in self.duplicate_groups)
        return {
            'groups': groups,
            'totalGroups': len(self.duplicate_groups),
            'totalWasted': total_wasted,
            'done': self.dup_done,
            'running': self.dup_running,
            'checked': self.dup_checked,
            'total': self.dup_total,
        }

    def _prune_duplicate_groups(self):
        pruned = []
        for g in self.duplicate_groups:
            alive = [f for f in g['files'] if os.path.exists(f['path'])]
            if len(alive) < 2:
                continue
            size = g['size']
            pruned.append({
                'hash': g['hash'],
                'size': size,
                'wasted': size * (len(alive) - 1),
                'count': len(alive),
                'files': alive,
            })
        self.duplicate_groups = pruned

    def get_folder(self, path=None):
        if path is None:
            path = self.root_path
        if path is None:
            return None
        key = os.path.normcase(os.path.normpath(path))
        node = self._index.get(key)
        if node is None:
            return None

        dirs = sorted(
            ({'name': c['n'], 'path': c['p'], 'size': c['s']} for c in node['c']),
            key=lambda d: d['size'], reverse=True)

        files = []
        try:
            with os.scandir(node['p']) as entries:
                for entry in entries:
                    try:
                        if entry.is_file(follow_symlinks=False):
                            files.append({
                                'name': entry.name,
                                'path': entry.path,
                                'size': entry.stat(follow_symlinks=False).st_size,
                            })
                    except OSError:
                        pass
        except OSError:
            pass
        files.sort(key=lambda f: f['size'], reverse=True)

        parent = os.path.dirname(node['p'])
        is_root = os.path.normcase(os.path.normpath(node['p'])) == \
            os.path.normcase(os.path.normpath(self.root_path))
        return {
            'path': node['p'],
            'size': node['s'],
            'parent': None if is_root else parent,
            'root': self.root_path,
            'dirs': dirs,
            'files': files,
        }

    def get_stats(self):
        cats = []
        for cat, stat in sorted(self.categories.items(),
                                key=lambda kv: kv[1]['size'], reverse=True):
            cats.append({
                'id': cat,
                'label': CATEGORY_LABELS.get(cat, cat),
                'size': stat['size'],
                'count': stat['count'],
            })
        return {'categories': cats, 'summary': self.get_summary()}

    def forget_paths(self, paths):
        for p in paths:
            key = os.path.normcase(os.path.normpath(p))
            node = self._index.get(key)
            if node is not None:
                self._forget_dir(node)
            else:
                self._forget_file(p)
            self._forget_aux(p)

    def _forget_aux(self, path):
        norm = os.path.normcase(os.path.normpath(path))
        prefix = norm + os.sep
        self._junk_heap = [
            item for item in self._junk_heap
            if os.path.normcase(item[1]) != norm
            and not os.path.normcase(item[1]).startswith(prefix)
        ]
        heapq.heapify(self._junk_heap)
        for group in self.duplicate_groups:
            group['files'] = [
                f for f in group['files']
                if os.path.normcase(f['path']) != norm
                and not os.path.normcase(f['path']).startswith(prefix)
            ]
        self._prune_duplicate_groups()

    def _forget_dir(self, node):
        removed = node['s']
        parent_key = os.path.normcase(os.path.dirname(os.path.normpath(node['p'])))
        parent = self._index.get(parent_key)
        if parent is not None:
            parent['c'] = [c for c in parent['c'] if c is not node]
        self._bubble_size(os.path.dirname(node['p']), -removed)
        prefix = os.path.normcase(os.path.normpath(node['p']))
        for key in [k for k in self._index
                    if k == prefix or k.startswith(prefix + os.sep)]:
            del self._index[key]
        self._top_heap = [(s, p) for s, p in self._top_heap
                          if not os.path.normcase(p).startswith(prefix)]
        heapq.heapify(self._top_heap)

    def _forget_file(self, path):
        norm = os.path.normcase(os.path.normpath(path))
        size = None
        for s, p in self._top_heap:
            if os.path.normcase(p) == norm:
                size = s
                break
        self._top_heap = [(s, p) for s, p in self._top_heap
                          if os.path.normcase(p) != norm]
        heapq.heapify(self._top_heap)
        if size is not None:
            self._bubble_size(os.path.dirname(path), -size)

    def _bubble_size(self, dir_path, delta):
        if self.root_path is None or delta == 0:
            return
        root_key = os.path.normcase(os.path.normpath(self.root_path))
        cur = os.path.normpath(dir_path)
        while True:
            node = self._index.get(os.path.normcase(cur))
            if node is not None:
                node['s'] = max(0, node['s'] + delta)
            if os.path.normcase(cur) == root_key:
                break
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
        self.total_size = max(0, self.total_size + delta)
