#!/usr/bin/env node
/**
 * Headless Edge QA for the anatomy 3D viewer spike.
 *
 * Requirements:
 *   - Node 20+
 *   - playwright-core (or playwright) installed outside the repo, e.g.:
 *       mkdir -p /tmp/anatomy-qa-pw && cd /tmp/anatomy-qa-pw
 *       npm init -y && npm i playwright-core
 *   - Microsoft Edge installed. This script uses channel "msedge" and never
 *     downloads Chromium.
 *
 * Usage:
 *   PLAYWRIGHT_MODULE=/tmp/anatomy-qa-pw/node_modules/playwright-core/index.mjs \
 *     node scripts/anatomy-viewer/verify_viewer.mjs
 *
 * The script serves the repository with Python's http.server on 127.0.0.1,
 * opens the viewer, waits for body.dataset.viewerReady === "1", then checks
 * both GLB tiers, four camera views, three target sites, highlighting,
 * isolation, draw calls, and console/page errors.
 *
 * Expected viewer contract (variants are tolerated):
 *   window.__viewer.stats = {
 *     model: "raw" | "cap3000",
 *     drawCalls: number,
 *     selectedSite: string | { site_id },
 *     selectedObjectCount: number,
 *     highlightColor: string | number | null,
 *     visibleInstances: number,
 *     view: "front" | "back" | "left" | "right"
 *   }
 *   window.__viewer.setModel(key) / loadModel(key)
 *   window.__viewer.setView(view)
 *   window.__viewer.selectSite(siteId)
 *   window.__viewer.isolateSite(siteId) / isolate(siteId) / setIsolate(siteId, true)
 *
 * Exit codes: 0 pass, 1 assertions failed, 2 setup/Edge/Playwright failed,
 * 3 viewer missing or never became ready.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGETS = [
  { siteId: 'gluteus-maximus', zh: '臀大肌', objectCount: 2 },
  { siteId: 'transversus-abdominis', zh: '腹横肌', objectCount: 2 },
  { siteId: 'multifidus', zh: '多裂肌', objectCount: 6 },
];
const VIEWS = ['front', 'back', 'left', 'right'];
const DEFAULT_URL_PATH = '/design/prototypes/anatomy-3d/index.html';
const DEFAULT_OUT = '/tmp/anatomy-qa';
const MAX_DRAW_CALLS = 5;

function parseArgs(argv) {
  const opts = {
    root: resolve(dirname(new URL(import.meta.url).pathname), '../..'),
    urlPath: DEFAULT_URL_PATH,
    out: DEFAULT_OUT,
    timeout: 180000,
    headed: false,
    models: ['raw', 'cap3000'],
    port: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };
    if (arg === '--root') opts.root = resolve(next());
    else if (arg === '--url') opts.urlPath = next();
    else if (arg === '--out') opts.out = resolve(next());
    else if (arg === '--timeout') opts.timeout = Number(next());
    else if (arg === '--port') opts.port = Number(next());
    else if (arg === '--headed') opts.headed = true;
    else if (arg === '--models') {
      opts.models = next()
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'node scripts/anatomy-viewer/verify_viewer.mjs [options]',
          '  --root <dir>        repository root served by http.server',
          '  --url <path>        viewer path, default ' + DEFAULT_URL_PATH,
          '  --out <dir>         screenshot/report dir, default ' + DEFAULT_OUT,
          '  --timeout <ms>      ready timeout, default 180000',
          '  --port <n>          HTTP port, default ephemeral',
          '  --models raw,cap3000',
          '  --headed            run Edge with a window',
          '',
          'Set PLAYWRIGHT_MODULE to playwright-core/index.mjs if it is not',
          'resolvable from this script.',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push('playwright-core', 'playwright');
  candidates.push('/tmp/anatomy-qa-pw/node_modules/playwright-core/index.mjs');
  candidates.push('/tmp/anatomy-qa/node_modules/playwright-core/index.mjs');
  const failures = [];
  for (const candidate of candidates) {
    try {
      const specifier =
        candidate.startsWith('/') && existsSync(candidate)
          ? pathToFileURL(candidate).href
          : candidate;
      const mod = await import(specifier);
      return mod.chromium ? mod : mod.default;
    } catch (err) {
      failures.push(`${candidate}: ${err?.message || err}`);
    }
  }
  throw new Error(
    [
      'playwright-core/playwright is not resolvable.',
      'Install it outside the repo and point PLAYWRIGHT_MODULE at it:',
      '  mkdir -p /tmp/anatomy-qa-pw && cd /tmp/anatomy-qa-pw',
      '  npm init -y && npm i playwright-core',
      '  PLAYWRIGHT_MODULE=/tmp/anatomy-qa-pw/node_modules/playwright-core/index.mjs \\',
      '    node scripts/anatomy-viewer/verify_viewer.mjs',
      'Resolution attempts:',
      ...failures.map((line) => `  - ${line}`),
    ].join('\n'),
  );
}

async function freePort() {
  return await new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolvePromise(port));
    });
  });
}

async function waitForHttp(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status < 500) return;
    } catch {
      // keep polling
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`http.server on 127.0.0.1:${port} did not start`);
}

function startHttpServer(root, port) {
  const proc = spawn(
    'python3',
    ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  proc.stdout.on('data', (chunk) => {
    log += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    log += chunk.toString();
  });
  return { proc, log: () => log };
}

function normalizeModel(value) {
  if (value == null) return null;
  const text = String(
    typeof value === 'object'
      ? value.model ?? value.tier ?? value.quality ?? value.key ?? ''
      : value,
  ).toLowerCase();
  if (text.includes('cap') || text.includes('3000') || text.includes('perf')) {
    return 'cap3000';
  }
  if (text.includes('raw') || text.includes('visual') || text.includes('original')) {
    return 'raw';
  }
  return null;
}

function normalizeSite(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return value.site_id ?? value.siteId ?? value.id ?? value.key ?? null;
  }
  return null;
}

function arrayCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object' && typeof value.size === 'number') {
    return value.size;
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function stateFromPage() {
  const normalizeModelInner = (value) => {
    if (value == null) return null;
    const text = String(
      typeof value === 'object'
        ? value.model ?? value.tier ?? value.quality ?? value.key ?? ''
        : value,
    ).toLowerCase();
    if (text.includes('cap') || text.includes('3000') || text.includes('perf')) {
      return 'cap3000';
    }
    if (text.includes('raw') || text.includes('visual') || text.includes('original')) {
      return 'raw';
    }
    return null;
  };
  const normalizeSiteInner = (value) => {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      return value.site_id ?? value.siteId ?? value.id ?? value.key ?? null;
    }
    return null;
  };
  const arrayCountInner = (value) => {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object' && typeof value.size === 'number') {
      return value.size;
    }
    return null;
  };
  const firstNumberInner = (...values) => {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (
        typeof value === 'string' &&
        value.trim() !== '' &&
        Number.isFinite(Number(value))
      ) {
        return Number(value);
      }
    }
    return null;
  };
  const viewer = window.__viewer;
  const stats =
    typeof viewer?.getStats === 'function'
      ? viewer.getStats()
      : viewer?.stats ?? viewer?.state ?? null;
  const renderInfo = viewer?.renderer?.info?.render ?? null;
  const canvas = document.querySelector('#scene') ?? document.querySelector('canvas');
  let gl = null;
  let glInfo = null;
  if (canvas) {
    try {
      gl =
        canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ??
        canvas.getContext('webgl', { preserveDrawingBuffer: true }) ??
        null;
    } catch {
      gl = null;
    }
  }
  if (gl) {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    glInfo = {
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER),
      unmaskedRenderer: debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : null,
      unmaskedVendor: debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
        : null,
      multiDraw: Boolean(gl.getExtension('WEBGL_multi_draw')),
    };
  }
  const infoEl = document.querySelector('#info');
  const objectCountText = document.querySelector('#info-objects')?.textContent ?? '';
  const parsedObjectCount = Number.parseInt(objectCountText.replace(/[^0-9]/g, ''), 10);
  const get = (...keys) => {
    for (const key of keys) {
      if (stats && stats[key] !== undefined) return stats[key];
      if (viewer && viewer[key] !== undefined) return viewer[key];
    }
    return undefined;
  };
  return {
    ready: document.body?.dataset?.viewerReady ?? null,
    viewerPresent: Boolean(viewer),
    viewerKeys: viewer ? Object.keys(viewer).sort() : [],
    statsKeys: stats ? Object.keys(stats).sort() : [],
    model: normalizeModelInner(
      get('model', 'modelKey', 'currentModel', 'tier', 'quality', 'activeModel'),
    ),
    rawModel: get('model', 'modelKey', 'currentModel', 'tier', 'quality', 'activeModel'),
    view: get('view', 'currentView', 'cameraView') ?? null,
    drawCalls: firstNumberInner(
      get('drawCalls', 'draw_calls', 'drawCallCount', 'renderCalls'),
      renderInfo?.calls,
    ),
    callsFromRenderer: firstNumberInner(renderInfo?.calls),
    renderer: renderInfo
      ? {
          calls: renderInfo.calls ?? null,
          triangles: renderInfo.triangles ?? null,
          points: renderInfo.points ?? null,
          lines: renderInfo.lines ?? null,
          frame: renderInfo.frame ?? null,
        }
      : null,
    rendererInfo: viewer?.renderer
      ? {
          isWebGL2: viewer.renderer.capabilities?.isWebGL2 ?? null,
          maxTextureSize: viewer.renderer.capabilities?.maxTextureSize ?? null,
          pixelRatio: viewer.renderer.getPixelRatio?.() ?? null,
        }
      : null,
    glInfo,
    selectedSite: normalizeSiteInner(
      get(
        'selectedSite',
        'selectedSiteId',
        'activeSite',
        'selected',
        'highlightedSite',
      ),
    ),
    selectedObjectCount: firstNumberInner(
      get(
        'selectedObjectCount',
        'highlightedObjectCount',
        'selectedCount',
        'highlightedInstances',
      ),
      arrayCountInner(
        get('selectedObjects', 'highlightedObjects', 'selectedMeshObjects'),
      ),
    ),
    selectedObjects:
      get('selectedObjects', 'highlightedObjects', 'selectedMeshObjects') ?? null,
    highlightColor:
      get('highlightColor', 'selectedColor', 'activeColor', 'highlightHex') ?? null,
    highlightChanged: get('highlightChanged', 'didHighlightChange') ?? null,
    visibleInstances: firstNumberInner(
      get(
        'visibleInstances',
        'visibleInstanceCount',
        'visibleObjectCount',
        'visibleCount',
      ),
      arrayCountInner(get('visibleObjects', 'visibleInstancesList')),
    ),
    visibleSiteCount: firstNumberInner(
      get('visibleSiteCount', 'visibleSitesCount'),
    ),
    isolatedSite: normalizeSiteInner(
      get('isolatedSite', 'isolatedSiteId', 'isolationSite'),
    ),
    isolateActive: get('isolateActive', 'isIsolated', 'isolated') ?? null,
    triangles: firstNumberInner(
      get('triangles', 'triangleCount'),
      renderInfo?.triangles,
    ),
    renderedTriangles: firstNumberInner(get('renderedTriangles'), renderInfo?.triangles),
    statsReady: get('ready') ?? null,
    apiReady: viewer?.ready ?? null,
    statsTier: get('tier') ?? null,
    statsError: get('error') ?? null,
    statsInstances: firstNumberInner(get('instances')),
    statsSites: firstNumberInner(get('sites')),
    multiDraw: get('multiDraw') ?? null,
    spin: get('spin') ?? null,
    fps: firstNumberInner(get('fps')),
    fpsAvg: firstNumberInner(get('fpsAvg')),
    fpsMin: firstNumberInner(get('fpsMin')),
    rafCount:
      typeof window.__qaRafCount === 'number' ? window.__qaRafCount : null,
    infoVisible: infoEl ? !infoEl.hidden : null,
    infoEn: document.querySelector('#info-en')?.textContent ?? null,
    infoZh: document.querySelector('#info-zh')?.textContent ?? null,
    infoObjectCount: Number.isFinite(parsedObjectCount) ? parsedObjectCount : null,
    isolatePressed:
      document.querySelector('#isolate-btn')?.getAttribute('aria-pressed') ?? null,
    bodyText: (document.body?.innerText ?? '').slice(0, 300),
    title: document.title,
  };
}

class CheckFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckFailure';
  }
}

function assert(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

async function readState(page, label) {
  const state = await page.evaluate(stateFromPage);
  if (!state.viewerPresent) {
    throw new CheckFailure(
      `${label}: window.__viewer is missing. ` +
        `body.dataset.viewerReady=${JSON.stringify(state.ready)}, title=${JSON.stringify(
          state.title,
        )}.`,
    );
  }
  return state;
}

async function waitForReady(page, timeout) {
  const earlyTimeout = Math.min(10000, timeout);
  const appeared = await page
    .waitForFunction(
      () =>
        document.body?.dataset?.viewerReady === '1' ||
        Boolean(document.body?.dataset?.viewerError) ||
        Boolean(window.__viewer),
      null,
      { timeout: earlyTimeout },
    )
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    const diagnostics = await page
      .evaluate(() => ({
        title: document.title,
        ready: document.body?.dataset?.viewerReady ?? null,
        error: document.body?.dataset?.viewerError ?? null,
        viewerPresent: Boolean(window.__viewer),
        bodyText: (document.body?.innerText ?? '').slice(0, 500),
      }))
      .catch((diagErr) => ({ diagnosticError: String(diagErr) }));
    throw new CheckFailure(
      [
        `页面已加载，但 ${earlyTimeout} ms 内没有出现 window.__viewer。`,
        'viewer 未实现、脚本未执行或模块导入失败。',
        `诊断：${JSON.stringify(diagnostics)}`,
      ].join('\n'),
    );
  }
  const viewerError = await page
    .evaluate(() => document.body?.dataset?.viewerError ?? null)
    .catch(() => null);
  if (viewerError) {
    throw new CheckFailure(`viewer 报错：${viewerError}`);
  }
  try {
    await page.waitForFunction(
      () => document.body?.dataset?.viewerReady === '1',
      null,
      { timeout },
    );
  } catch (err) {
    const diagnostics = await page
      .evaluate(() => ({
        title: document.title,
        ready: document.body?.dataset?.viewerReady ?? null,
        viewerPresent: Boolean(window.__viewer),
        viewerKeys: window.__viewer ? Object.keys(window.__viewer) : [],
        bodyText: (document.body?.innerText ?? '').slice(0, 500),
      }))
      .catch((diagErr) => ({ diagnosticError: String(diagErr) }));
    throw new CheckFailure(
      [
        `viewer 未就绪：等待 body.dataset.viewerReady === "1" 超时（${timeout} ms）。`,
        '这通常表示 viewer 尚未实现、加载失败，或没有设置该标记。',
        `诊断：${JSON.stringify(diagnostics)}`,
      ].join('\n'),
    );
  }
}

async function waitForModel(page, model, timeout) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await readState(page, `waitForModel(${model})`).catch((err) => ({
      error: String(err),
    }));
    if (
      last?.model === model &&
      last?.ready === '1' &&
      last?.statsReady === true &&
      last?.drawCalls != null &&
      last?.drawCalls > 0
    ) {
      return last;
    }
    await page.waitForTimeout(200);
  }
  throw new CheckFailure(
    `无法切换到档位 ${model}。last state=${JSON.stringify(
      {
        model: last?.model,
        rawModel: last?.rawModel,
        drawCalls: last?.drawCalls,
        statsKeys: last?.statsKeys,
        viewerKeys: last?.viewerKeys,
        error: last?.error,
      },
      null,
      2,
    )}`,
  );
}

async function switchModel(page, model) {
  const current = await readState(page, `switchModel(${model})`).catch(() => null);
  if (current?.model === model && current?.ready === '1' && current?.statsReady === true) {
    return {
      method: 'already-loaded',
      state: await waitForModel(page, model, 30000),
    };
  }
  const call = await page.evaluate(async (key) => {
    const viewer = window.__viewer;
    for (const name of ['setModel', 'loadModel', 'loadTier', 'setTier', 'load']) {
      if (typeof viewer?.[name] === 'function') {
        await viewer[name](key);
        return `viewer.${name}`;
      }
    }
    const url = new URL(window.location.href);
    url.searchParams.set('model', key);
    window.location.href = url.toString();
    return 'url';
  }, model);
  if (call === 'url') {
    await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
    await waitForReady(page, 180000);
  }
  return { method: call, state: await waitForModel(page, model, 180000) };
}

async function setView(page, view) {
  const method = await page.evaluate(async (name) => {
    const viewer = window.__viewer;
    for (const key of ['setView', 'setCamera', 'view']) {
      if (typeof viewer?.[key] === 'function') {
        await viewer[key](name);
        return `viewer.${key}`;
      }
    }
    return null;
  }, view);
  assert(
    method,
    'viewer 缺少 setView(view)/setCamera(view)，无法切换 front/back/left/right。',
  );
  await page.evaluate(
    () =>
      new Promise((resolvePromise) =>
        requestAnimationFrame(() => requestAnimationFrame(resolvePromise)),
      ),
  );
  await page.waitForTimeout(100);
  return method;
}

async function selectSite(page, siteId) {
  const result = await page.evaluate(async (id) => {
    const viewer = window.__viewer;
    for (const name of ['selectSite', 'select', 'highlightSite', 'setSelectedSite']) {
      if (typeof viewer?.[name] === 'function') {
        const returned = await viewer[name](id);
        return { method: `viewer.${name}`, returned: returned ?? null };
      }
    }
    return { method: null, returned: null };
  }, siteId);
  assert(result.method, 'viewer 缺少 selectSite(siteId)，无法验证选中与高亮。');
  await page.evaluate(
    () =>
      new Promise((resolvePromise) =>
        requestAnimationFrame(() => requestAnimationFrame(resolvePromise)),
      ),
  );
  await page.waitForTimeout(150);
  return result;
}

async function isolateSite(page, siteId) {
  const result = await page.evaluate(async (id) => {
    const viewer = window.__viewer;
    if (typeof viewer?.isolateSite === 'function') {
      const returned = await viewer.isolateSite(id);
      return { method: 'viewer.isolateSite', returned: returned ?? null };
    }
    if (typeof viewer?.isolate === 'function') {
      const returned = await viewer.isolate(id);
      return { method: 'viewer.isolate', returned: returned ?? null };
    }
    if (typeof viewer?.setIsolate === 'function') {
      const returned = await viewer.setIsolate(id, true);
      return { method: 'viewer.setIsolate', returned: returned ?? null };
    }
    if (typeof viewer?.setIsolation === 'function') {
      const returned = await viewer.setIsolation(id);
      return { method: 'viewer.setIsolation', returned: returned ?? null };
    }
    return { method: null, returned: null };
  }, siteId);
  assert(result.method, 'viewer 缺少 isolateSite/isolate/setIsolate，无法验证隔离。');
  await page.evaluate(
    () =>
      new Promise((resolvePromise) =>
        requestAnimationFrame(() => requestAnimationFrame(resolvePromise)),
      ),
  );
  await page.waitForTimeout(200);
  return result;
}

async function clearSelection(page) {
  const method = await page.evaluate(async () => {
    const viewer = window.__viewer;
    if (typeof viewer?.selectSite === 'function') {
      await viewer.selectSite(null);
      return 'viewer.selectSite(null)';
    }
    for (const name of ['clearSelection', 'clearSite', 'resetSelection']) {
      if (typeof viewer?.[name] === 'function') {
        await viewer[name]();
        return `viewer.${name}`;
      }
    }
    if (typeof viewer?.setIsolate === 'function') {
      await viewer.setIsolate(null, false);
      return 'viewer.setIsolate(null,false)';
    }
    return null;
  });
  await page.waitForTimeout(100);
  return method;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function screenshot(page, path) {
  const buffer = await page.screenshot({ path, fullPage: false });
  return { path, bytes: buffer.length, sha256: sha256(buffer) };
}

async function canvasHash(page) {
  const canvas = page.locator('#scene');
  if ((await canvas.count()) === 0) return null;
  return sha256(await canvas.screenshot());
}

function resolveSelectedSite(state, manifest, target) {
  if (state.selectedSite) return { siteId: state.selectedSite, method: 'stats' };
  const byText = manifest.find(
    (site) => site.en === state.infoEn || site.zh === state.infoZh,
  );
  if (byText) return { siteId: byText.site_id, method: 'dom-info-panel' };
  return { siteId: null, method: 'unavailable' };
}

function drawCallsOf(state) {
  return firstNumber(state.drawCalls, state.callsFromRenderer);
}

async function rafWindow(page, milliseconds) {
  const start = await page.evaluate(() =>
    typeof window.__qaRafCount === 'number' ? window.__qaRafCount : null,
  );
  await page.waitForTimeout(milliseconds);
  const end = await page.evaluate(() =>
    typeof window.__qaRafCount === 'number' ? window.__qaRafCount : null,
  );
  return {
    start,
    end,
    delta: start != null && end != null ? end - start : null,
  };
}

async function testSpin(page, model, out) {
  const setSpin = (value) =>
    page.evaluate((next) => {
      if (typeof window.__viewer?.setSpin !== 'function') return false;
      return window.__viewer.setSpin(next);
    }, value);

  await setSpin(false);
  await page.waitForTimeout(600);
  const idleRaf = await rafWindow(page, 1000);
  const idleState = await readState(page, `${model}/spin/idle`);

  const spinEnabled = await setSpin(true);
  await page.waitForTimeout(2600);
  const spinningRaf = await rafWindow(page, 400);
  const spinningState = await readState(page, `${model}/spin/on`);
  const spinShot = await screenshot(page, join(out, `spin-${model}.png`));

  await setSpin(false);
  await page.waitForTimeout(700);
  const offRaf = await rafWindow(page, 1200);
  const offState = await readState(page, `${model}/spin/off`);

  return {
    setSpinAvailable: spinEnabled !== false,
    idle: {
      spin: idleState.spin,
      raf: idleRaf,
      drawCalls: drawCallsOf(idleState),
    },
    on: {
      spin: spinningState.spin,
      fps: spinningState.fps,
      fpsAvg: spinningState.fpsAvg,
      fpsMin: spinningState.fpsMin,
      drawCalls: drawCallsOf(spinningState),
      raf: spinningRaf,
      screenshot: spinShot,
    },
    off: {
      spin: offState.spin,
      fps: offState.fps,
      fpsAvg: offState.fpsAvg,
      fpsMin: offState.fpsMin,
      drawCalls: drawCallsOf(offState),
      raf: offRaf,
    },
  };
}

async function run(options) {
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    url: null,
    edge: {},
    models: {},
    selections: [],
    contractWarnings: [],
    errors: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    checks: [],
    screenshots: [],
  };
  const addCheck = (id, ok, detail) => {
    report.checks.push({ id, ok: Boolean(ok), detail });
    return Boolean(ok);
  };
  const addContractWarning = (message) => {
    report.contractWarnings.push(message);
  };

  mkdirSync(options.out, { recursive: true });
  let manifest = [];
  try {
    manifest = JSON.parse(
      readFileSync(join(options.root, 'scripts/anatomy/za-export.json'), 'utf8'),
    );
  } catch (err) {
    addContractWarning(`无法读取 za-export.json：${err?.message || err}`);
  }
  const { chromium } = await loadPlaywright();
  const port = options.port || (await freePort());
  const http = startHttpServer(options.root, port);
  await waitForHttp(port);

  let browser;
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  try {
    browser = await chromium.launch({
      channel: 'msedge',
      headless: !options.headed,
      args: ['--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    await page.addInitScript(() => {
      window.__qaRafCount = 0;
      const original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        window.__qaRafCount += 1;
        return original(callback);
      };
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const location = msg.location?.() ?? {};
      if (String(location.url ?? '').includes('favicon.ico')) return;
      if (msg.text().includes('Failed to load resource') && msg.text().includes('404')) {
        const url = String(location.url ?? '');
        if (!url || url.includes('favicon.ico')) return;
      }
      consoleErrors.push({ text: msg.text(), url: location.url ?? null });
    });
    page.on('pageerror', (err) => pageErrors.push(String(err?.stack || err)));
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (url.includes('favicon.ico')) return;
      requestFailures.push({
        url,
        error: request.failure()?.errorText ?? null,
      });
    });

    const url = new URL(options.urlPath, `http://127.0.0.1:${port}`);
    report.url = url.toString();
    const response = await page.goto(url.toString(), {
      waitUntil: 'load',
      timeout: 60000,
    });
    if (!response) {
      report.errors.push('page.goto 没有返回 HTTP 响应。');
    } else if (response.status() >= 400) {
      throw new CheckFailure(
        `viewer 未实现或路径错误：${url} 返回 HTTP ${response.status()}。` +
          ' 使用 --url 指定实际 viewer 页面。',
      );
    }
    await waitForReady(page, options.timeout);
    const initial = await readState(page, 'initial');
    const ua = await page.evaluate(() => navigator.userAgent);
    report.edge = {
      channel: 'msedge',
      headless: !options.headed,
      userAgent: ua,
      gl: initial.glInfo,
      viewerRenderer: initial.rendererInfo,
    };
    addCheck(
      'viewer_present',
      initial.viewerPresent,
      `window.__viewer keys=${initial.viewerKeys.join(',')}`,
    );
    addCheck(
      'webgl_renderer_info',
      Boolean(initial.glInfo),
      `gl=${JSON.stringify(initial.glInfo)}, viewerRenderer=${JSON.stringify(
        initial.rendererInfo,
      )}`,
    );

    for (const model of options.models) {
      const modelReport = {
        model,
        switch: null,
        initial: null,
        views: {},
        drawCallsMax: null,
        baselineCalls: null,
      };
      const switched = await switchModel(page, model);
      modelReport.switch = switched.method;
      modelReport.initial = switched.state;
      const calls = drawCallsOf(switched.state);
      modelReport.baselineCalls = calls;
      addCheck(
        `${model}_draw_calls_present`,
        calls != null,
        `stats.drawCalls=${switched.state.drawCalls}, renderer.info.render.calls=${switched.state.callsFromRenderer}, statsKeys=${switched.state.statsKeys.join(',')}`,
      );
      addCheck(
        `${model}_draw_calls_le_${MAX_DRAW_CALLS}`,
        calls != null && calls <= MAX_DRAW_CALLS,
        `draw calls=${calls}, limit=${MAX_DRAW_CALLS}`,
      );
      if (calls != null) modelReport.drawCallsMax = calls;

      for (const view of VIEWS) {
        const method = await setView(page, view);
        const state = await readState(page, `${model}/${view}`);
        const viewCalls = drawCallsOf(state);
        if (viewCalls != null && (modelReport.drawCallsMax == null || viewCalls > modelReport.drawCallsMax)) {
          modelReport.drawCallsMax = viewCalls;
        }
        addCheck(
          `${model}_${view}_draw_calls_le_${MAX_DRAW_CALLS}`,
          viewCalls != null && viewCalls <= MAX_DRAW_CALLS,
          `view=${view}, method=${method}, draw calls=${viewCalls}`,
        );
        const shot = await screenshot(
          page,
          join(options.out, `${model}-${view}.png`),
        );
        report.screenshots.push(shot);
        modelReport.views[view] = {
          method,
          reportedView: state.view,
          drawCalls: viewCalls,
          screenshot: shot,
        };
      }

      const spin = await testSpin(page, model, options.out);
      modelReport.spin = spin;
      report.screenshots.push(spin.on.screenshot);
      addCheck(
        `${model}_spin_available`,
        spin.setSpinAvailable,
        `setSpin returned ${spin.setSpinAvailable}`,
      );
      addCheck(
        `${model}_spin_enabled`,
        spin.on.spin === true,
        `stats.spin=${JSON.stringify(spin.on.spin)}`,
      );
      addCheck(
        `${model}_spin_fps_positive`,
        spin.on.fps > 0 && spin.on.fpsAvg > 0 && spin.on.fpsMin > 0,
        `fps=${spin.on.fps}, fpsAvg=${spin.on.fpsAvg}, fpsMin=${spin.on.fpsMin}`,
      );
      addCheck(
        `${model}_spin_fps_min_le_avg`,
        spin.on.fpsAvg != null &&
          spin.on.fpsMin != null &&
          spin.on.fpsMin <= spin.on.fpsAvg,
        `fpsMin=${spin.on.fpsMin}, fpsAvg=${spin.on.fpsAvg}`,
      );
      addCheck(
        `${model}_spin_draw_calls_le_${MAX_DRAW_CALLS}`,
        spin.on.drawCalls != null && spin.on.drawCalls <= MAX_DRAW_CALLS,
        `draw calls=${spin.on.drawCalls}, limit=${MAX_DRAW_CALLS}`,
      );
      addCheck(
        `${model}_spin_raf_active`,
        spin.on.raf.delta != null && spin.on.raf.delta >= 10,
        `rAF delta in 400 ms=${spin.on.raf.delta}`,
      );
      addCheck(
        `${model}_spin_idle_before`,
        spin.idle.raf.delta != null && spin.idle.raf.delta <= 1,
        `rAF delta in 1000 ms before spin=${spin.idle.raf.delta}`,
      );
      addCheck(
        `${model}_spin_off`,
        spin.off.spin === false,
        `stats.spin=${JSON.stringify(spin.off.spin)}`,
      );
      addCheck(
        `${model}_spin_off_on_demand`,
        spin.off.raf.delta != null && spin.off.raf.delta <= 1,
        `rAF delta in 1200 ms after spin off=${spin.off.raf.delta}`,
      );
      addCheck(
        `${model}_spin_off_draw_calls_le_${MAX_DRAW_CALLS}`,
        spin.off.drawCalls != null && spin.off.drawCalls <= MAX_DRAW_CALLS,
        `draw calls=${spin.off.drawCalls}, limit=${MAX_DRAW_CALLS}`,
      );
      report.models[model] = modelReport;
    }

    // Selection/highlight/isolation on the last loaded tier.
    const selectionModel = options.models[options.models.length - 1];
    for (const target of TARGETS) {
      const before = await readState(page, `${selectionModel}/select/${target.siteId}/before`);
      const beforeCanvas = await canvasHash(page);
      const result = await selectSite(page, target.siteId);
      const after = await readState(page, `${selectionModel}/select/${target.siteId}/after`);
      const afterCanvas = await canvasHash(page);
      const selectShot = await screenshot(
        page,
        join(options.out, `select-${target.siteId}.png`),
      );
      report.screenshots.push(selectShot);
      const resolvedSite = resolveSelectedSite(after, manifest, target);
      if (resolvedSite.method === 'dom-info-panel') {
        addContractWarning(
          `${target.siteId}: viewer.stats 未暴露 selectedSite，断言改用 #info-en/#info-zh 反查 site_id。`,
        );
      }
      if (after.selectedObjectCount == null && after.infoObjectCount != null) {
        addContractWarning(
          `${target.siteId}: viewer.stats 未暴露 selectedObjectCount，断言改用 #info-objects 文本。`,
        );
      }
      if (after.highlightColor == null && after.highlightChanged == null) {
        addContractWarning(
          `${target.siteId}: viewer.stats 未暴露 highlightColor/highlightChanged，高亮断言改用 canvas 截图哈希差分。`,
        );
      }
      const meta = manifest.find((site) => site.site_id === target.siteId);
      const entry = {
        model: selectionModel,
        siteId: target.siteId,
        zh: target.zh,
        expectedObjectCount: target.objectCount,
        manifestObjectCount: meta?.objects?.length ?? null,
        method: result.method,
        returned: result.returned,
        before: {
          selectedSite: before.selectedSite,
          highlightColor: before.highlightColor,
          selectedObjectCount: before.selectedObjectCount,
          canvasSha256: beforeCanvas,
        },
        after: {
          selectedSite: after.selectedSite,
          resolvedSiteId: resolvedSite.siteId,
          resolvedSiteMethod: resolvedSite.method,
          highlightColor: after.highlightColor,
          selectedObjectCount: after.selectedObjectCount,
          infoObjectCount: after.infoObjectCount,
          selectedObjects: after.selectedObjects,
          highlightChanged: after.highlightChanged,
          canvasSha256: afterCanvas,
          screenshot: selectShot,
        },
        isolate: null,
        checks: [],
      };
      const check = (id, ok, detail) => {
        entry.checks.push({ id, ok: Boolean(ok), detail });
        addCheck(`${target.siteId}_${id}`, ok, `${selectionModel}: ${detail}`);
      };
      check(
        'selected_site',
        resolvedSite.siteId === target.siteId,
        `selectedSite=${JSON.stringify(
          after.selectedSite,
        )}, resolvedSiteId=${JSON.stringify(
          resolvedSite.siteId,
        )}, method=${resolvedSite.method}`,
      );
      const selectedObjectCount =
        after.selectedObjectCount ?? after.infoObjectCount;
      check(
        'object_count',
        selectedObjectCount === target.objectCount,
        `selectedObjectCount=${JSON.stringify(
          after.selectedObjectCount,
        )}, infoObjectCount=${JSON.stringify(
          after.infoObjectCount,
        )}, expected=${target.objectCount}, statsKeys=${after.statsKeys.join(',')}`,
      );
      check(
        'manifest_object_count',
        meta == null || meta.objects?.length === target.objectCount,
        `za-export.json objects=${JSON.stringify(
          meta?.objects?.length ?? null,
        )}, expected=${target.objectCount}`,
      );
      const colorChanged =
        after.highlightChanged === true ||
        (after.highlightColor != null &&
          String(after.highlightColor) !== String(before.highlightColor)) ||
        (after.highlightColor == null &&
          beforeCanvas != null &&
          afterCanvas != null &&
          beforeCanvas !== afterCanvas);
      check(
        'highlight_changed',
        colorChanged,
        `highlightColor ${JSON.stringify(before.highlightColor)} -> ${JSON.stringify(
          after.highlightColor,
        )}, highlightChanged=${JSON.stringify(
          after.highlightChanged,
        )}, canvas ${String(beforeCanvas).slice(0, 8)} -> ${String(
          afterCanvas,
        ).slice(0, 8)}`,
      );

      const beforeIsolateTriangles = after.renderedTriangles;
      const isolation = await isolateSite(page, target.siteId);
      const isolated = await readState(
        page,
        `${selectionModel}/isolate/${target.siteId}`,
      );
      const isolateShot = await screenshot(
        page,
        join(options.out, `isolate-${target.siteId}.png`),
      );
      report.screenshots.push(isolateShot);
      const fallbackVisible =
        isolated.visibleInstances != null
          ? isolated.visibleInstances
          : isolated.isolatePressed === 'true'
            ? isolated.infoObjectCount
            : null;
      const visibleMethod =
        isolated.visibleInstances != null ? 'stats' : 'dom-object-count';
      if (isolated.visibleInstances == null) {
        addContractWarning(
          `${target.siteId}: viewer.stats 未暴露 visibleInstances，隔离断言改用 isolate 按钮状态 + #info-objects。`,
        );
      }
      entry.isolate = {
        method: isolation.method,
        visibleInstances: isolated.visibleInstances,
        resolvedVisibleInstances: fallbackVisible,
        visibleMethod,
        visibleSiteCount: isolated.visibleSiteCount,
        isolatedSite: isolated.isolatedSite,
        isolateActive: isolated.isolateActive,
        isolatePressed: isolated.isolatePressed,
        renderedTrianglesBefore: beforeIsolateTriangles,
        renderedTrianglesAfter: isolated.renderedTriangles,
        expectedTriangles: meta?.tris ?? null,
        screenshot: isolateShot,
      };
      check(
        'isolate_visible_instances',
        fallbackVisible === target.objectCount,
        `visibleInstances=${JSON.stringify(
          isolated.visibleInstances,
        )}, infoObjectCount=${JSON.stringify(
          isolated.infoObjectCount,
        )}, isolatePressed=${JSON.stringify(
          isolated.isolatePressed,
        )}, expected=${target.objectCount}, method=${visibleMethod}`,
      );
      if (isolated.renderedTriangles != null) {
        check(
          'isolate_rendered_triangles',
          isolated.renderedTriangles > 0 &&
            (meta?.tris == null || isolated.renderedTriangles <= meta.tris * 1.02),
          `renderedTriangles=${isolated.renderedTriangles}, mapping tris=${meta?.tris ?? null}`,
        );
      }
      check(
        'isolate_draw_calls_le_5',
        drawCallsOf(isolated) != null && drawCallsOf(isolated) <= MAX_DRAW_CALLS,
        `draw calls=${drawCallsOf(isolated)}`,
      );
      if (isolated.visibleSiteCount != null) {
        check(
          'isolate_visible_site_count',
          isolated.visibleSiteCount === 1,
          `visibleSiteCount=${isolated.visibleSiteCount}, expected=1`,
        );
      }
      report.selections.push(entry);
      await clearSelection(page);
    }

    // URL parameter spin=1.
    const spinUrl = new URL(options.urlPath, `http://127.0.0.1:${port}`);
    spinUrl.searchParams.set('tier', selectionModel);
    spinUrl.searchParams.set('spin', '1');
    await page.goto(spinUrl.toString(), { waitUntil: 'load', timeout: 60000 });
    await waitForReady(page, options.timeout);
    await page.waitForTimeout(2600);
    const urlSpin = await readState(page, 'url-spin=1');
    const urlSpinShot = await screenshot(page, join(options.out, 'spin-url.png'));
    report.screenshots.push(urlSpinShot);
    report.urlSpin = {
      url: spinUrl.toString(),
      spin: urlSpin.spin,
      fps: urlSpin.fps,
      fpsAvg: urlSpin.fpsAvg,
      fpsMin: urlSpin.fpsMin,
      drawCalls: drawCallsOf(urlSpin),
      screenshot: urlSpinShot,
    };
    addCheck(
      'url_spin_1_enabled',
      urlSpin.spin === true,
      `stats.spin=${JSON.stringify(urlSpin.spin)}`,
    );
    addCheck(
      'url_spin_1_fps_positive',
      urlSpin.fps > 0 && urlSpin.fpsAvg > 0 && urlSpin.fpsMin > 0,
      `fps=${urlSpin.fps}, fpsAvg=${urlSpin.fpsAvg}, fpsMin=${urlSpin.fpsMin}`,
    );
    addCheck(
      'url_spin_1_draw_calls_le_5',
      drawCallsOf(urlSpin) != null && drawCallsOf(urlSpin) <= MAX_DRAW_CALLS,
      `draw calls=${drawCallsOf(urlSpin)}`,
    );
    await page.evaluate(() => window.__viewer?.setSpin?.(false));
    await page.waitForTimeout(500);

    // Mobile viewport overflow checks.
    const viewports = [
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ];
    report.viewports = [];
    for (const viewport of viewports) {
      const label = `${viewport.width}x${viewport.height}`;
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.__viewer?.setView?.('front'));
      await page.waitForTimeout(500);
      const metrics = await page.evaluate(() => {
        const width = window.innerWidth;
        const doc = document.documentElement;
        const body = document.body;
        const canvas = document.querySelector('#scene');
        const canvasRect = canvas?.getBoundingClientRect() ?? null;
        const offenders = [];
        for (const element of document.querySelectorAll('body *')) {
          const style = getComputedStyle(element);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0
          ) {
            continue;
          }
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (rect.right > width + 1 || rect.left < -1) {
            offenders.push({
              tag: element.tagName.toLowerCase(),
              id: element.id || null,
              className:
                typeof element.className === 'string' ? element.className : null,
              left: Math.round(rect.left * 100) / 100,
              right: Math.round(rect.right * 100) / 100,
              width: Math.round(rect.width * 100) / 100,
            });
          }
        }
        return {
          innerWidth: width,
          innerHeight: window.innerHeight,
          documentScrollWidth: doc.scrollWidth,
          bodyScrollWidth: body.scrollWidth,
          scrollingElementScrollWidth: document.scrollingElement?.scrollWidth ?? null,
          canvas: canvasRect
            ? {
                left: Math.round(canvasRect.left * 100) / 100,
                right: Math.round(canvasRect.right * 100) / 100,
                width: Math.round(canvasRect.width * 100) / 100,
              }
            : null,
          offenders: offenders.slice(0, 20),
          offenderCount: offenders.length,
        };
      });
      const shot = await screenshot(
        page,
        join(options.out, `viewport-${label}.png`),
      );
      report.screenshots.push(shot);
      report.viewports.push({ ...viewport, metrics, screenshot: shot });
      addCheck(
        `viewport_${label}_no_horizontal_overflow`,
        metrics.documentScrollWidth <= metrics.innerWidth &&
          metrics.bodyScrollWidth <= metrics.innerWidth &&
          (metrics.scrollingElementScrollWidth == null ||
            metrics.scrollingElementScrollWidth <= metrics.innerWidth) &&
          (metrics.canvas == null ||
            (metrics.canvas.left >= -1 && metrics.canvas.right <= metrics.innerWidth + 1)),
        `innerWidth=${metrics.innerWidth}, document.scrollWidth=${metrics.documentScrollWidth}, ` +
          `body.scrollWidth=${metrics.bodyScrollWidth}, canvas=${JSON.stringify(
            metrics.canvas,
          )}, offenders=${metrics.offenderCount}`,
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    http.proc.kill('SIGTERM');
  }

  report.consoleErrors = consoleErrors;
  report.pageErrors = pageErrors;
  report.requestFailures = requestFailures;
  addCheck(
    'no_console_errors',
    consoleErrors.length === 0,
    `${consoleErrors.length} console error(s)`,
  );
  addCheck('no_page_errors', pageErrors.length === 0, `${pageErrors.length} page error(s)`);
  addCheck(
    'no_request_failures',
    requestFailures.length === 0,
    `${requestFailures.length} failed request(s)`,
  );
  const failed = report.checks.filter((check) => !check.ok);
  report.ok = failed.length === 0;
  report.finishedAt = new Date().toISOString();
  report.failedChecks = failed.map((check) => check.id);
  report.httpServerLog = http.log().slice(-2000);
  writeFileSync(
    join(options.out, 'viewer-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  return report;
}

function summarize(report) {
  const lines = [];
  lines.push(`viewer: ${report.url}`);
  lines.push(`ok: ${report.ok}`);
  for (const [model, data] of Object.entries(report.models)) {
    lines.push(
      `${model}: switch=${data.switch} drawCalls=${data.baselineCalls} ` +
        `maxDrawCalls=${data.drawCallsMax} views=${Object.keys(data.views).join('/')}`,
    );
    if (data.spin) {
      lines.push(
        `  spin: fps=${data.spin.on.fps} avg/min=${data.spin.on.fpsAvg}/${data.spin.on.fpsMin} ` +
          `drawCalls=${data.spin.on.drawCalls} rAF(on/off)=${data.spin.on.raf.delta}/${data.spin.off.raf.delta} ` +
          `idleBefore=${data.spin.idle.raf.delta}`,
      );
    }
  }
  if (report.urlSpin) {
    lines.push(
      `url spin=1: spin=${report.urlSpin.spin} fps=${report.urlSpin.fps} ` +
        `avg/min=${report.urlSpin.fpsAvg}/${report.urlSpin.fpsMin} ` +
        `drawCalls=${report.urlSpin.drawCalls}`,
    );
  }
  for (const item of report.viewports ?? []) {
    lines.push(
      `viewport ${item.width}x${item.height}: scrollWidth=${item.metrics.documentScrollWidth}/${item.metrics.innerWidth} ` +
        `body=${item.metrics.bodyScrollWidth} offenders=${item.metrics.offenderCount}`,
    );
  }
  for (const selection of report.selections) {
    lines.push(
      `${selection.siteId}: selectedSite=${JSON.stringify(
        selection.after.resolvedSiteId ?? selection.after.selectedSite,
      )} objects=${selection.after.selectedObjectCount ?? selection.after.infoObjectCount} ` +
        `highlight=${JSON.stringify(selection.before.highlightColor)}->` +
        `${JSON.stringify(selection.after.highlightColor)} ` +
        `isolateVisible=${selection.isolate.resolvedVisibleInstances}`,
    );
  }
  if (report.contractWarnings.length) {
    lines.push(`contractWarnings=${report.contractWarnings.length}`);
    for (const warning of report.contractWarnings) lines.push(`  - ${warning}`);
  }
  lines.push(
    `consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length} ` +
      `requestFailures=${report.requestFailures.length}`,
  );
  if (report.failedChecks.length) {
    lines.push(`failed: ${report.failedChecks.join(', ')}`);
    for (const check of report.checks.filter((item) => !item.ok)) {
      lines.push(`  - ${check.id}: ${check.detail}`);
    }
  }
  lines.push(
    `screenshots: ${report.screenshots.map((shot) => shot.path).join(' ')}`,
  );
  lines.push(`report: /tmp/anatomy-qa/viewer-report.json`);
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const report = await run(options);
    console.log(summarize(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (err) {
    if (err instanceof CheckFailure) {
      console.error(`VIEWER_QA_FAILED:\n${err.message}`);
      process.exitCode = 3;
      return;
    }
    const message = String(err?.stack || err);
    if (
      message.includes('msedge') ||
      message.includes('Executable doesn') ||
      message.includes('channel') ||
      message.includes('Microsoft Edge')
    ) {
      console.error(
        [
          'EDGE_LAUNCH_FAILED: 无法通过 Playwright channel "msedge" 启动 Microsoft Edge。',
          `原始错误：${message}`,
          '替代方案：',
          '  1. 安装/更新 Microsoft Edge，确认 /Applications/Microsoft Edge.app 存在。',
          '  2. 用 PLAYWRIGHT_MODULE 指向 playwright-core，并保持 channel="msedge"。',
          '  3. 不做 WebGL 断言时，可临时改用已安装的 Chrome：channel="chrome"（需改脚本）。',
          '  4. 本脚本不会下载 Chromium。',
        ].join('\n'),
      );
      process.exitCode = 2;
      return;
    }
    console.error(`VIEWER_QA_ERROR:\n${message}`);
    process.exitCode = 2;
  }
}

main();
