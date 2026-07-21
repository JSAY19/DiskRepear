/* ===== DISK://REAPER — i18n (ru / en) ===== */

'use strict';

const I18n = (function () {
  const STORAGE_KEY = 'diskreaper-lang';
  let lang = localStorage.getItem(STORAGE_KEY) || 'ru';
  const listeners = [];

  const strings = {
    ru: {
      'titlebar.sub': 'анализатор дискового пространства',
      'titlebar.min': 'Свернуть',
      'titlebar.max': 'Развернуть',
      'titlebar.restore': 'Восстановить',
      'titlebar.close': 'Закрыть',
      'lang.switchTo': 'Переключить язык',

      'hs.target': 'Цель',
      'hs.free': 'Свободно на диске',
      'hs.scan': 'Последний скан',
      'hs.files': 'файлов',
      'hs.size': 'объём',
      'hs.junk': 'мусор',
      'hs.dup': 'дубли',
      'hs.pctUsed': '{pct}% занято',
      'hs.scanning': 'сканирование…',
      'hs.aborted': 'прерван ({s}s)',
      'hs.dupShort': '{size} · {n} гр.',

      'sidebar.title': '[ ЦЕЛЬ АНАЛИЗА ]',
      'btn.browse': '>> ВЫБРАТЬ ПАПКУ...',
      'target.label': 'TARGET:',
      'target.placeholder': 'или введите путь: C:\\Users\\...',
      'btn.scan': '▶ ЗАПУСТИТЬ СКАН',
      'btn.abort': '■ ПРЕРВАТЬ',
      'live.files': 'ФАЙЛОВ:',
      'live.dirs': 'ПАПОК:',
      'live.size': 'ОБЪЁМ:',
      'live.errors': 'ОШИБОК:',
      'live.elapsed': 'ВРЕМЯ:',

      'tab.files': 'TOP ФАЙЛЫ',
      'tab.folders': 'ПАПКИ',
      'tab.stats': 'СТАТИСТИКА',
      'tab.junk': 'МУСОР',
      'tab.dup': 'ДУБЛИКАТЫ',
      'tab.trash': 'В КОРЗИНУ',
      'tab.shred': 'УНИЧТОЖЕНО',

      'filter.files': 'фильтр: имя или .расширение',
      'filter.all': 'все',
      'filter.junk': 'фильтр по имени или типу',

      'th.num': '#',
      'th.name': 'ИМЯ',
      'th.path': 'ПУТЬ',
      'th.size': 'РАЗМЕР',
      'th.type': 'ТИП',
      'th.group': 'ГРУППА',
      'th.time': 'ВРЕМЯ',

      'empty.noData': 'нет данных — запустите сканирование',
      'empty.notFound': 'ничего не найдено',
      'empty.notFoundFilter': 'ничего не найдено по фильтру',
      'empty.scanning': 'сканирование...',
      'empty.emptyFolder': 'пустая папка',
      'empty.dupSearching': 'поиск дубликатов...',
      'empty.log': 'пока пусто',

      'junk.countLabel': 'МУСОРНЫХ ФАЙЛОВ',
      'junk.sizeLabel': 'МОЖНО ОЧИСТИТЬ',
      'junk.hint': '// temp, cache, logs, prefetch, thumbs.db и похожее — проверяйте перед удалением',

      'dup.groupsLabel': 'ГРУПП ДУБЛЕЙ',
      'dup.wastedLabel': 'ЛИШНИЙ ОБЪЁМ',
      'dup.hintDefault': '// после скана ищем одинаковые файлы по хешу MD5',
      'dup.waitScan': '// ожидание завершения основного скана...',
      'dup.scanAborted': '// скан прерван — поиск дубликатов не запущен',
      'dup.running': '// поиск дубликатов по MD5 — идёт в фоне...',
      'dup.progress': '// поиск дубликатов: {checked} / {total} ({pct}%) · групп: {groups}',
      'dup.none': '// дубликаты не найдены',
      'dup.found': '// найдено {n} групп — можно удалить лишние копии, оставив по одному файлу',
      'dup.groupTitle': 'ГРУППА #{n}',
      'dup.groupMeta': '{size} × {count} · лишнее: {wasted} · hash {hash}',
      'dup.original': 'ориг.',
      'dup.copy': 'копия {n}',

      'trash.countLabel': 'ОБЪЕКТОВ',
      'trash.sizeLabel': 'В КОРЗИНЕ',
      'trash.hint': '// журнал сессии — восстановить можно из корзины Windows',
      'shred.countLabel': 'УНИЧТОЖЕНО',
      'shred.sizeLabel': 'ОСВОБОЖДЕНО',
      'shred.hint': '// журнал сессии — безвозвратное удаление за текущий запуск',

      'stats.total': 'ОБЩИЙ ОБЪЁМ',
      'stats.files': 'ФАЙЛОВ',
      'stats.dirs': 'ПАПОК',
      'stats.errors': 'НЕДОСТУПНО',
      'stats.catMeta': '<b>{size}</b> / {count} файлов / {share}%',

      'folder.back': '[..] НАЗАД',
      'drive.free': '{size} свободно',

      'footer.selected': 'ВЫБРАНО:',
      'footer.objects': 'объект(ов)',
      'footer.preview': '[ просмотр ]',
      'footer.previewTitle': 'Нажмите, чтобы просмотреть выбранное',
      'footer.clear': 'Сброс',
      'footer.trash': 'В корзину',
      'footer.shred': 'Уничтожить',

      'modal.title': '// ПОДТВЕРЖДЕНИЕ',
      'modal.trash': '// УДАЛЕНИЕ В КОРЗИНУ',
      'modal.shred': '// БЕЗВОЗВРАТНОЕ УНИЧТОЖЕНИЕ',
      'modal.review': '// ВЫБРАННЫЕ ОБЪЕКТЫ',
      'modal.cancel': 'ОТМЕНА',
      'modal.apply': 'ПРИМЕНИТЬ',
      'modal.trashBtn': '⌦ В КОРЗИНУ',
      'modal.shredBtn': '☠ УНИЧТОЖИТЬ',
      'modal.hintReview': 'Снимите галочки, чтобы убрать объект из выбора.',
      'modal.hintTrash': 'Снимите галочки с объектов, которые не нужно удалять.',
      'modal.warnShred': 'ВНИМАНИЕ: восстановление будет НЕВОЗМОЖНО. Снимите галочки с лишних объектов.',
      'modal.selectAll': 'выбрать все',
      'modal.summaryReview': 'В выборке: <b>{count}</b> из {total} — <b>{size}</b>',
      'modal.summaryDelete': 'К удалению: <b>{count}</b> из {total} — <b>{size}</b>',

      'api.connecting': 'API: connecting...',
      'api.ready': 'API: ready',
      'api.readyAdmin': 'API: ready | ADMIN',
      'api.failed': 'API: connection failed',

      'err.apiNotReady': 'Python API ещё не готов',
      'err.loadDrives': 'Не удалось загрузить список дисков',
      'err.startScan': 'Не удалось запустить скан',
      'err.folderDialog': 'Не удалось открыть диалог выбора папки',
      'err.apiTimeout': 'Python API не ответил. Закройте окно и запустите: python main.py',

      'toast.deletedPartial': 'Удалено: {ok}, ошибок: {fail} ({err})',
      'toast.shredded': 'Уничтожено: {n} — освобождено {size}',
      'toast.trashed': 'В корзину: {n} — {size}',

      'status.loaded': 'interface loaded. waiting for Python API...',
      'status.online': 'system online. выберите диск или папку для анализа.',
      'status.target': 'target acquired: {path}',
      'status.scanning': 'scanning {path} ...',
      'status.abort': 'abort signal sent...',
      'status.scanDone': 'scan complete: {files} файлов / {size}',
      'status.scanAborted': 'scan aborted — частичные результаты ({size})',
      'status.dupDone': 'duplicate scan complete: {groups} групп / {size} лишнего объёма',
      'status.selectionUpdated': 'selection updated: {n} objects',
      'status.deleting': '{action} {n} objects...',
      'status.deleteDone': 'delete complete: {ok} ok / {fail} failed',
      'status.folderOpen': 'opening folder dialog...',
      'status.folderCancel': 'selection cancelled.',
      'status.folderError': 'folder dialog error.',
      'status.actionTrash': 'trashing',
      'status.actionShred': 'shredding',

      'junk.temp': 'Временный',
      'junk.cache': 'Кэш',
      'junk.log': 'Лог',
      'junk.backup': 'Бэкап / старый',
      'junk.dump': 'Дамп / crash',
      'junk.system': 'Системный',
    },
    en: {
      'titlebar.sub': 'disk space analyzer',
      'titlebar.min': 'Minimize',
      'titlebar.max': 'Maximize',
      'titlebar.restore': 'Restore',
      'titlebar.close': 'Close',
      'lang.switchTo': 'Switch language',

      'hs.target': 'Target',
      'hs.free': 'Disk free',
      'hs.scan': 'Last scan',
      'hs.files': 'files',
      'hs.size': 'size',
      'hs.junk': 'junk',
      'hs.dup': 'dupes',
      'hs.pctUsed': '{pct}% used',
      'hs.scanning': 'scanning…',
      'hs.aborted': 'aborted ({s}s)',
      'hs.dupShort': '{size} · {n} grp.',

      'sidebar.title': '[ ANALYSIS TARGET ]',
      'btn.browse': '>> CHOOSE FOLDER...',
      'target.label': 'TARGET:',
      'target.placeholder': 'or enter path: C:\\Users\\...',
      'btn.scan': '▶ START SCAN',
      'btn.abort': '■ ABORT',
      'live.files': 'FILES:',
      'live.dirs': 'DIRS:',
      'live.size': 'SIZE:',
      'live.errors': 'ERRORS:',
      'live.elapsed': 'TIME:',

      'tab.files': 'TOP FILES',
      'tab.folders': 'FOLDERS',
      'tab.stats': 'STATISTICS',
      'tab.junk': 'JUNK',
      'tab.dup': 'DUPLICATES',
      'tab.trash': 'TO TRASH',
      'tab.shred': 'SHREDDED',

      'filter.files': 'filter: name or .extension',
      'filter.all': 'all',
      'filter.junk': 'filter by name or type',

      'th.num': '#',
      'th.name': 'NAME',
      'th.path': 'PATH',
      'th.size': 'SIZE',
      'th.type': 'TYPE',
      'th.group': 'GROUP',
      'th.time': 'TIME',

      'empty.noData': 'no data — run a scan',
      'empty.notFound': 'nothing found',
      'empty.notFoundFilter': 'nothing matches filter',
      'empty.scanning': 'scanning...',
      'empty.emptyFolder': 'empty folder',
      'empty.dupSearching': 'searching duplicates...',
      'empty.log': 'empty for now',

      'junk.countLabel': 'JUNK FILES',
      'junk.sizeLabel': 'CAN BE CLEARED',
      'junk.hint': '// temp, cache, logs, prefetch, thumbs.db and similar — review before delete',

      'dup.groupsLabel': 'DUPE GROUPS',
      'dup.wastedLabel': 'WASTED SPACE',
      'dup.hintDefault': '// after scan we find identical files by MD5 hash',
      'dup.waitScan': '// waiting for main scan to finish...',
      'dup.scanAborted': '// scan aborted — duplicate search not started',
      'dup.running': '// MD5 duplicate search — running in background...',
      'dup.progress': '// duplicate search: {checked} / {total} ({pct}%) · groups: {groups}',
      'dup.none': '// no duplicates found',
      'dup.found': '// found {n} groups — remove extra copies, keep one file each',
      'dup.groupTitle': 'GROUP #{n}',
      'dup.groupMeta': '{size} × {count} · wasted: {wasted} · hash {hash}',
      'dup.original': 'orig.',
      'dup.copy': 'copy {n}',

      'trash.countLabel': 'ITEMS',
      'trash.sizeLabel': 'IN TRASH',
      'trash.hint': '// session log — restore from Windows Recycle Bin',
      'shred.countLabel': 'SHREDDED',
      'shred.sizeLabel': 'FREED',
      'shred.hint': '// session log — permanent delete for this session',

      'stats.total': 'TOTAL SIZE',
      'stats.files': 'FILES',
      'stats.dirs': 'FOLDERS',
      'stats.errors': 'INACCESSIBLE',
      'stats.catMeta': '<b>{size}</b> / {count} files / {share}%',

      'folder.back': '[..] BACK',
      'drive.free': '{size} free',

      'footer.selected': 'SELECTED:',
      'footer.objects': 'item(s)',
      'footer.preview': '[ preview ]',
      'footer.previewTitle': 'Click to review selection',
      'footer.clear': 'Clear',
      'footer.trash': 'To trash',
      'footer.shred': 'Shred',

      'modal.title': '// CONFIRMATION',
      'modal.trash': '// MOVE TO TRASH',
      'modal.shred': '// PERMANENT DELETE',
      'modal.review': '// SELECTED ITEMS',
      'modal.cancel': 'CANCEL',
      'modal.apply': 'APPLY',
      'modal.trashBtn': '⌦ TO TRASH',
      'modal.shredBtn': '☠ SHRED',
      'modal.hintReview': 'Uncheck items to remove them from selection.',
      'modal.hintTrash': 'Uncheck items you do not want to delete.',
      'modal.warnShred': 'WARNING: recovery will be IMPOSSIBLE. Uncheck unwanted items.',
      'modal.selectAll': 'select all',
      'modal.summaryReview': 'In selection: <b>{count}</b> of {total} — <b>{size}</b>',
      'modal.summaryDelete': 'To delete: <b>{count}</b> of {total} — <b>{size}</b>',

      'api.connecting': 'API: connecting...',
      'api.ready': 'API: ready',
      'api.readyAdmin': 'API: ready | ADMIN',
      'api.failed': 'API: connection failed',

      'err.apiNotReady': 'Python API is not ready yet',
      'err.loadDrives': 'Failed to load drive list',
      'err.startScan': 'Failed to start scan',
      'err.folderDialog': 'Failed to open folder dialog',
      'err.apiTimeout': 'Python API did not respond. Close the window and run: python main.py',

      'toast.deletedPartial': 'Deleted: {ok}, errors: {fail} ({err})',
      'toast.shredded': 'Shredded: {n} — freed {size}',
      'toast.trashed': 'To trash: {n} — {size}',

      'status.loaded': 'interface loaded. waiting for Python API...',
      'status.online': 'system online. select a drive or folder to analyze.',
      'status.target': 'target acquired: {path}',
      'status.scanning': 'scanning {path} ...',
      'status.abort': 'abort signal sent...',
      'status.scanDone': 'scan complete: {files} files / {size}',
      'status.scanAborted': 'scan aborted — partial results ({size})',
      'status.dupDone': 'duplicate scan complete: {groups} groups / {size} wasted',
      'status.selectionUpdated': 'selection updated: {n} objects',
      'status.deleting': '{action} {n} objects...',
      'status.deleteDone': 'delete complete: {ok} ok / {fail} failed',
      'status.folderOpen': 'opening folder dialog...',
      'status.folderCancel': 'selection cancelled.',
      'status.folderError': 'folder dialog error.',
      'status.actionTrash': 'trashing',
      'status.actionShred': 'shredding',

      'junk.temp': 'Temporary',
      'junk.cache': 'Cache',
      'junk.log': 'Log',
      'junk.backup': 'Backup / old',
      'junk.dump': 'Dump / crash',
      'junk.system': 'System',
    },
  };

  function t(key, params) {
    const table = strings[lang] || strings.ru;
    let text = table[key] ?? strings.ru[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
      }
    }
    return text;
  }

  function junkLabel(reason) {
    return t('junk.' + reason) !== 'junk.' + reason ? t('junk.' + reason) : reason;
  }

  function getLang() {
    return lang;
  }

  function applyStatic() {
    document.documentElement.lang = lang === 'ru' ? 'ru' : 'en';

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });

    const btn = document.getElementById('btn-lang');
    if (btn) {
      btn.textContent = lang === 'ru' ? 'RU' : 'ENG';
      btn.dataset.lang = lang;
      btn.title = t('lang.switchTo');
      btn.setAttribute('aria-label', t('lang.switchTo'));
    }
  }

  function setLang(next) {
    if (next !== 'ru' && next !== 'en') return;
    if (next === lang) return;
    lang = next;
    localStorage.setItem(STORAGE_KEY, lang);
    applyStatic();
    listeners.forEach((fn) => fn(lang));
  }

  function toggle() {
    setLang(lang === 'ru' ? 'en' : 'ru');
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function localeTag() {
    return lang === 'ru' ? 'ru-RU' : 'en-US';
  }

  applyStatic();

  return { t, junkLabel, getLang, setLang, toggle, applyStatic, onChange, localeTag };
})();

window.I18n = I18n;
window.t = I18n.t;
