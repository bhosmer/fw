// Headless Chrome, driven over the DevTools protocol with nothing but Node's
// own WebSocket, and a static server for the app: enough to load pages and
// evaluate code in them, with no packages to install.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

const CHROME = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(existsSync);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

// Serve root on a free port; resolves to the base URL.
export function serve(root) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, path.endsWith('/') ? path + 'index.html' : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

// Chromes of ours left running by runs that ended without closing them
// (killed, or timed out): orphans, their parent gone. Each keeps drawing,
// unthrottled, until stopped; so each launch stops them first, and removes
// their profiles.
function sweep() {
  let ps = '';
  try {
    ps = execSync('ps -eo pid,ppid,command', { encoding: 'utf8' });
  } catch {
    return;
  }
  const used = new Set();
  for (const line of ps.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+.*--user-data-dir=(\S*fw-chrome-\S+)/);
    if (!m || line.includes('--type=')) continue;
    if (m[2] !== '1') used.add(m[3]);
    else
      try {
        process.kill(+m[1]);
      } catch {}
  }
  // (And the profiles of any not still running. Best effort: one just
  // stopped may still be writing to its own.)
  for (const name of readdirSync(tmpdir())) {
    const dir = join(tmpdir(), name);
    if (!name.startsWith('fw-chrome-') || used.has(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

export async function launch() {
  if (!CHROME) throw new Error('no Chrome found (set CHROME to its path)');
  sweep();
  const dir = mkdtempSync(join(tmpdir(), 'fw-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--enable-unsafe-swiftshader', '--window-size=1280,720', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  // (However this process ends, short of being killed outright, Chrome goes
  // with it.)
  const stop = () => proc.kill();
  process.once('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => (stop(), process.exit(130)));
  // Chrome says where it listens on stderr.
  const ws = await new Promise((ok, fail) => {
    let err = '';
    const t = setTimeout(() => fail(new Error('Chrome did not start:\n' + err)), 15000);
    proc.stderr.on('data', (b) => {
      err += b;
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); ok(m[1]); }
    });
  });
  const http = ws.replace('ws://', 'http://').replace(/\/devtools\/browser\/.*/, '');
  return {
    async page() {
      const target = await (await fetch(`${http}/json/new?about:blank`, { method: 'PUT' })).json();
      return Page.open(target.webSocketDebuggerUrl);
    },
    async close() {
      proc.kill();
      await new Promise((ok) => proc.once('exit', ok));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

class Page {
  static async open(url) {
    const p = new Page();
    p.sock = new WebSocket(url);
    p.id = 0;
    p.waiting = new Map();
    p.events = [];
    p.errors = [];
    p.sock.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && p.waiting.has(msg.id)) {
        const { ok, fail } = p.waiting.get(msg.id);
        p.waiting.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) {
        if (msg.method === 'Runtime.exceptionThrown') p.errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') p.errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
        for (const e of p.events) e(msg);
      }
    };
    await new Promise((ok, fail) => { p.sock.onopen = ok; p.sock.onerror = fail; });
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    return p;
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.sock.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.waiting.set(id, { ok, fail }));
  }

  // Load url, with setup (source text) run before any of the page's own code.
  async goto(url, setup = '') {
    if (this.setupId) await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.setupId });
    this.setupId = setup ? (await this.send('Page.addScriptToEvaluateOnNewDocument', { source: setup })).identifier : null;
    this.errors = [];
    const loaded = new Promise((ok) => {
      const on = (m) => { if (m.method === 'Page.loadEventFired') { this.events.splice(this.events.indexOf(on), 1); ok(); } };
      this.events.push(on);
    });
    await this.send('Page.navigate', { url });
    await loaded;
    // (The app starts after the page has shown, and once its programs are
    // built: wait for it, or until it says it cannot, or for long enough to
    // say it did not.)
    await this.eval(`new Promise((ok) => { const t0 = Date.now(); const f = () => (window.fw || document.querySelector('#help.error') || document.getElementById('loading')?.textContent.startsWith('could not') || Date.now() - t0 > 30000 ? ok() : setTimeout(f, 10)); f(); })`);
  }

  // Evaluate an expression (it may await) in the page; returns its value.
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  close() { this.sock.close(); }
}
