import { Terminal } from 'https://esm.sh/@xterm/xterm@5.5.0';
import { FitAddon } from 'https://esm.sh/@xterm/addon-fit@0.10.0';
import LightningFS from 'https://esm.sh/@isomorphic-git/lightning-fs@4.6.0';
import git from 'https://esm.sh/isomorphic-git@1.27.1';
import http from 'https://esm.sh/isomorphic-git@1.27.1/http/web';

const CORS_PROXY = 'https://cors.isomorphic-git.org';
const HOME = '/home/user';
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';

// ---------- الشاشة ----------
const term = new Terminal({ fontSize: 14, cursorBlink: true, theme: { background: '#0b0d10' } });
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));
const refit = () => { try { fit.fit(); } catch {} };
refit();
window.addEventListener('resize', refit);
document.getElementById('term').addEventListener('click', () => term.focus());

const C = { g: '\x1b[32m', b: '\x1b[34;1m', r: '\x1b[31m', y: '\x1b[33m', c: '\x1b[36m', x: '\x1b[0m' };
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const print = (s = '') => term.write(String(s).replace(/\r?\n/g, '\r\n') + '\r\n');
const err = (s) => print(C.r + s + C.x);

// ---------- نظام الملفات (بيتخزن في المتصفح) ----------
const lfs = new LightningFS('webterm');
const pfs = lfs.promises;
let cwd = HOME;

const norm = (p) => {
  const parts = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') parts.pop(); else parts.push(s);
  }
  return '/' + parts.join('/');
};
const resolve = (p = '') =>
  norm(p.startsWith('~') ? HOME + p.slice(1) : p.startsWith('/') ? p : cwd + '/' + p);
const exists = async (p) => { try { await pfs.stat(p); return true; } catch { return false; } };
const isDir = async (p) => { try { return (await pfs.stat(p)).isDirectory(); } catch { return false; } };
const mkdirp = async (p) => {
  let cur = '';
  for (const s of p.split('/').filter(Boolean)) {
    cur += '/' + s;
    if (!(await exists(cur))) await pfs.mkdir(cur);
  }
};
const walk = async (dir, skip = ['.git', 'node_modules']) => {
  const out = [];
  for (const name of await pfs.readdir(dir)) {
    if (skip.includes(name)) continue;
    const p = dir + '/' + name;
    if (await isDir(p)) out.push(...(await walk(p, skip))); else out.push(p);
  }
  return out;
};
const rmrf = async (p) => {
  if (await isDir(p)) {
    for (const n of await pfs.readdir(p)) await rmrf(p + '/' + n);
    await pfs.rmdir(p);
  } else await pfs.unlink(p);
};
const copyRec = async (src, dst) => {
  if (await isDir(src)) {
    await mkdirp(dst);
    for (const n of await pfs.readdir(src)) await copyRec(src + '/' + n, dst + '/' + n);
  } else await pfs.writeFile(dst, await pfs.readFile(src));
};
const base = (p) => p.split('/').filter(Boolean).pop() || '/';
const dirname = (p) => norm(p.split('/').slice(0, -1).join('/') || '/');
const shortCwd = () => (cwd === HOME ? '~' : cwd.startsWith(HOME + '/') ? '~' + cwd.slice(HOME.length) : cwd);

