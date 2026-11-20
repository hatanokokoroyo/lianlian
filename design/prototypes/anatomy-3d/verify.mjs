#!/usr/bin/env node
/**
 * Headless contract check for the anatomy 3D spike.
 *
 * Requires Node 22+ (global WebSocket/fetch) and Edge or Chrome.
 * Starts a local HTTP server on 127.0.0.1:8765 when one is not already running.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BASE_URL = process.env.VIEWER_URL
  || 'http://127.0.0.1:8765/design/prototypes/anatomy-3d/';
const SCREENSHOT = process.env.SHOT || '/tmp/anatomy-3d-verify.png';

const BROWSER_CANDIDATES = [
  process.env.EDGE_BIN,
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const browser = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
if (!browser) {
  throw new Error('找不到 Edge/Chrome。请用 EDGE_BIN 指定浏览器可执行文件。');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(name, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function ensureServer() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(1500) });
    if (response.ok) return null;
  } catch {
    // Start a server below.
  }

  const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });

  for (let i = 0; i < 50; i += 1) {
    await sleep(120);
    try {
      const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return server;
    } catch {
      // Keep waiting.
    }
  }

  server.kill();
  throw new Error(`本地 HTTP 服务未能在 8765 启动（${BASE_URL}）`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.warnings = [];

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          pending(message);
        }
        return;
      }

      if (message.method === 'Runtime.consoleAPICalled') {
        const text = message.params.args.map((arg) => arg.value ?? arg.description).join(' ');
        if (['error', 'assert'].includes(message.params.type)) {
          this.consoleErrors.push(`console.${message.params.type}: ${text}`);
        } else if (message.params.type === 'warning') {
          this.warnings.push(`console.warning: ${text}`);
        }
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(
          `exception: ${message.params.exceptionDetails.exception?.description
            || message.params.exceptionDetails.text}`,
        );
      } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.consoleErrors.push(`log: ${message.params.entry.text}`);
      }
    };
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error('CDP WebSocket 连接失败'));
    });
    return new Cdp(socket);
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      this.sequence += 1;
      const id = this.sequence;
      this.pending.set(id, resolve);
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForBrowserPort(profile) {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i += 1) {
    try {
      const [port] = (await readFile(portFile, 'utf8')).trim().split('\n');
      if (port) return Number(port);
    } catch {
      // Wait for Chromium to write the file.
    }
    await sleep(100);
  }
  throw new Error('浏览器 DevTools 端口未就绪');
}

async function waitForPage(port) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (target) => target.type === 'page' && target.url.includes('anatomy-3d'),
      );
      if (page) return page;
    } catch {
      // Wait for the page target.
    }
    await sleep(100);
  }
  throw new Error('找不到 viewer 页面 target');
}

async function main() {
  const server = await ensureServer();
  const profile = await mkdtemp(join(tmpdir(), 'anatomy-verify-'));
  const browserProcess = spawn(browser, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-default-apps',
    '--window-size=390,844',
    '--force-device-scale-factor=1',
    `${BASE_URL}?tier=cap3000&view=back`,
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const port = await waitForBrowserPort(profile);
    const page = await waitForPage(port);
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });

    const evaluate = async (expression, awaitPromise = false) => {
      const response = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
      });
      const exception = response.result?.exceptionDetails;
      if (exception) {
        throw new Error(`${exception.text} ${exception.exception?.description ?? ''}`.trim());
      }
      return response.result?.result?.value;
    };

    const waitReady = async () => {
      for (let i = 0; i < 200; i += 1) {
        try {
          if (await evaluate('window.__viewer?.ready === true')) return true;
        } catch {
          // Navigation can replace the execution context.
        }
        await sleep(100);
      }
      return false;
    };

    const settle = () => evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame('
      + '() => setTimeout(() => resolve(true), 30))))',
      true,
    );

    const readStats = async () => JSON.parse(await evaluate(`JSON.stringify({
      ready: window.__viewer?.ready,
      error: window.__viewer?.error,
      stats: window.__viewer?.stats,
      dataset: { ...document.body.dataset },
      ui: getComputedStyle(document.querySelector('#ui')).display
    })`));

    const pressAt = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
        pointerType: 'mouse',
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        pointerType: 'mouse',
      });
    };

    const checkViewport = async (width, height) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await sleep(280);
      const layout = JSON.parse(await evaluate(`JSON.stringify((() => {
        const topbar = document.querySelector('.topbar').getBoundingClientRect();
        const actions = document.querySelector('.top-actions').getBoundingClientRect();
        const stats = document.querySelector('.stats').getBoundingClientRect();
        const stack = document.querySelector('.bottom-stack').getBoundingClientRect();
        return {
          innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          topbar: { left: topbar.left, right: topbar.right },
          actions: { left: actions.left, right: actions.right },
          stats: { left: stats.left, right: stats.right },
          stack: { left: stack.left, right: stack.right }
        };
      })())`));
      const fits = (rect) => rect.left >= -1 && rect.right <= layout.innerWidth + 1;
      check(`${width}x${height} no horizontal overflow`,
        layout.scrollWidth <= layout.innerWidth + 1
        && layout.bodyScrollWidth <= layout.innerWidth + 1
        && fits(layout.topbar)
        && fits(layout.actions)
        && fits(layout.stats)
        && fits(layout.stack),
        `scrollWidth=${layout.scrollWidth}, innerWidth=${layout.innerWidth}`);
    };

    check('viewer ready', await waitReady());
    await sleep(350);
    let result = await readStats();
    check('no viewer error', result.error === null, result.error ?? '');
    check('ready dataset flag', result.dataset.viewerReady === '1');
    check('cap3000 loaded', result.stats.tier === 'cap3000', result.stats.tier);
    check('cap3000 triangles', result.stats.triangles === 743912,
      String(result.stats.triangles));
    check('draw calls <= 5', result.stats.drawCalls <= 5, String(result.stats.drawCalls));
    check('WEBGL_multi_draw available', result.stats.multiDraw === true);

    await checkViewport(390, 844);
    await checkViewport(430, 932);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(280);

    await evaluate(`window.__viewer.setPreset('deep')`);
    await settle();
    result = await readStats();
    check('deep preset uses <= 5 draw calls', result.stats.drawCalls <= 5,
      String(result.stats.drawCalls));
    check('deep preset fades shallow layer', result.stats.visibleInstances < 311,
      `${result.stats.visibleInstances} visible`);

    await evaluate(`document.querySelector('[data-target="transversus-abdominis"]').click()`);
    await settle();
    result = await readStats();
    check('TVA selected', result.stats.selectedSite === 'transversus-abdominis');
    check('TVA has both sides', result.stats.selectedObjectCount === 2);
    check('highlight color', result.stats.highlightColor === '#c8f04a');
    check('TVA front view', await evaluate(
      `document.querySelector('[data-view="front"]').getAttribute('aria-pressed') === 'true'`,
    ));

    await evaluate(`document.querySelector('[data-target="multifidus"]').click()`);
    await settle();
    result = await readStats();
    check('multifidus selected', result.stats.selectedSite === 'multifidus');
    check('multifidus 6 objects', result.stats.selectedObjectCount === 6);

    await evaluate(`window.__viewer.setIsolate(true)`);
    await settle();
    result = await readStats();
    check('isolate shows all multifidus objects', result.stats.visibleInstances === 6,
      `${result.stats.visibleInstances} visible`);
    check('isolate uses <= 5 draw calls', result.stats.drawCalls <= 5,
      String(result.stats.drawCalls));

    await evaluate(`
      window.__viewer.setIsolate(false);
      window.__viewer.setPreset('all');
      window.__viewer.setView('back');
      window.__viewer.selectSite(null);
    `);
    await sleep(350);
    await pressAt(188, 330);
    await settle();
    result = await readStats();
    check('real pointer pick maps batchId to site', Boolean(result.stats.selectedSite),
      result.stats.selectedSite ?? 'none');
    check('picked site has objects', result.stats.selectedObjectCount > 0);

    await evaluate(`window.__viewer.setTier('raw')`, true);
    check('raw tier reload', await waitReady());
    await sleep(300);
    result = await readStats();
    check('raw tier triangles', result.stats.triangles === 1525071,
      String(result.stats.triangles));
    check('raw tier draw calls <= 5', result.stats.drawCalls <= 5,
      String(result.stats.drawCalls));

    await evaluate(`window.__viewer.setTier('cap3000')`, true);
    check('cap3000 tier reload', await waitReady());
    await sleep(300);
    result = await readStats();
    check('cap3000 triangles after switch', result.stats.triangles === 743912,
      String(result.stats.triangles));

    await evaluate(`
      window.__viewer.setIsolate(false);
      window.__viewer.selectSite(null);
      window.__viewer.setPreset('all');
      window.__viewer.setView('back');
      window.__viewer.setSpin(true);
    `);
    await sleep(2200);
    result = await readStats();
    check('spin enabled', result.stats.spin === true);
    check('spin fps > 0', result.stats.fps > 0, String(result.stats.fps));
    check('spin avg/min populated', result.stats.fpsAvg > 0 && result.stats.fpsMin > 0,
      `${result.stats.fpsAvg}/${result.stats.fpsMin}`);
    check('spin min <= avg', result.stats.fpsMin <= result.stats.fpsAvg);
    check('spin draw calls <= 5', result.stats.drawCalls <= 5,
      String(result.stats.drawCalls));
    check('spin stats label', /^\d+\/\d+ fps$/.test(
      await evaluate(`document.querySelector('#stat-fps').textContent`),
    ));

    await evaluate(`window.__viewer.setSpin(false)`);
    await sleep(250);
    result = await readStats();
    check('spin disabled', result.stats.spin === false);
    check('idle fps label restored', await evaluate(
      `document.querySelector('#stat-fps').textContent === '— fps'`,
    ));

    await evaluate(`window.__viewer.setSpin(true)`);
    await sleep(1100);
    result = await readStats();
    check('spin yaw advances', result.stats.spinYaw > 0.1,
      String(result.stats.spinYaw));

    await evaluate(`window.__viewer.setSpin(false)`);
    await sleep(150);
    result = await readStats();
    check('direct spin off preserves yaw', result.stats.spinYaw > 0.1,
      String(result.stats.spinYaw));

    await evaluate(`window.__viewer.setView('back')`);
    await sleep(300);
    result = await readStats();
    check('view stops spin', result.stats.spin === false);
    check('view resets spin yaw', Math.abs(result.stats.spinYaw) < 1e-6,
      String(result.stats.spinYaw));
    check('back view remains active', await evaluate(
      `document.querySelector('[data-view="back"]').getAttribute('aria-pressed') === 'true'`,
    ));
    const backShot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    await writeFile('/tmp/anatomy-3d-back-after-spin.png',
      Buffer.from(backShot.result.data, 'base64'));

    await cdp.send('Page.navigate', {
      url: `${BASE_URL}?tier=cap3000&view=back&preset=deep&site=multifidus&isolate=1&ui=0&spin=1`,
    });
    await sleep(400);
    check('URL contract ready', await waitReady());
    await sleep(1800);
    result = await readStats();
    check('URL ui=0 hides overlay', result.dataset.ui === '0' && result.ui === 'none');
    check('URL spin active', result.stats.spin === true);
    check('URL spin avg/min populated', result.stats.fpsAvg > 0 && result.stats.fpsMin > 0,
      `${result.stats.fpsAvg}/${result.stats.fpsMin}`);
    check('URL site selected', result.stats.selectedSite === 'multifidus');
    check('URL site object count', result.stats.selectedObjectCount === 6);
    check('URL isolate visible instances', result.stats.visibleInstances === 6);
    check('URL isolate draw calls <= 5', result.stats.drawCalls <= 5,
      String(result.stats.drawCalls));

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    await writeFile(SCREENSHOT, Buffer.from(shot.result.data, 'base64'));

    await evaluate('window.__viewer.reset()', true);
    check('reset reloads raw', await waitReady());
    await sleep(350);
    result = await readStats();
    check('reset clears selection', result.stats.selectedSite === null);
    check('reset shows all instances', result.stats.visibleInstances === 311,
      `${result.stats.visibleInstances} visible`);
    check('reset returns to raw/front/all', result.stats.tier === 'raw'
      && await evaluate(`document.querySelector('[data-view="front"]').getAttribute('aria-pressed') === 'true'`
        + ` && document.querySelector('[data-preset="all"]').getAttribute('aria-pressed') === 'true'`));

    check('console clean', cdp.consoleErrors.length === 0,
      cdp.consoleErrors.join(' | ') || 'no errors');
    if (cdp.warnings.length) {
      console.log(`INFO  console warnings: ${cdp.warnings.join(' | ')}`);
    }

    console.log(`INFO  screenshot: ${SCREENSHOT}`);
    console.log('INFO  spin-view regression screenshot: /tmp/anatomy-3d-back-after-spin.png');
    console.log(failures === 0 ? 'RESULT PASS' : `RESULT FAIL (${failures})`);
  } finally {
    cdp?.close();
    browserProcess.kill('SIGTERM');
    server?.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
