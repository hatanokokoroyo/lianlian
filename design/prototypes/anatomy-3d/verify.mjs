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
const PRODUCT_SCREENSHOT = process.env.PRODUCT_SHOT || '/tmp/anatomy-3d-product.png';

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
    `${BASE_URL}?view=back&autoTier=0`,
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

    const readUi = async () => JSON.parse(await evaluate(`JSON.stringify((() => {
      const trigger = document.querySelector('#preset-trigger');
      const menu = document.querySelector('#preset-menu');
      const isolate = document.querySelector('#sheet-isolate');
      const hint = document.querySelector('#gesture-hint');
      const loading = document.querySelector('#loading');
      const hintStyle = getComputedStyle(hint);
      return {
        views: [...document.querySelectorAll('[data-view]')].map((button) => ({
          id: button.dataset.view,
          label: button.getAttribute('aria-label'),
          pressed: button.getAttribute('aria-pressed'),
          height: button.getBoundingClientRect().height,
        })),
        preset: {
          label: document.querySelector('#preset-label').textContent,
          ariaLabel: trigger.getAttribute('aria-label'),
          expanded: trigger.getAttribute('aria-expanded'),
          hidden: menu.hidden,
          disabled: trigger.getAttribute('aria-disabled'),
          opacity: getComputedStyle(trigger).opacity,
          items: [...menu.querySelectorAll('[role="menuitemradio"]')].map((item) => ({
            id: item.dataset.preset,
            checked: item.getAttribute('aria-checked'),
            height: item.getBoundingClientRect().height,
            disabled: item.getAttribute('aria-disabled'),
            opacity: getComputedStyle(item).opacity,
          })),
        },
        isolate: {
          text: isolate.textContent.trim(),
          pressed: isolate.getAttribute('aria-pressed'),
          disabled: isolate.disabled,
        },
        hint: {
          text: hint.textContent.trim(),
          dismissed: hint.classList.contains('is-dismissed'),
          visible: hintStyle.visibility !== 'hidden' && hint.getBoundingClientRect().height > 0,
        },
        spike: {
          tier: Boolean(document.querySelector('.tier-switch')),
          spin: Boolean(document.querySelector('#spin-toggle')),
          stats: Boolean(document.querySelector('.stats')),
          quick: Boolean(document.querySelector('.quick-row')),
          legend: Boolean(document.querySelector('#hint')),
        },
        loading: {
          title: document.querySelector('#loading-title').textContent.trim(),
          text: loading.textContent,
          bar: Boolean(document.querySelector('.loading-bar')),
          hidden: loading.classList.contains('is-hidden'),
        },
      };
    })())`));

    const readSheet = async () => JSON.parse(await evaluate(`JSON.stringify((() => {
      const sheet = document.querySelector('#detail-sheet');
      const canvas = document.querySelector('#scene');
      const head = document.querySelector('#sheet-head');
      const sheetRect = sheet.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const headRect = head.getBoundingClientRect();
      return {
        hidden: sheet.hidden,
        open: sheet.classList.contains('is-open'),
        title: document.querySelector('#sheet-title').textContent.trim(),
        side: document.querySelector('#sheet-side').textContent.trim(),
        worst: document.querySelector('#sheet-worst').textContent.trim(),
        axes: [...document.querySelectorAll('#sheet-axes .axis-chip')].map((chip) => ({
          axis: chip.dataset.axis,
          state: chip.dataset.state,
          text: chip.textContent.trim(),
        })),
        primary: document.querySelector('#sheet-isolate').textContent.trim(),
        primaryPressed: document.querySelector('#sheet-isolate').getAttribute('aria-pressed'),
        primaryDisabled: document.querySelector('#sheet-isolate').disabled,
        primaryLabel: document.querySelector('#sheet-isolate').getAttribute('aria-label'),
        primaryTitle: document.querySelector('#sheet-isolate').getAttribute('title'),
        secondary: document.querySelector('#sheet-open').textContent.trim(),
        secondaryHidden: document.querySelector('#sheet-open').hidden,
        secondaryDisabled: document.querySelector('#sheet-open').disabled,
        rect: { top: sheetRect.top, height: sheetRect.height },
        head: {
          x: headRect.left + headRect.width / 2,
          y: headRect.top + headRect.height / 2,
        },
        canvas: { width: canvasRect.width, height: canvasRect.height },
      };
    })())`));

    const readAttention = async () => JSON.parse(await evaluate(`JSON.stringify((() => {
      const trigger = document.querySelector('#attention-trigger');
      const sheet = document.querySelector('#attention-sheet');
      const legend = document.querySelector('#attention-legend');
      const list = document.querySelector('#attention-list');
      const canvas = document.querySelector('#scene');
      const canvasRect = canvas.getBoundingClientRect();
      const sheetRect = sheet.getBoundingClientRect();
      const text = (node) => node.textContent.trim().replace(/\\s+/g, ' ');
      return {
        triggerHidden: trigger.hidden,
        triggerText: text(trigger),
        expanded: trigger.getAttribute('aria-expanded'),
        controls: trigger.getAttribute('aria-controls'),
        hidden: sheet.hidden,
        open: sheet.classList.contains('is-open'),
        title: text(document.querySelector('#attention-title')),
        legend: legend.getAttribute('aria-label'),
        groups: [...list.querySelectorAll('.attention-group-title')].map(text),
        rows: [...list.querySelectorAll('.attention-row')].map((row) => ({
          site: row.dataset.siteId,
          side: row.dataset.side,
          text: text(row),
          label: row.getAttribute('aria-label'),
          missing: Boolean(row.querySelector('.attention-missing')),
        })),
        missing: list.querySelectorAll('.attention-missing').length,
        sheetTop: sheetRect.top,
        canvas: { width: canvasRect.width, height: canvasRect.height },
      };
    })())`));

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

    const drag = async (x1, y1, x2, y2, steps = 14) => {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: x1,
        y: y1,
        button: 'left',
        buttons: 1,
        clickCount: 1,
        pointerType: 'mouse',
      });
      for (let i = 1; i <= steps; i += 1) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: x1 + ((x2 - x1) * i) / steps,
          y: y1 + ((y2 - y1) * i) / steps,
          button: 'left',
          buttons: 1,
          pointerType: 'mouse',
        });
      }
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: x2,
        y: y2,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        pointerType: 'mouse',
      });
    };

    const click = (selector) => evaluate(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );

    const readCamera = async () => JSON.parse(await evaluate(`JSON.stringify({
      distance: window.__viewer.stats.cameraDistance,
      target: window.__viewer.stats.cameraTarget,
      position: window.__viewer.stats.cameraPosition,
      minDistance: window.__viewer.stats.cameraMinDistance,
      maxDistance: window.__viewer.stats.cameraMaxDistance,
    })`));

    const readTierNotice = async () => JSON.parse(await evaluate(`JSON.stringify((() => {
      const notice = document.querySelector('#tier-notice');
      const style = getComputedStyle(notice);
      return {
        text: notice.textContent.trim(),
        hidden: notice.hidden,
        visible: !notice.hidden
          && style.visibility !== 'hidden'
          && notice.classList.contains('is-visible'),
        count: window.__viewer.stats.tierNoticeCount,
      };
    })())`));

    const nearly = (a, b, epsilon = 1e-4) => Math.abs(a - b) <= epsilon;
    const sameNumbers = (a, b, epsilon) => Array.isArray(a)
      && Array.isArray(b)
      && a.length === b.length
      && a.every((value, index) => nearly(value, b[index], epsilon));
    const sameCamera = (a, b) => nearly(a.distance, b.distance, 1e-3)
      && sameNumbers(a.target, b.target, 1e-4);
    const sameCameraSnapshot = (a, b) => sameCamera(a, b)
      && sameNumbers(a.position, b.position, 1e-3)
      && nearly(a.minDistance, b.minDistance, 1e-4)
      && nearly(a.maxDistance, b.maxDistance, 1e-4);

    const checkViewport = async (width, height) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await sleep(280);
      const layout = JSON.parse(await evaluate(`JSON.stringify((() => {
        const stack = document.querySelector('.bottom-stack').getBoundingClientRect();
        const controls = document.querySelector('.controls').getBoundingClientRect();
        const hint = document.querySelector('#gesture-hint').getBoundingClientRect();
        return {
          innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          stack: { left: stack.left, right: stack.right },
          controls: { left: controls.left, right: controls.right },
          hint: { left: hint.left, right: hint.right }
        };
      })())`));
      const fits = (rect) => rect.left >= -1 && rect.right <= layout.innerWidth + 1;
      check(`${width}x${height} no horizontal overflow`,
        layout.scrollWidth <= layout.innerWidth + 1
        && layout.bodyScrollWidth <= layout.innerWidth + 1
        && fits(layout.stack)
        && fits(layout.controls)
        && fits(layout.hint),
        `scrollWidth=${layout.scrollWidth}, innerWidth=${layout.innerWidth}`);
    };

    check('viewer ready', await waitReady());
    await sleep(350);
    let result = await readStats();
    let ui = await readUi();
    check('no viewer error', result.error === null, result.error ?? '');
    check('ready dataset flag', result.dataset.viewerReady === '1');
    check('default tier is raw', result.stats.tier === 'raw', result.stats.tier);
    check('raw triangles', result.stats.triangles === 1525071,
      String(result.stats.triangles));
    check('draw calls <= 5', result.stats.drawCalls <= 5, String(result.stats.drawCalls));
    check('WEBGL_multi_draw available', result.stats.multiDraw === true);

    check('loading copy has no percentage',
      ui.loading.title === '正在载入身体模型…'
      && !ui.loading.bar
      && !/\d+\s*%/.test(ui.loading.text),
      ui.loading.title);
    check('loading overlay closes after ready', ui.loading.hidden);
    check('four product view controls',
      ui.views.map((view) => view.id).join(',') === 'front,back,left,right',
      ui.views.map((view) => view.id).join(','));
    check('view controls have readable labels',
      ui.views.every((view) => ['正视', '背视', '左视', '右视'].includes(view.label)),
      ui.views.map((view) => view.label).join(','));
    check('view controls are 44px tall',
      ui.views.every((view) => view.height >= 44),
      ui.views.map((view) => Math.round(view.height)).join(','));
    check('one view selected initially', ui.views.filter((view) => view.pressed === 'true').length === 1,
      ui.views.map((view) => `${view.id}:${view.pressed}`).join(' '));
    check('URL view reflected by back button',
      ui.views.find((view) => view.id === 'back')?.pressed === 'true');
    check('layer menu starts closed',
      ui.preset.expanded === 'false' && ui.preset.hidden
      && ui.preset.label === '全身' && ui.preset.ariaLabel === '层级：全身');
    check('spike panels are gone',
      !ui.spike.tier && !ui.spike.spin && !ui.spike.stats && !ui.spike.quick && !ui.spike.legend,
      JSON.stringify(ui.spike));
    check('first-use hint is visible',
      !ui.hint.dismissed && ui.hint.visible
      && ui.hint.text === '拖动旋转 · 双指缩放 · 点肌肉看详情',
      ui.hint.text);

    const exportedDefault = JSON.parse(
      await evaluate('JSON.stringify(window.__viewer.exportState())'),
    );
    const exportedDefaultCamera = await readCamera();
    check('exportState carries the camera, view, preset and empty selection',
      exportedDefault.camera?.position?.length === 3
      && exportedDefault.view === 'back'
      && exportedDefault.preset === 'all'
      && exportedDefault.selectedSite === null
      && exportedDefault.selectedSide === null
      && exportedDefault.isolate === false
      && exportedDefault.saved === null,
      JSON.stringify(exportedDefault));

    await evaluate(`
      window.__viewer.setView('left');
      window.__viewer.setPreset('deep');
      window.__viewer.selectSite('multifidus', 'left');
    `);
    await settle();
    result = await readStats();
    check('view, preset and selection changed before restoring',
      result.stats.view === 'left'
      && result.stats.preset === 'deep'
      && result.stats.selectedSite === 'multifidus'
      && result.stats.selectedSide === 'left',
      `${result.stats.view}/${result.stats.preset}/${result.stats.selectedSite}/${result.stats.selectedSide}`);
    const framesBeforeRestore = result.stats.frameCommands;

    await evaluate(`window.__viewer.restoreState(${JSON.stringify(exportedDefault)})`);
    await settle();
    result = await readStats();
    check('restoreState returns camera, view, preset and selection to the export',
      sameCameraSnapshot(exportedDefaultCamera, await readCamera())
      && result.stats.view === 'back'
      && result.stats.preset === 'all'
      && result.stats.selectedSite === null
      && result.stats.selectedSide === null
      && result.stats.isolate === false,
      JSON.stringify({
        camera: await readCamera(),
        view: result.stats.view,
        preset: result.stats.preset,
        site: result.stats.selectedSite,
      }));
    check('restoring a ready viewer issues no framing command',
      result.stats.frameCommands === framesBeforeRestore,
      `${framesBeforeRestore} -> ${result.stats.frameCommands}`);

    await evaluate(`
      window.__viewer.setView('left');
      window.__viewer.setPreset('deep');
      window.__viewer.selectSite('multifidus', 'left');
    `);
    await settle();
    const pendingSnapshot = JSON.parse(
      await evaluate('JSON.stringify(window.__viewer.exportState())'),
    );
    const pendingCamera = await readCamera();

    await cdp.send('Page.navigate', { url: `${BASE_URL}?view=front&autoTier=0` });
    let queued = false;
    for (let attempt = 0; attempt < 120 && !queued; attempt += 1) {
      try {
        const value = await evaluate(`(() => {
          if (!window.__viewer) return 'missing';
          if (window.__viewer.ready) return 'ready';
          return window.__viewer.restoreState(${JSON.stringify(pendingSnapshot)});
        })()`);
        if (value === true) queued = true;
        if (value === 'ready') break;
      } catch {
        // Navigation may still replace the execution context.
      }
      await sleep(10);
    }
    check('restoreState is accepted while the model is still loading', queued === true);
    check('model ready after a queued restore', await waitReady());
    await settle();
    result = await readStats();
    check('queued restore lands on the exported camera without a body frame',
      sameCameraSnapshot(pendingCamera, await readCamera())
      && result.stats.frameCommands === 0,
      JSON.stringify({
        camera: await readCamera(),
        frames: result.stats.frameCommands,
        last: result.stats.lastFrameCommand,
      }));
    check('queued restore keeps view, preset, site and side',
      result.stats.view === 'left'
      && result.stats.preset === 'deep'
      && result.stats.selectedSite === 'multifidus'
      && result.stats.selectedSide === 'left',
      `${result.stats.view}/${result.stats.preset}/${result.stats.selectedSite}/${result.stats.selectedSide}`);

    await cdp.send('Page.navigate', { url: `${BASE_URL}?view=back&autoTier=0` });
    check('baseline reload after restore', await waitReady());
    await settle();

    await evaluate(`window.__viewer.setHighlight({
      palette: {
        left: '#123456',
        right: '#654321',
        abnormal: '#ff0000',
        selected: '#00ff00'
      },
      sites: [
        { siteId: 'transversus-abdominis', side: null },
        { siteId: 'gluteus-maximus', side: 'left' },
        { siteId: 'lumbar-vertebrae', side: null },
        { siteId: 'missing-in-model', side: 'right' }
      ]
    })`);
    await settle();
    result = await readStats();
    check('highlight keeps the pushed site set',
      result.stats.highlightSites.length === 4,
      JSON.stringify(result.stats.highlightSites));
    check('null side colors both sides, named side only one, bone ignored',
      result.stats.abnormalObjectCount === 3,
      String(result.stats.abnormalObjectCount));
    check('highlighted sites list only muscle meshes',
      result.stats.highlightedSiteIds.slice().sort().join(',')
        === 'gluteus-maximus,transversus-abdominis',
      result.stats.highlightedSiteIds.join(','));
    check('missing meshes are reported, not dropped',
      result.stats.missingSites.join(',') === 'missing-in-model',
      result.stats.missingSites.join(','));
    check('no selection means no highlight color',
      result.stats.highlightColor === null,
      String(result.stats.highlightColor));

    await evaluate(`window.__viewer.selectSite('gluteus-maximus')`);
    await settle();
    result = await readStats();
    check('selection overrides abnormal and follows the palette',
      result.stats.highlightColor === '#00ff00',
      String(result.stats.highlightColor));
    check('selected abnormal site is not counted as abnormal',
      result.stats.abnormalObjectCount === 2,
      String(result.stats.abnormalObjectCount));

    await evaluate(`
      window.__viewer.selectSite(null);
      window.__viewer.setHighlight({ sites: [] });
    `);
    await settle();
    result = await readStats();
    check('empty highlight set clears red sites',
      result.stats.highlightSites.length === 0
      && result.stats.highlightedSiteIds.length === 0
      && result.stats.abnormalObjectCount === 0
      && result.stats.missingSites.length === 0,
      JSON.stringify({
        sites: result.stats.highlightSites,
        highlighted: result.stats.highlightedSiteIds,
        abnormal: result.stats.abnormalObjectCount,
        missing: result.stats.missingSites,
      }));
    check('empty highlight restores the default palette',
      result.stats.palette.left === '#6ee7f0'
      && result.stats.palette.abnormal === '#ff6b6b'
      && result.stats.palette.selected === '#c8f04a',
      JSON.stringify(result.stats.palette));

    await evaluate(`window.__viewer.selectSite('gluteus-maximus', 'left')`);
    await settle();
    let emptyCardSheet = await readSheet();
    check('a site without an archive card hides the archive action',
      emptyCardSheet.hidden === false
      && emptyCardSheet.secondaryHidden === true
      && emptyCardSheet.secondaryDisabled === true,
      JSON.stringify({
        hidden: emptyCardSheet.hidden,
        secondaryHidden: emptyCardSheet.secondaryHidden,
        secondaryDisabled: emptyCardSheet.secondaryDisabled,
      }));
    await click('#sheet-close');
    await settle();

    await evaluate(`window.__viewer.setHighlight({
      palette: {
        left: '#6ee7f0',
        right: '#f0a26e',
        abnormal: '#ff6b6b',
        selected: '#c8f04a'
      },
      sites: [{ siteId: 'gluteus-maximus', side: 'left' }],
      cards: [{
        siteId: 'gluteus-maximus',
        siteZh: '臀大肌',
        side: 'left',
        sideZh: '左',
        axes: [
          { axis: 'tension', label: '张力', value: '紧', measured: true, abnormal: true },
          { axis: 'symmetry', label: '对称', value: '左弱', measured: true, abnormal: true },
          { axis: 'mobility', label: '活动度', value: '正常', measured: true, abnormal: false },
          { axis: 'pain', label: '疼痛', value: null, measured: false, abnormal: false },
          { axis: 'stability', label: '稳定性', value: '正常', measured: true, abnormal: false }
        ],
        at: 1700000000000,
        resolved: false,
        worst: '臀大肌左 · 张力 紧'
      }]
    })`);
    await settle();
    result = await readStats();
    check('cards reach the viewer with the highlight',
      result.stats.cards === 1,
      String(result.stats.cards));

    const beforeSheetCamera = await readCamera();
    const beforeSheet = await readSheet();
    check('detail sheet starts closed', beforeSheet.hidden === true);

    await evaluate(`window.__viewer.selectSite('gluteus-maximus', 'left')`);
    await settle();
    result = await readStats();
    let sheet = await readSheet();
    check('selecting one side opens the sheet with the picked side',
      sheet.hidden === false && sheet.title === '臀大肌' && sheet.side === '左侧',
      `${sheet.hidden}/${sheet.title}/${sheet.side}`);
    check('sheet shows all five axes with measured/abnormal states',
      sheet.axes.length === 5
      && sheet.axes.find((axis) => axis.axis === 'pain')?.state === 'unmeasured'
      && sheet.axes.find((axis) => axis.axis === 'tension')?.state === 'abnormal'
      && sheet.axes.find((axis) => axis.axis === 'mobility')?.state === 'normal',
      JSON.stringify(sheet.axes));
    check('sheet shows the native worst sentence verbatim',
      sheet.worst === '臀大肌左 · 张力 紧',
      sheet.worst);
    check('sheet offers the isolate and archive actions',
      sheet.primary === '只看这块'
      && sheet.secondary === '在档案里看依据 ›'
      && sheet.secondaryHidden === false
      && sheet.secondaryDisabled === false,
      `${sheet.primary}/${sheet.secondary}/${sheet.secondaryHidden}/${sheet.secondaryDisabled}`);
    check('side selection tints and counts only the picked side',
      result.stats.selectedSide === 'left' && result.stats.selectedObjectCount === 1,
      `${result.stats.selectedSide}/${result.stats.selectedObjectCount}`);
    check('opening the sheet keeps camera target and distance',
      sameCamera(beforeSheetCamera, await readCamera()));
    check('opening the sheet does not resize the canvas',
      nearly(beforeSheet.canvas.width, sheet.canvas.width)
      && nearly(beforeSheet.canvas.height, sheet.canvas.height),
      `${beforeSheet.canvas.width}x${beforeSheet.canvas.height} -> ${sheet.canvas.width}x${sheet.canvas.height}`);

    await click('#sheet-close');
    await settle();
    result = await readStats();
    sheet = await readSheet();
    check('close button dismisses the sheet and clears selection',
      sheet.hidden === true && result.stats.selectedSite === null);
    check('closing with the button keeps camera target and distance',
      sameCamera(beforeSheetCamera, await readCamera()));
    check('closing the sheet does not resize the canvas',
      nearly(beforeSheet.canvas.width, sheet.canvas.width)
      && nearly(beforeSheet.canvas.height, sheet.canvas.height),
      `${beforeSheet.canvas.width}x${beforeSheet.canvas.height} -> ${sheet.canvas.width}x${sheet.canvas.height}`);

    await evaluate(`window.__viewer.selectSite('gluteus-maximus', 'left')`);
    await sleep(260);
    sheet = await readSheet();
    await drag(sheet.head.x, sheet.head.y, sheet.head.x, sheet.head.y + 110, 12);
    await settle();
    result = await readStats();
    sheet = await readSheet();
    check('dragging the sheet down past the threshold dismisses it',
      sheet.hidden === true && result.stats.selectedSite === null,
      `${sheet.hidden}/${result.stats.selectedSite}`);

    await evaluate(`window.__viewer.selectSite('gluteus-maximus', 'left')`);
    await settle();
    await evaluate(`
      window.__messages = [];
      window.nsh = { postMessage: (data) => window.__messages.push(data) };
    `);
    await click('#sheet-open');
    await settle();
    const messages = JSON.parse(await evaluate('JSON.stringify(window.__messages)'));
    const openSection = messages
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === 'anatomy3d:open-section') ?? null;
    check('archive action posts the site and side to the native host',
      openSection?.type === 'anatomy3d:open-section'
      && openSection?.siteId === 'gluteus-maximus'
      && openSection?.side === 'left',
      JSON.stringify(openSection));

    const beforeIsolateCamera = await readCamera();
    const beforeIsolateState = (await readStats()).stats;
    const beforeIsolateSheet = await readSheet();
    check('isolation button starts as show-only',
      beforeIsolateSheet.primary === '只看这块'
      && beforeIsolateSheet.primaryPressed === 'false',
      `${beforeIsolateSheet.primary}/${beforeIsolateSheet.primaryPressed}`);

    await click('#sheet-isolate');
    await settle();
    result = await readStats();
    ui = await readUi();
    sheet = await readSheet();
    check('sheet isolate button shows the whole site, both sides',
      result.stats.visibleInstances === 2
      && result.stats.visibleInstances === result.stats.selectedSiteInstanceCount,
      `${result.stats.visibleInstances} visible / ${result.stats.selectedSiteInstanceCount} site instances`);
    check('isolate button flips to show-all with aria-pressed',
      sheet.primary === '显示全部'
      && sheet.primaryPressed === 'true'
      && result.stats.isolate === true,
      `${sheet.primary}/${sheet.primaryPressed}/${result.stats.isolate}`);
    await sleep(400);
    const synced = JSON.parse(await evaluate('JSON.stringify(window.__messages)'))
      .map((raw) => JSON.parse(raw))
      .filter((message) => message.type === 'anatomy3d:state')
      .pop();
    check('state sync posts the latest camera and selection to the native host',
      synced?.state?.selectedSite === 'gluteus-maximus'
      && synced?.state?.isolate === true,
      JSON.stringify(synced?.state ?? null));
    check('isolate explicitly reframes',
      !sameCameraSnapshot(beforeIsolateCamera, await readCamera()));
    check('isolation disables the layer control',
      ui.preset.disabled === 'true'
      && ui.preset.hidden
      && ui.preset.items.every((item) => item.disabled === 'true'),
      `${ui.preset.disabled}/${ui.preset.hidden}/${ui.preset.items.map((item) => item.disabled).join(',')}`);
    check('disabled layer control has visible feedback',
      Number(ui.preset.opacity) < 1
      && ui.preset.items.every((item) => Number(item.opacity) < 1),
      `${ui.preset.opacity}/${ui.preset.items.map((item) => item.opacity).join(',')}`);

    const presetAttempt = await evaluate(`window.__viewer.setPreset('bone')`);
    result = await readStats();
    check('isolation rejects layer changes',
      presetAttempt === false && result.stats.preset === beforeIsolateState.preset,
      `${presetAttempt}/${result.stats.preset}`);

    const beforeIsolatedView = await readCamera();
    await evaluate(`window.__viewer.setView('back')`);
    await settle();
    result = await readStats();
    ui = await readUi();
    check('changing view while isolated keeps target and distance',
      sameCamera(beforeIsolatedView, await readCamera()));
    check('changing view while isolated still reorients',
      result.stats.view === 'back'
      && ui.views.find((view) => view.id === 'back')?.pressed === 'true',
      result.stats.view);

    await click('#sheet-isolate');
    await settle();
    result = await readStats();
    ui = await readUi();
    sheet = await readSheet();
    check('show-all restores the pre-isolation camera snapshot',
      sameCameraSnapshot(beforeIsolateCamera, await readCamera()));
    check('show-all restores layer, selection, side, and view',
      result.stats.preset === beforeIsolateState.preset
      && result.stats.selectedSite === 'gluteus-maximus'
      && result.stats.selectedSide === 'left'
      && result.stats.view === beforeIsolateState.view,
      JSON.stringify({
        preset: result.stats.preset,
        site: result.stats.selectedSite,
        side: result.stats.selectedSide,
        view: result.stats.view,
      }));
    check('show-all keeps the sheet open and flips the button back',
      sheet.hidden === false
      && sheet.primary === '只看这块'
      && sheet.primaryPressed === 'false'
      && result.stats.isolate === false,
      `${sheet.hidden}/${sheet.primary}/${sheet.primaryPressed}/${result.stats.isolate}`);
    check('layer control is available after leaving isolation',
      ui.preset.disabled === 'false'
      && ui.preset.items.every((item) => item.disabled === 'false')
      && Number(ui.preset.opacity) >= 0.99,
      `${ui.preset.disabled}/${ui.preset.opacity}`);

    await pressAt(8, 120);
    await settle();
    result = await readStats();
    sheet = await readSheet();
    check('tapping blank canvas dismisses the sheet and clears selection',
      sheet.hidden === true && result.stats.selectedSite === null,
      `${sheet.hidden}/${result.stats.selectedSite}`);

    await evaluate(`
      window.__viewer.setPreset('all');
      window.__viewer.setView('front');
    `);
    await settle();
    const beforeDeep = await readCamera();
    await evaluate(`window.__viewer.selectSite('multifidus', 'left')`);
    await settle();
    result = await readStats();
    ui = await readUi();
    sheet = await readSheet();
    check('selecting a deep site switches the layer to deep without reframing',
      result.stats.preset === 'deep' && ui.preset.label === '深层',
      `${result.stats.preset}/${ui.preset.label}`);
    check('deep selection still keeps camera target and distance',
      sameCamera(beforeDeep, await readCamera()));
    check('deep sheet reports the picked side',
      sheet.hidden === false && sheet.side === '左侧',
      `${sheet.hidden}/${sheet.side}`);

    await evaluate(`window.__viewer.selectSite('multifidus')`);
    await settle();
    sheet = await readSheet();
    check('a programmatic whole-site selection labels both sides', sheet.side === '双侧',
      sheet.side);
    await evaluate(`
      window.__viewer.selectSite(null);
      window.__viewer.setHighlight({ sites: [], cards: [] });
    `);
    await settle();
    await evaluate(`window.__viewer.selectSite('gluteus-maximus', 'left')`);
    await settle();
    sheet = await readSheet();
    check('an empty archive still opens a sheet that says there is no judgement',
      sheet.hidden === false && sheet.worst === '这个部位还没有判定',
      `${sheet.hidden}/${sheet.worst}`);
    await evaluate(`window.__viewer.selectSite(null)`);
    await settle();
    const missingSelect = await evaluate(`window.__viewer.selectSite('missing-in-model')`);
    await settle();
    result = await readStats();
    sheet = await readSheet();
    check('a missing mesh site has no selectable instance or isolate action',
      missingSelect === false
      && result.stats.selectedSite === null
      && sheet.hidden === true,
      `${missingSelect}/${result.stats.selectedSite}/${sheet.hidden}`);
    await evaluate(`
      window.__viewer.setPreset('all');
    `);
    await settle();

    await checkViewport(390, 844);
    await checkViewport(430, 932);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(280);

    await evaluate(`window.__viewer.setView('front')`);
    await sleep(350);
    const beforeRotate = await readCamera();
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 600,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(280);
    await drag(40, 420, 560, 420);
    await sleep(1800);
    result = await readStats();
    ui = await readUi();
    check('free rotation highlights nearest view',
      result.stats.view === 'back',
      result.stats.view);
    check('rotation updates the visible view button',
      ui.views.find((view) => view.id === 'back')?.pressed === 'true'
      && ui.views.filter((view) => view.pressed === 'true').length === 1,
      ui.views.map((view) => `${view.id}:${view.pressed}`).join(' '));
    check('rotation keeps camera target and distance',
      sameCamera(beforeRotate, await readCamera()));
    check('first interaction dismisses the hint',
      ui.hint.dismissed && !ui.hint.visible
      && await evaluate(`localStorage.getItem('lianlian.anatomy3d.hintSeen')`) === '1');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(280);

    await click('#preset-trigger');
    await settle();
    ui = await readUi();
    check('layer menu opens with four options',
      ui.preset.expanded === 'true' && !ui.preset.hidden && ui.preset.items.length === 4,
      `${ui.preset.expanded}/${ui.preset.items.length}`);
    check('layer menu marks the current option',
      ui.preset.items.find((item) => item.id === 'all')?.checked === 'true',
      ui.preset.items.map((item) => `${item.id}:${item.checked}`).join(' '));
    check('layer menu options are 44px tall',
      ui.preset.items.every((item) => item.height >= 44),
      ui.preset.items.map((item) => Math.round(item.height)).join(','));

    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await settle();
    ui = await readUi();
    check('Escape closes the layer menu',
      ui.preset.expanded === 'false' && ui.preset.hidden
      && await evaluate(`document.activeElement?.id`) === 'preset-trigger');

    await click('#preset-trigger');
    await settle();
    await pressAt(10, 220);
    await settle();
    ui = await readUi();
    check('outside press closes the layer menu',
      ui.preset.expanded === 'false' && ui.preset.hidden);

    await click('#preset-trigger');
    await settle();
    await click('[data-preset="deep"]');
    await settle();
    result = await readStats();
    ui = await readUi();
    check('layer option applies deep preset',
      result.stats.preset === 'deep' && ui.preset.label === '深层'
      && ui.preset.expanded === 'false' && ui.preset.hidden,
      `${result.stats.preset}/${ui.preset.label}`);
    await click('#preset-trigger');
    await settle();
    ui = await readUi();
    check('deep option holds selected state',
      ui.preset.items.find((item) => item.id === 'deep')?.checked === 'true');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await settle();

    await evaluate(`window.__viewer.setPreset('deep')`);
    await settle();
    result = await readStats();
    check('deep preset uses <= 5 draw calls', result.stats.drawCalls <= 5,
      String(result.stats.drawCalls));
    check('deep preset fades shallow layer', result.stats.visibleInstances < 311,
      `${result.stats.visibleInstances} visible`);

    await evaluate(`
      window.__viewer.setIsolate(false);
      window.__viewer.selectSite(null);
      window.__viewer.setPreset('deep');
      window.__viewer.setView('front');
    `);
    await sleep(350);
    const beforeSelect = await readCamera();
    await evaluate(`window.__viewer.selectSite('transversus-abdominis')`);
    await settle();
    result = await readStats();
    check('TVA selected', result.stats.selectedSite === 'transversus-abdominis');
    check('TVA has both sides', result.stats.selectedObjectCount === 2);
    check('highlight color', result.stats.highlightColor === '#c8f04a');
    check('selecting does not change the view', result.stats.view === 'front');
    check('selecting keeps camera target and distance',
      sameCamera(beforeSelect, await readCamera()));

    await evaluate(`window.__viewer.selectSite('multifidus')`);
    await settle();
    result = await readStats();
    check('multifidus selected', result.stats.selectedSite === 'multifidus');
    check('multifidus 6 objects', result.stats.selectedObjectCount === 6);

    const beforeIsolate = await readCamera();
    const beforeMultifidusState = (await readStats()).stats;
    await evaluate(`window.__viewer.setIsolate(true)`);
    await settle();
    result = await readStats();
    check('isolate shows all multifidus objects', result.stats.visibleInstances === 6,
      `${result.stats.visibleInstances} visible`);
    check('isolate uses <= 5 draw calls', result.stats.drawCalls <= 5,
      String(result.stats.drawCalls));
    check('isolate explicitly reframes',
      !sameCamera(beforeIsolate, await readCamera()));

    await evaluate(`window.__viewer.setIsolate(false)`);
    await settle();
    result = await readStats();
    const restoredIsolateCamera = await readCamera();
    check('leaving isolate restores camera',
      sameCameraSnapshot(beforeIsolate, restoredIsolateCamera),
      JSON.stringify({ before: beforeIsolate, after: restoredIsolateCamera }));
    check('leaving isolate restores selection and layer',
      result.stats.selectedSite === 'multifidus'
      && result.stats.selectedSide === null
      && result.stats.preset === beforeMultifidusState.preset);

    await evaluate(`window.__viewer.selectSite('multifidus')`);
    await settle();
    const beforeCloseIsolate = await readCamera();
    await evaluate(`window.__viewer.setIsolate(true)`);
    await settle();
    await click('#sheet-close');
    await settle();
    result = await readStats();
    sheet = await readSheet();
    check('closing the sheet while isolated exits isolation',
      result.stats.isolate === false
      && result.stats.selectedSite === null
      && sheet.hidden === true,
      `${result.stats.isolate}/${result.stats.selectedSite}/${sheet.hidden}`);
    check('closing the sheet while isolated restores the pre-isolation camera',
      sameCameraSnapshot(beforeCloseIsolate, await readCamera()),
      JSON.stringify({ before: beforeCloseIsolate, after: await readCamera() }));
    check('closing the sheet while isolated restores the saved layer',
      result.stats.preset === beforeMultifidusState.preset
      && result.stats.visibleInstances > 6,
      `${result.stats.preset}/${result.stats.visibleInstances}`);

    const boneSelect = await evaluate(`window.__viewer.selectSite('lumbar-vertebrae')`);
    await settle();
    result = await readStats();
    sheet = await readSheet();
    check('bones can be selected and offer isolation',
      boneSelect === true
      && sheet.hidden === false
      && sheet.primary === '只看这块'
      && sheet.primaryDisabled === false,
      `${boneSelect}/${sheet.hidden}/${sheet.primary}/${sheet.primaryDisabled}`);
    const beforeBoneIsolate = await readCamera();
    await click('#sheet-isolate');
    await settle();
    result = await readStats();
    check('bones isolate their own meshes',
      result.stats.isolate === true
      && result.stats.visibleInstances === result.stats.selectedSiteInstanceCount
      && result.stats.visibleInstances > 0,
      `${result.stats.isolate}/${result.stats.visibleInstances}/${result.stats.selectedSiteInstanceCount}`);
    await click('#sheet-isolate');
    await settle();
    result = await readStats();
    check('leaving bone isolation restores the camera and selection',
      result.stats.isolate === false
      && result.stats.selectedSite === 'lumbar-vertebrae'
      && sameCameraSnapshot(beforeBoneIsolate, await readCamera()));

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

    await evaluate(`window.__viewer.setHighlight({
      sites: [{ siteId: 'multifidus', side: null }]
    })`);
    await settle();
    await evaluate(`window.__viewer.setTier('raw')`, true);
    check('raw tier reload', await waitReady());
    await sleep(300);
    result = await readStats();
    check('raw tier triangles', result.stats.triangles === 1525071,
      String(result.stats.triangles));
    check('raw tier draw calls <= 5', result.stats.drawCalls <= 5,
      String(result.stats.drawCalls));
    check('highlight survives a tier reload',
      result.stats.highlightSites.length === 1
      && result.stats.abnormalObjectCount === 6,
      `${result.stats.highlightSites.length}/${result.stats.abnormalObjectCount}`);

    await evaluate(`window.__viewer.setTier('cap3000')`, true);
    check('cap3000 tier reload', await waitReady());
    await sleep(300);
    result = await readStats();
    check('cap3000 triangles after switch', result.stats.triangles === 743912,
      String(result.stats.triangles));
    check('highlight survives the second tier reload',
      result.stats.highlightSites.length === 1
      && result.stats.abnormalObjectCount === 6,
      `${result.stats.highlightSites.length}/${result.stats.abnormalObjectCount}`);
    await evaluate(`window.__viewer.setHighlight({ sites: [] })`);
    await settle();

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

    await evaluate(`window.__viewer.setSpin(false)`);
    await sleep(250);
    result = await readStats();
    check('spin disabled', result.stats.spin === false);

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
    ui = await readUi();
    check('view stops spin', result.stats.spin === false);
    check('view resets spin yaw', Math.abs(result.stats.spinYaw) < 1e-6,
      String(result.stats.spinYaw));
    check('back view remains active', result.stats.view === 'back'
      && ui.views.find((view) => view.id === 'back')?.pressed === 'true');
    const backShot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    await writeFile('/tmp/anatomy-3d-back-after-spin.png',
      Buffer.from(backShot.result.data, 'base64'));

    await cdp.send('Page.navigate', {
      url: `${BASE_URL}?tier=cap3000&view=back&preset=deep&site=multifidus&isolate=1&ui=0&spin=1&autoTier=0`,
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
    check('URL isolate state matches the visible instances',
      result.stats.isolate === true
      && result.stats.visibleInstances === result.stats.selectedSiteInstanceCount,
      `${result.stats.isolate}/${result.stats.visibleInstances}/${result.stats.selectedSiteInstanceCount}`);
    check('URL isolate draw calls <= 5', result.stats.drawCalls <= 5,
      String(result.stats.drawCalls));
    ui = await readUi();
    check('URL isolation updates the sheet isolate button',
      ui.isolate.text === '显示全部' && ui.isolate.pressed === 'true',
      `${ui.isolate.text}/${ui.isolate.pressed}`);

    const isolatedDistance = result.stats.cameraDistance;
    await evaluate(`window.__viewer.setIsolate(false)`);
    await sleep(300);
    result = await readStats();
    check('URL isolate exit frames the body when no snapshot exists',
      result.stats.isolate === false
      && result.stats.cameraDistance > isolatedDistance * 1.5,
      `${result.stats.cameraDistance}/${isolatedDistance}`);

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    await writeFile(SCREENSHOT, Buffer.from(shot.result.data, 'base64'));

    await evaluate('window.__viewer.reset()', true);
    await sleep(350);
    result = await readStats();
    ui = await readUi();
    check('reset keeps the active tier', result.stats.tier === 'cap3000',
      result.stats.tier);
    check('reset clears selection', result.stats.selectedSite === null);
    check('reset shows all instances', result.stats.visibleInstances === 311,
      `${result.stats.visibleInstances} visible`);
    check('reset returns to front/all',
      result.stats.view === 'front' && result.stats.preset === 'all');
    check('reset clears isolation state and resets the button',
      result.stats.isolate === false
      && ui.isolate.text === '只看这块'
      && ui.isolate.pressed === 'false',
      `${result.stats.isolate}/${ui.isolate.text}/${ui.isolate.pressed}`);
    check('reset updates view and layer controls',
      ui.views.find((view) => view.id === 'front')?.pressed === 'true'
      && ui.preset.label === '全身'
      && ui.preset.items.find((item) => item.id === 'all')?.checked === 'true');

    await cdp.send('Page.navigate', { url: `${BASE_URL}?view=front&autoTier=0` });
    await sleep(400);
    check('hint reload ready', await waitReady());
    await sleep(350);
    ui = await readUi();
    check('hint does not return after first interaction',
      ui.hint.dismissed && !ui.hint.visible
      && await evaluate(`localStorage.getItem('lianlian.anatomy3d.hintSeen')`) === '1');

    const productShot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    await writeFile(PRODUCT_SCREENSHOT, Buffer.from(productShot.result.data, 'base64'));

    const attentionPayload = {
      palette: {
        left: '#6ee7f0',
        right: '#f0a26e',
        abnormal: '#ff0000',
        selected: '#c8f04a',
      },
      sites: [
        { siteId: 'gluteus-maximus', side: 'left' },
        { siteId: 'multifidus', side: 'left' },
        { siteId: 'missing-in-model', side: 'right' },
      ],
      cards: [
        {
          siteId: 'gluteus-maximus',
          siteZh: '臀大肌',
          side: 'left',
          sideZh: '左',
          groupId: 'gluteal-group',
          groupZh: '臀肌群',
          axes: [],
          at: 1,
          resolved: false,
          worst: '臀大肌左 · 张力 紧',
        },
        {
          siteId: 'multifidus',
          siteZh: '多裂肌',
          side: 'left',
          sideZh: '左',
          groupId: 'spinal-deep',
          groupZh: '脊柱深层',
          axes: [],
          at: 2,
          resolved: false,
          worst: '多裂肌左 · 张力 紧',
        },
        {
          siteId: 'missing-in-model',
          siteZh: '腰方肌',
          side: 'right',
          sideZh: '右',
          groupId: 'spinal-deep',
          groupZh: '脊柱深层',
          axes: [],
          at: 3,
          resolved: false,
          worst: '腰方肌右 · 张力 紧',
        },
      ],
    };
    await evaluate(`window.__viewer.setHighlight(${JSON.stringify(attentionPayload)})`);
    await settle();
    let attention = await readAttention();
    check('attention pill shows the row count including missing meshes',
      attention.triggerHidden === false
      && attention.triggerText === '需注意 3 处 ›'
      && attention.expanded === 'false'
      && attention.controls === 'attention-sheet',
      `${attention.triggerHidden}/${attention.triggerText}/${attention.expanded}/${attention.controls}`);
    check('attention list starts closed',
      attention.hidden === true && attention.open === false);

    const beforeAttentionCamera = await readCamera();
    const beforeAttentionCanvas = attention.canvas;
    await click('#attention-trigger');
    await settle();
    attention = await readAttention();
    check('attention list opens with title, legend, groups and three rows',
      attention.hidden === false
      && attention.open === true
      && attention.expanded === 'true'
      && attention.title === '需要注意 · 3 处'
      && attention.legend === '红＝需要注意 · 青/橙＝左/右'
      && attention.groups.join(',') === '臀肌群,脊柱深层'
      && attention.rows.length === 3,
      JSON.stringify({
        hidden: attention.hidden,
        title: attention.title,
        legend: attention.legend,
        groups: attention.groups,
        rows: attention.rows.length,
      }));
    check('attention rows carry site, side and worst text',
      attention.rows[0].text.includes('臀大肌')
      && attention.rows[0].text.includes('左')
      && attention.rows[0].text.includes('张力 紧')
      && attention.rows[1].text.includes('多裂肌')
      && attention.rows[1].text.includes('多裂肌左 · 张力 紧'),
      attention.rows.map((row) => row.text).join(' | '));
    check('the missing-mesh row is marked instead of hidden',
      attention.missing === 1
      && attention.rows.find((row) => row.site === 'missing-in-model')?.missing === true
      && attention.rows.find((row) => row.site === 'missing-in-model')
        ?.text.includes('模型里暂缺'),
      `${attention.missing}/${JSON.stringify(attention.rows)}`);
    let afterAttentionCamera = await readCamera();
    attention = await readAttention();
    check('opening the attention list changes neither camera nor canvas',
      sameCameraSnapshot(beforeAttentionCamera, afterAttentionCamera)
      && attention.canvas.width === beforeAttentionCanvas.width
      && attention.canvas.height === beforeAttentionCanvas.height,
      JSON.stringify({ before: beforeAttentionCamera, after: afterAttentionCamera }));

    await click('#attention-close');
    await settle();
    attention = await readAttention();
    afterAttentionCamera = await readCamera();
    check('closing the attention list changes neither camera nor canvas',
      attention.hidden === true
      && attention.open === false
      && attention.expanded === 'false'
      && sameCameraSnapshot(beforeAttentionCamera, afterAttentionCamera)
      && attention.canvas.width === beforeAttentionCanvas.width
      && attention.canvas.height === beforeAttentionCanvas.height,
      JSON.stringify({ camera: afterAttentionCamera, canvas: attention.canvas }));

    await click('#attention-trigger');
    await settle();
    await click('.attention-row[data-site-id="multifidus"]');
    await settle();
    sheet = await readSheet();
    result = await readStats();
    attention = await readAttention();
    afterAttentionCamera = await readCamera();
    check('clicking a row closes the list, opens the card and switches to deep',
      attention.hidden === true
      && sheet.hidden === false
      && sheet.title === '多裂肌'
      && sheet.side === '左侧'
      && result.stats.selectedSite === 'multifidus'
      && result.stats.selectedSide === 'left'
      && result.stats.preset === 'deep',
      JSON.stringify({
        listHidden: attention.hidden,
        sheet: sheet.hidden,
        title: sheet.title,
        side: sheet.side,
        site: result.stats.selectedSite,
        preset: result.stats.preset,
      }));
    check('selecting an attention row still does not reframe',
      sameCameraSnapshot(beforeAttentionCamera, afterAttentionCamera));

    await click('#sheet-close');
    await settle();
    await click('#attention-trigger');
    await settle();
    await click('.attention-row[data-site-id="missing-in-model"]');
    await settle();
    sheet = await readSheet();
    result = await readStats();
    attention = await readAttention();
    check('clicking a missing-mesh row opens a card that explains the missing model',
      sheet.hidden === false
      && sheet.title === '腰方肌'
      && sheet.side === '右'
      && sheet.worst === '腰方肌右 · 张力 紧'
      && sheet.primary === '模型里暂缺'
      && sheet.primaryDisabled === true
      && result.stats.selectedSite === 'missing-in-model',
      JSON.stringify({
        title: sheet.title,
        side: sheet.side,
        worst: sheet.worst,
        primary: sheet.primary,
        disabled: sheet.primaryDisabled,
      }));
    check('the missing-mesh card has no isolate action and says why',
      sheet.primaryLabel === '模型里暂缺，无法只看这块'
      && sheet.primaryTitle === '模型里暂缺，无法只看这块'
      && sheet.primaryPressed === 'false',
      `${sheet.primaryLabel}/${sheet.primaryTitle}/${sheet.primaryPressed}`);
    check('a missing-mesh row is no dead selection',
      attention.hidden === true && result.stats.selectedObjectCount === 0);

    await click('#sheet-close');
    await settle();
    await evaluate(`window.__viewer.setHighlight({ sites: [], cards: [] })`);
    await settle();
    attention = await readAttention();
    check('an empty attention set hides the pill and the list',
      attention.triggerHidden === true
      && attention.hidden === true,
      `${attention.triggerHidden}/${attention.hidden}`);

    const anteriorAttentionPayload = {
      palette: attentionPayload.palette,
      sites: [
        { siteId: 'rectus-femoris', side: 'left' },
        { siteId: 'pectoralis-major', side: 'left' },
      ],
      cards: [],
    };

    await cdp.send('Page.navigate', {
      url: `${BASE_URL}?focus=attention&autoTier=0`,
    });
    await sleep(400);
    check('attention focus URL ready', await waitReady());
    await sleep(350);
    result = await readStats();
    const attentionInitialCamera = await readCamera();
    check('attention focus starts from the default whole-body framing',
      result.stats.view === 'front',
      `${result.stats.view}/${result.stats.cameraDistance}`);
    await evaluate(`window.__viewer.setHighlight(${JSON.stringify(attentionPayload)})`);
    await settle();
    result = await readStats();
    attention = await readAttention();
    check('focus=attention opens the list once after the first highlight',
      attention.hidden === false
      && attention.open === true
      && attention.expanded === 'true'
      && attention.rows.length === 3,
      JSON.stringify({
        hidden: attention.hidden,
        expanded: attention.expanded,
        rows: attention.rows.length,
      }));
    check('dorsal-majority attention turns the initial view to the back',
      result.stats.view === 'back',
      result.stats.view);
    check('attention reorient keeps the whole-body distance and target',
      sameCamera(attentionInitialCamera, await readCamera()),
      JSON.stringify({ before: attentionInitialCamera, after: await readCamera() }));
    await pressAt(8, 120);
    await settle();
    attention = await readAttention();
    check('tapping blank canvas closes the attention list',
      attention.hidden === true && attention.expanded === 'false');

    await cdp.send('Page.navigate', {
      url: `${BASE_URL}?focus=attention&autoTier=0`,
    });
    await sleep(400);
    check('anterior focus URL ready', await waitReady());
    await evaluate(`window.__viewer.setHighlight(${JSON.stringify(anteriorAttentionPayload)})`);
    await settle();
    result = await readStats();
    check('anterior-majority attention stays on the front view',
      result.stats.view === 'front',
      result.stats.view);

    await cdp.send('Page.navigate', {
      url: `${BASE_URL}?focus=attention&autoTier=0`,
    });
    await sleep(400);
    check('user-rotation focus URL ready', await waitReady());
    await sleep(350);
    await drag(100, 420, 300, 420);
    await sleep(1800);
    result = await readStats();
    const rotatedView = result.stats.view;
    check('user drag rotates away from the back view',
      rotatedView !== 'back',
      rotatedView);
    await evaluate(`window.__viewer.setHighlight(${JSON.stringify(attentionPayload)})`);
    await settle();
    result = await readStats();
    check('attention never overrides a camera the user already moved',
      result.stats.view === rotatedView,
      `${rotatedView} -> ${result.stats.view}`);

    // Deterministic tier ladder. The real sampler is off; testTierFps feeds an
    // average through the same pure decision and switch path.
    await cdp.send('Page.navigate', {
      url: `${BASE_URL}?view=back&autoTier=0&tierTest=1`,
    });
    await sleep(400);
    check('tier-test URL ready', await waitReady());
    await sleep(350);
    result = await readStats();
    check('tier-test starts at the visual tier',
      result.stats.tier === 'raw' && result.stats.triangles === 1525071,
      `${result.stats.tier}/${result.stats.triangles}`);

    await evaluate(`
      window.__tierMessages = [];
      window.nsh = { postMessage: (data) => window.__tierMessages.push(data) };
      window.__viewer.setPreset('deep');
      window.__viewer.selectSite('multifidus', 'left');
      window.__viewer.setIsolate(true);
    `);
    await settle();
    const beforeFirstDowngrade = await readStats();
    const beforeFirstDowngradeCamera = await readCamera();
    const framesBeforeDowngrade = beforeFirstDowngrade.stats.frameCommands;
    check('tier-test state is prepared',
      beforeFirstDowngrade.stats.view === 'back'
      && beforeFirstDowngrade.stats.preset === 'deep'
      && beforeFirstDowngrade.stats.selectedSite === 'multifidus'
      && beforeFirstDowngrade.stats.selectedSide === 'left'
      && beforeFirstDowngrade.stats.isolate === true,
      JSON.stringify({
        view: beforeFirstDowngrade.stats.view,
        preset: beforeFirstDowngrade.stats.preset,
        site: beforeFirstDowngrade.stats.selectedSite,
        side: beforeFirstDowngrade.stats.selectedSide,
        isolate: beforeFirstDowngrade.stats.isolate,
      }));
    let notice = await readTierNotice();
    check('tier notice is hidden before the first downgrade',
      notice.hidden && !notice.visible && notice.count === 0,
      JSON.stringify(notice));

    let tierResult = await evaluate('window.__viewer.testTierFps(23)', true);
    await settle();
    result = await readStats();
    check('23 fps downgrades raw to cap3000',
      tierResult?.decision === 'cap3000'
      && result.stats.tier === 'cap3000'
      && result.stats.triangles === 743912,
      `${JSON.stringify(tierResult)}/${result.stats.tier}/${result.stats.triangles}`);
    check('raw to cap3000 preserves camera, selection, layer, view and isolation',
      sameCameraSnapshot(beforeFirstDowngradeCamera, await readCamera())
      && result.stats.view === 'back'
      && result.stats.preset === 'deep'
      && result.stats.selectedSite === 'multifidus'
      && result.stats.selectedSide === 'left'
      && result.stats.isolate === true
      && result.stats.frameCommands === framesBeforeDowngrade,
      JSON.stringify({
        camera: await readCamera(),
        view: result.stats.view,
        preset: result.stats.preset,
        site: result.stats.selectedSite,
        side: result.stats.selectedSide,
        isolate: result.stats.isolate,
        frames: `${framesBeforeDowngrade} -> ${result.stats.frameCommands}`,
      }));
    notice = await readTierNotice();
    check('the first downgrade shows the quiet notice once',
      !notice.hidden && notice.visible
      && notice.text === '已切到流畅档'
      && notice.count === 1,
      JSON.stringify(notice));
    await sleep(3400);
    notice = await readTierNotice();
    check('the quiet notice fades after about three seconds',
      notice.hidden && !notice.visible && notice.count === 1,
      JSON.stringify(notice));

    const beforeSecondDowngradeCamera = await readCamera();
    const framesBeforeSecondDowngrade = (await readStats()).stats.frameCommands;
    tierResult = await evaluate('window.__viewer.testTierFps(19)', true);
    await settle();
    result = await readStats();
    check('19 fps downgrades cap3000 to cap2000',
      tierResult?.decision === 'cap2000'
      && result.stats.tier === 'cap2000'
      && result.stats.triangles === 541822,
      `${JSON.stringify(tierResult)}/${result.stats.tier}/${result.stats.triangles}`);
    check('cap3000 to cap2000 preserves camera, selection, layer, view and isolation',
      sameCameraSnapshot(beforeSecondDowngradeCamera, await readCamera())
      && result.stats.view === 'back'
      && result.stats.preset === 'deep'
      && result.stats.selectedSite === 'multifidus'
      && result.stats.selectedSide === 'left'
      && result.stats.isolate === true
      && result.stats.frameCommands === framesBeforeSecondDowngrade,
      JSON.stringify({
        camera: await readCamera(),
        view: result.stats.view,
        preset: result.stats.preset,
        site: result.stats.selectedSite,
        side: result.stats.selectedSide,
        isolate: result.stats.isolate,
        frames: `${framesBeforeSecondDowngrade} -> ${result.stats.frameCommands}`,
      }));
    notice = await readTierNotice();
    check('the tier notice never appears a second time',
      notice.count === 1 && notice.hidden && !notice.visible,
      JSON.stringify(notice));

    tierResult = await evaluate('window.__viewer.testTierFps(19)', true);
    await settle();
    result = await readStats();
    const slowMessages = JSON.parse(await evaluate('JSON.stringify(window.__tierMessages)'))
      .map((raw) => JSON.parse(raw))
      .filter((message) => message.type === 'anatomy3d:slow-device');
    check('cap2000 at 19 fps reports the slow device once',
      tierResult?.decision === 'slow'
      && result.stats.slowDevice === true
      && slowMessages.length === 1
      && result.stats.tier === 'cap2000',
      `${JSON.stringify(tierResult)}/${result.stats.slowDevice}/${slowMessages.length}/${result.stats.tier}`);

    const pickAfterSlow = await evaluate(`window.__viewer.selectSite('gluteus-maximus', 'right')`);
    await settle();
    result = await readStats();
    check('the model remains operable after the slow-device report',
      pickAfterSlow === true
      && result.stats.selectedSite === 'gluteus-maximus'
      && result.stats.selectedSide === 'right'
      && result.stats.selectedObjectCount > 0,
      `${pickAfterSlow}/${result.stats.selectedSite}/${result.stats.selectedSide}/${result.stats.selectedObjectCount}`);

    check('console clean', cdp.consoleErrors.length === 0,
      cdp.consoleErrors.join(' | ') || 'no errors');
    if (cdp.warnings.length) {
      console.log(`INFO  console warnings: ${cdp.warnings.join(' | ')}`);
    }

    console.log(`INFO  screenshot: ${SCREENSHOT}`);
    console.log(`INFO  product screenshot: ${PRODUCT_SCREENSHOT}`);
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