// ---------- أدوات مساعدة ----------
const loadScript = (src) => new Promise((ok, no) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => no(new Error('فشل تحميل ' + src));
  document.head.appendChild(s);
});
const fmt = (a) => {
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a, null, 2); } catch { return String(a); }
};
const download = (name, data) => {
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

// ---------- المحرر ----------
const ed = document.getElementById('editor');
const edText = document.getElementById('edText');
function editFile(path, content) {
  return new Promise((done) => {
    document.getElementById('edTitle').textContent = 'تعديل: ' + path;
    edText.value = content;
    ed.classList.add('on');
    edText.focus();
    const finish = (save) => {
      ed.classList.remove('on');
      document.getElementById('edSave').onclick = document.getElementById('edCancel').onclick = null;
      done(save ? edText.value : null);
    };
    document.getElementById('edSave').onclick = () => finish(true);
    document.getElementById('edCancel').onclick = () => finish(false);
  });
}

// ---------- Python (Pyodide) ----------
let py = null;
async function getPy() {
  if (py) return py;
  print(C.y + 'تحميل Python لأول مرة (حوالي 10MB)...' + C.x);
  if (!window.loadPyodide) await loadScript(PYODIDE);
  py = await window.loadPyodide();
  return py;
}
async function syncToPy(dir) {
  for (const f of await walk(dir)) {
    py.FS.mkdirTree(dirname(f));
    py.FS.writeFile(f, await pfs.readFile(f));
  }
  py.FS.mkdirTree(dir);
  py.FS.chdir(dir);
}
async function syncFromPy(dir) {
  const rec = async (d) => {
    for (const n of py.FS.readdir(d)) {
      if (n === '.' || n === '..' || n === '__pycache__' || n === '.git') continue;
      const p = d + '/' + n;
      if (py.FS.isDir(py.FS.stat(p).mode)) { await mkdirp(p); await rec(p); }
      else await pfs.writeFile(p, py.FS.readFile(p));
    }
  };
  await rec(dir);
}

// ---------- الأوامر ----------
const normUrl = (u) => {
  if (/^https?:\/\//.test(u)) return u;
  if (/^github\.com\//.test(u)) return 'https://' + u;
  if (/^[\w.-]+\/[\w.-]+$/.test(u)) return 'https://github.com/' + u;
  return u;
};

const CMDS = {
  async help({}, { out }) {
    out([
      C.c + 'WebTerm — تيرمينال في المتصفح' + C.x,
      'ملفات:  ls [-a]  cd  pwd  cat  mkdir  touch  rm [-r]  cp [-r]  mv  echo  clear  tree',
      'تعديل:  nano <ملف>   (محرر بسيط: حفظ / إلغاء)',
      'نقل:    download <ملف>   upload   wget <url> [اسم]   curl <url>',
      'git:    git clone <رابط أو user/repo> [مجلد]   git log',
      'تشغيل:  python <ملف.py>   python -c "كود"   pip install <حزمة>   node <ملف.js>   open <ملف.html>',
      'غير ذلك: history  whoami  date  uname  reset-fs',
      'ملاحظة: التوجيه > و >> لازم يكون بمسافات:  echo hi > a.txt',
    ].join('\n'));
  },
  async pwd({}, { out }) { out(cwd); },
  async whoami({}, { out }) { out('user'); },
  async date({}, { out }) { out(new Date().toString()); },
  async uname({}, { out }) { out('WebTerm 1.0 (browser / WebAssembly)'); },
  async clear() { term.clear(); term.write('\x1b[2J\x1b[H'); },
  async history({}, { out }) { out(hist.map((h, i) => `${i + 1}  ${h}`).join('\n')); },
  async echo(a, { out }) { out(a.join(' ')); },
  async ls(a, { out }) {
    const all = a.includes('-a');
    const target = resolve(a.find((x) => !x.startsWith('-')) || '.');
    if (!(await isDir(target))) return out(base(target));
    const names = (await pfs.readdir(target)).filter((n) => all || !n.startsWith('.')).sort();
    const parts = [];
    for (const n of names) parts.push((await isDir(target + '/' + n)) ? C.b + n + '/' + C.x : n);
    out(parts.join('  '));
  },
  async cd(a) {
    const t = resolve(a[0] || '~');
    if (!(await isDir(t))) return err('cd: مجلد غير موجود: ' + (a[0] || ''));
    cwd = t;
  },
  async cat(a, { out }) {
    for (const f of a) {
      try { out(await pfs.readFile(resolve(f), 'utf8')); } catch { err('cat: ' + f + ': غير موجود'); }
    }
  },
  async mkdir(a) { for (const d of a.filter((x) => !x.startsWith('-'))) await mkdirp(resolve(d)); },
  async touch(a) {
    for (const f of a) { const p = resolve(f); if (!(await exists(p))) await pfs.writeFile(p, '', 'utf8'); }
  },
  async rm(a) {
    const rec = a.includes('-r') || a.includes('-rf') || a.includes('-fr');
    for (const f of a.filter((x) => !x.startsWith('-'))) {
      const p = resolve(f);
      if (!(await exists(p))) { err('rm: ' + f + ': غير موجود'); continue; }
      if ((await isDir(p)) && !rec) { err('rm: ' + f + ' مجلد (استخدم -r)'); continue; }
      await rmrf(p);
    }
  },
  async cp(a) {
    const rec = a.includes('-r');
    const [s, d] = a.filter((x) => !x.startsWith('-'));
    if (!s || !d) return err('الاستخدام: cp [-r] مصدر وجهة');
    const src = resolve(s);
    let dst = resolve(d);
    if (!(await exists(src))) return err('cp: المصدر غير موجود');
    if ((await isDir(src)) && !rec) return err('cp: ' + s + ' مجلد (استخدم -r)');
    if (await isDir(dst)) dst += '/' + base(src);
    await copyRec(src, dst);
  },
  async mv(a) {
    const [s, d] = a;
    if (!s || !d) return err('الاستخدام: mv مصدر وجهة');
    const src = resolve(s);
    let dst = resolve(d);
    if (!(await exists(src))) return err('mv: المصدر غير موجود');
    if (await isDir(dst)) dst += '/' + base(src);
    await copyRec(src, dst);
    await rmrf(src);
  },
  async tree(a, { out }) {
    const lines = [];
    const rec = async (d, pre) => {
      const names = (await pfs.readdir(d)).filter((n) => n !== '.git').sort();
      for (const [i, n] of names.entries()) {
        const last = i === names.length - 1;
        const p = d + '/' + n;
        lines.push(pre + (last ? '└── ' : '├── ') + n);
        if (await isDir(p)) await rec(p, pre + (last ? '    ' : '│   '));
      }
    };
    const root = resolve(a[0] || '.');
    lines.push(root);
    await rec(root, '');
    out(lines.join('\n'));
  },
  async nano(a) {
    if (!a[0]) return err('الاستخدام: nano <ملف>');
    const p = resolve(a[0]);
    let content = '';
    try { content = await pfs.readFile(p, 'utf8'); } catch {}
    await mkdirp(dirname(p));
    const res = await editFile(p, content);
    if (res !== null) { await pfs.writeFile(p, res, 'utf8'); print(C.g + 'تم الحفظ' + C.x); }
    term.focus();
  },
  async download(a) {
    if (!a[0]) return err('الاستخدام: download <ملف>');
    const p = resolve(a[0]);
    if (!(await exists(p)) || (await isDir(p))) return err('ملف غير موجود');
    download(base(p), await pfs.readFile(p));
  },
  async upload() {
    const inp = document.getElementById('up');
    await new Promise((done) => {
      inp.onchange = async () => {
        for (const f of inp.files) await pfs.writeFile(cwd + '/' + f.name, new Uint8Array(await f.arrayBuffer()));
        print(C.g + 'تم رفع ' + inp.files.length + ' ملف' + C.x);
        inp.value = ''; done();
      };
      inp.oncancel = () => done();
      inp.click();
    });
  },
  async wget(a) {
    if (!a[0]) return err('الاستخدام: wget <url> [اسم]');
    const r = await fetch(normUrl(a[0]));
    if (!r.ok) return err('HTTP ' + r.status);
    const name = a[1] || base(new URL(normUrl(a[0])).pathname) || 'index.html';
    await pfs.writeFile(resolve(name), new Uint8Array(await r.arrayBuffer()));
    print(C.g + 'تم الحفظ: ' + name + C.x);
  },
  async curl(a, { out }) {
    if (!a[0]) return err('الاستخدام: curl <url>');
    const r = await fetch(normUrl(a[0]));
    out(await r.text());
  },
  async git(a, { out }) {
    const sub = a[0];
    if (sub === 'clone') {
      if (!a[1]) return err('الاستخدام: git clone <رابط أو user/repo> [مجلد]');
      const url = normUrl(a[1]);
      const name = a[2] || base(url).replace(/\.git$/, '');
      const dir = resolve(name);
      print('Cloning into ' + name + '...');
      await mkdirp(dir);
      await git.clone({
        fs: lfs, http, dir, url, corsProxy: CORS_PROXY, singleBranch: true, depth: 1,
        onProgress: (e) => term.write('\r\x1b[K' + e.phase + ' ' + e.loaded + (e.total ? '/' + e.total : '')),
      });
      term.write('\r\x1b[K');
      print(C.g + 'تم. اكتب: cd ' + name + C.x);
    } else if (sub === 'log') {
      const commits = await git.log({ fs: lfs, dir: cwd, depth: 5 });
      out(commits.map((c) => C.y + c.oid.slice(0, 7) + C.x + ' ' + c.commit.message.split('\n')[0]).join('\n'));
    } else err('git: الأوامر المدعومة: clone, log');
  },
  async python(a, { out }) {
    if (!a[0]) return err('الاستخدام: python <ملف.py>  أو  python -c "كود"');
    if (!cwd.startsWith(HOME)) return err('python بيشتغل بس جوه ' + HOME);
    const p = await getPy();
    let code, argv;
    if (a[0] === '-c') { code = a[1] || ''; argv = ['-c']; }
    else {
      try { code = await pfs.readFile(resolve(a[0]), 'utf8'); } catch { return err('ملف غير موجود: ' + a[0]); }
      argv = a;
    }
    p.setStdout({ batched: (s) => out(s) });
    p.setStderr({ batched: (s) => out(C.r + s + C.x) });
    await syncToPy(cwd);
    try {
      await p.loadPackagesFromImports(code);
      p.globals.set('__argv__', argv);
      await p.runPythonAsync('import sys\nsys.argv = list(__argv__)\n');
      await p.runPythonAsync(code);
    } catch (e) { out(C.r + String(e.message || e) + C.x); }
    await syncFromPy(cwd);
  },
  async pip(a, { out }) {
    if (a[0] !== 'install' || !a[1]) return err('الاستخدام: pip install <حزمة>');
    const p = await getPy();
    await p.loadPackage('micropip');
    const mp = p.pyimport('micropip');
    for (const pkg of a.slice(1).filter((x) => !x.startsWith('-'))) {
      try { await mp.install(pkg); out(C.g + 'تم تثبيت ' + pkg + C.x); }
      catch (e) { out(C.r + 'فشل ' + pkg + ': ' + (e.message || e).toString().split('\n').pop() + C.x); }
    }
    out(C.y + 'ملاحظة: بيدعم بس الحزم Pure-Python وحزم Pyodide الجاهزة.' + C.x);
  },
  async node(a, { out }) {
    if (!a[0]) return err('الاستخدام: node <ملف.js>  أو  node -e "كود"');
    let code;
    if (a[0] === '-e') code = a[1] || '';
    else { try { code = await pfs.readFile(resolve(a[0]), 'utf8'); } catch { return err('ملف غير موجود: ' + a[0]); } }
    const log = (...x) => out(x.map(fmt).join(' '));
    const con = { log, info: log, warn: log, error: (...x) => out(C.r + x.map(fmt).join(' ') + C.x) };
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const req = (n) => { throw new Error('require("' + n + '") غير مدعومة (ده مش Node حقيقي)'); };
    const proc = { argv: ['node', ...a], env: {}, cwd: () => cwd, exit() {}, platform: 'browser' };
    try { await new AsyncFn('console', 'require', 'process', code)(con, req, proc); }
    catch (e) { out(C.r + String(e.stack || e) + C.x); }
  },
  async open(a) {
    if (!a[0]) return err('الاستخدام: open <ملف.html>');
    const p = resolve(a[0]);
    let html;
    try { html = await pfs.readFile(p, 'utf8'); } catch { return err('ملف غير موجود'); }
    const dir = dirname(p);
    const readRel = async (rel) => { try { return await pfs.readFile(resolve2(dir, rel), 'utf8'); } catch { return null; } };
    const resolve2 = (d, rel) => norm(rel.startsWith('/') ? rel : d + '/' + rel);
    const isLocal = (u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:');
    for (const m of [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]) {
      if (!isLocal(m[1])) continue;
      const css = await readRel(m[1]);
      if (css !== null) html = html.replace(m[0], '<style>' + css + '</style>');
    }
    for (const m of [...html.matchAll(/<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi)]) {
      if (!isLocal(m[2])) continue;
      const js = await readRel(m[2]);
      if (js !== null) html = html.replace(m[0], '<script' + m[1] + m[3] + '>' + js.replace(/<\/script>/g, '<\\/script>') + '</script>');
    }
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
    print(C.g + 'اتفتح في تبويب جديد (CSS و JS المحليين اتدمجوا تلقائيًا)' + C.x);
  },
  async 'reset-fs'() {
    await rmrf(HOME).catch(() => {});
    await mkdirp(HOME);
    cwd = HOME;
    print(C.y + 'تم مسح كل الملفات.' + C.x);
  },
};
CMDS.python3 = CMDS.python;
CMDS.edit = CMDS.nano;
CMDS.vi = CMDS.nano;
CMDS.vim = CMDS.nano;
CMDS.dir = CMDS.ls;
CMDS.type = CMDS.cat;

// ---------- المفسّر ----------
const tokenize = (line) => {
  const out = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
};

async function run(line) {
  const toks = tokenize(line);
  if (!toks.length) return;
  let redir = null, args = toks;
  const i = toks.findIndex((t) => t === '>' || t === '>>');
  if (i >= 0) {
    redir = { append: toks[i] === '>>', file: toks[i + 1] };
    args = toks.slice(0, i);
    if (!redir.file) return err('اكتب اسم الملف بعد >');
  }
  const [cmd, ...rest] = args;
  const fn = CMDS[cmd];
  if (!fn) return err(cmd + ': command not found (اكتب help)');
  const chunks = [];
  const ctx = { out: (s) => (redir ? chunks.push(stripAnsi(String(s))) : print(s)) };
  await fn(rest, ctx);
  if (redir) {
    const p = resolve(redir.file);
    let old = '';
    if (redir.append) { try { old = await pfs.readFile(p, 'utf8'); } catch {} }
    await pfs.writeFile(p, old + chunks.join('\n') + (chunks.length ? '\n' : ''), 'utf8');
  }
}

// ---------- سطر الإدخال ----------
let buf = '';
let busy = false;
let hist = [];
try { hist = JSON.parse(localStorage.getItem('webterm_hist') || '[]'); } catch {}
let hi = hist.length;
const promptStr = () => C.g + 'user@web' + C.x + ':' + C.b + shortCwd() + C.x + '$ ';
const redraw = () => term.write('\r\x1b[K' + promptStr() + buf);

async function complete() {
  const sp = buf.lastIndexOf(' ');
  const word = buf.slice(sp + 1);
  const first = sp === -1;
  let cands = [];
  if (first) cands = Object.keys(CMDS).filter((c) => c.startsWith(word));
  else {
    const slash = word.lastIndexOf('/');
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
    const namePart = word.slice(slash + 1);
    try {
      const dir = resolve(dirPart || '.');
      for (const n of await pfs.readdir(dir)) {
        if (!n.startsWith(namePart)) continue;
        cands.push(dirPart + n + ((await isDir(dir + '/' + n)) ? '/' : ''));
      }
    } catch {}
  }
  if (cands.length === 1) { buf = buf.slice(0, sp + 1) + cands[0] + (first ? ' ' : ''); redraw(); }
  else if (cands.length > 1) { term.write('\r\n' + cands.join('  ') + '\r\n'); redraw(); }
}

async function handle(d) {
  if (busy) return;
  if (d === '\x1b[A') { if (hi > 0) { hi--; buf = hist[hi]; redraw(); } return; }
  if (d === '\x1b[B') { if (hi < hist.length) { hi++; buf = hist[hi] || ''; redraw(); } return; }
  if (d.startsWith('\x1b')) return;
  for (const ch of d) {
    if (ch === '\r' || ch === '\n') {
      term.write('\r\n');
      const line = buf.trim();
      buf = '';
      if (line) {
        hist.push(line); hist = hist.slice(-200); hi = hist.length;
        try { localStorage.setItem('webterm_hist', JSON.stringify(hist)); } catch {}
        busy = true;
        try { await run(line); } catch (e) { err(String(e.message || e)); }
        busy = false;
      }
      term.write(promptStr());
    } else if (ch === '\x7f' || ch === '\b') {
      if (buf.length) { buf = buf.slice(0, -1); term.write('\b \b'); }
    } else if (ch === '\t') { await complete(); }
    else if (ch === '\x03') { term.write('^C\r\n'); buf = ''; term.write(promptStr()); }
    else if (ch >= ' ') { buf += ch; term.write(ch); }
  }
}

term.onData(handle);
document.querySelectorAll('#keys button').forEach((b) => {
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', () => { handle(b.dataset.k); term.focus(); });
});

// ---------- البداية ----------
(async () => {
  await mkdirp(HOME);
  print(C.c + 'WebTerm' + C.x + ' — تيرمينال في المتصفح (git + python + node)');
  print('اكتب ' + C.y + 'help' + C.x + ' للأوامر. جرّب: git clone octocat/Hello-World');
  term.write(promptStr());
  term.focus();
})();
