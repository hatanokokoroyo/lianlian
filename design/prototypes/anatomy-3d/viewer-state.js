/**
 * Pure viewer state reducer.
 *
 * This module owns the product decisions that used to be tangled into the
 * Three.js view code: which actions may move the camera, which only change
 * visibility, and what an isolation must restore. It deliberately has no
 * dependency on the DOM, Three.js or WebGL so Node can test it directly.
 *
 * The reducer returns the next state plus semantic commands. Camera math lives
 * in the renderer; `reorient` means "orbit the current target to this view and
 * keep the current distance", and `restoreCamera` carries an opaque snapshot
 * captured by the renderer.
 */

export const VIEW_IDS = Object.freeze(['front', 'back', 'left', 'right']);
export const PRESET_IDS = Object.freeze(['all', 'shallow', 'deep', 'bone']);
export const FRAME_COMMAND_TYPES = Object.freeze([
  'frameBody',
  'frameSite',
  'reorient',
]);

/** Frame-rate thresholds for the automatic tier ladder, in order. */
export const TIER_FPS_THRESHOLDS = Object.freeze({
  rawToCap3000: 24,
  cap3000ToCap2000: 20,
  cap2000ToSlow: 20,
});

/**
 * Decide the next automatic tier for a measured average frame rate.
 *
 * The ladder is deliberately one-way and state-specific: only the current
 * tier decides which threshold applies. `null` means the device is fast
 * enough to stay where it is. `slow` is a verdict for the caller to report,
 * not a tier to load.
 */
export function nextTierForFps(avgFps, currentTier) {
  if (!Number.isFinite(avgFps) || avgFps <= 0) return null;
  if (currentTier === 'raw') {
    return avgFps < TIER_FPS_THRESHOLDS.rawToCap3000 ? 'cap3000' : null;
  }
  if (currentTier === 'cap3000') {
    return avgFps < TIER_FPS_THRESHOLDS.cap3000ToCap2000 ? 'cap2000' : null;
  }
  if (currentTier === 'cap2000') {
    return avgFps < TIER_FPS_THRESHOLDS.cap2000ToSlow ? 'slow' : null;
  }
  return null;
}

/**
 * Fallback colors for the standalone viewer. The app passes the theme tokens in
 * through `setHighlight`; this copy only keeps the spike usable in a browser
 * without a native host. Muscles and bones are surfaces, not sides: the warmth
 * comes from the anatomy palette, and left/right live in text chips only.
 */
export const DEFAULT_PALETTE = Object.freeze({
  left: '#6ee7f0',
  right: '#f0a26e',
  mid: '#b3a798',
  muscle: '#cbbeb0',
  bone: '#b3a798',
  abnormal: '#e15e3f',
  selected: '#d8e567',
});

/**
 * Reduce a theme color to the six-digit form Three.js parses.
 *
 * App tokens are eight-digit hex (`#6ee7f0ff`); `THREE.Color` reads those as
 * white. `#rgb`, `#rrggbb` and `#rrggbbaa` (any case) come back as `#rrggbb`;
 * anything else returns `null` so callers can fall back explicitly instead of
 * rendering a silent white.
 */
export function normalizeColor(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return null;
  const hex = raw.slice(1).toLowerCase();
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex.slice(0, 6)}`;
}

function paletteColor(palette, key) {
  return normalizeColor(palette?.[key]) ?? DEFAULT_PALETTE[key];
}

const VIEWS = new Set(VIEW_IDS);
const PRESETS = new Set(PRESET_IDS);
const SIDE_IDS = new Set(['left', 'right']);
const PALETTE_KEYS = Object.freeze([
  'left',
  'right',
  'mid',
  'muscle',
  'bone',
  'abnormal',
  'selected',
]);

function normalizeSide(side) {
  return SIDE_IDS.has(side) ? side : null;
}

/**
 * Normalize a highlight request from the native page.
 *
 * A site is `{ siteId, side }`; `side: null` means both sides. Duplicate
 * requests collapse so the renderer does not do the same lookup twice.
 */
export function createHighlight(palette = {}, sites = []) {
  const colors = { ...DEFAULT_PALETTE };
  if (palette && typeof palette === 'object') {
    for (const key of PALETTE_KEYS) {
      const value = palette[key];
      if (typeof value === 'string' && value.trim()) colors[key] = value;
    }
  }

  const normalized = [];
  const seen = new Set();
  for (const raw of Array.isArray(sites) ? sites : []) {
    if (!raw || typeof raw !== 'object') continue;
    const siteId = raw.siteId ?? raw.site;
    if (typeof siteId !== 'string' || !siteId) continue;
    const side = normalizeSide(raw.side);
    const key = `${siteId}\u0000${side ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ siteId, side });
  }

  return { palette: colors, sites: normalized };
}

/**
 * Normalize the archive cards pushed with a highlight.
 *
 * Cards are native-owned data: the viewer only renders them, so anything that
 * does not match the contract is dropped instead of invented. A card side of
 * `null` means the midline / both-sides card.
 */
export function createCards(cards = []) {
  const normalized = [];
  const seen = new Set();

  for (const raw of Array.isArray(cards) ? cards : []) {
    if (!raw || typeof raw !== 'object') continue;
    const siteId = raw.siteId ?? raw.site;
    if (typeof siteId !== 'string' || !siteId) continue;
    const side = normalizeSide(raw.side);
    const key = `${siteId}\u0000${side ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      siteId,
      siteZh: typeof raw.siteZh === 'string' ? raw.siteZh : siteId,
      side,
      sideZh: typeof raw.sideZh === 'string' ? raw.sideZh : null,
      groupId: typeof raw.groupId === 'string' ? raw.groupId : '',
      groupZh: typeof raw.groupZh === 'string' ? raw.groupZh : '',
      axes: Array.isArray(raw.axes)
        ? raw.axes
          .filter((axis) => axis && typeof axis === 'object')
          .map((axis) => ({
            axis: String(axis.axis ?? ''),
            label: String(axis.label ?? ''),
            value: axis.value === null || axis.value === undefined
              ? null
              : String(axis.value),
            measured: Boolean(axis.measured),
            abnormal: Boolean(axis.abnormal),
          }))
        : [],
      at: Number.isFinite(raw.at) ? raw.at : 0,
      confidence: Number.isFinite(raw.confidence) ? raw.confidence : null,
      resolved: Boolean(raw.resolved),
      worst: typeof raw.worst === 'string' ? raw.worst : '',
    });
  }

  return normalized;
}

function sideZhOf(side) {
  if (side === 'left') return '左';
  if (side === 'right') return '右';
  return null;
}

function axisNumber(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * Severity of one archive card, on the same scale the native archive uses:
 * a pain level outranks every other abnormal axis, and any other abnormal axis
 * counts as one. Cards without an abnormal axis are 0.
 */
export function cardSeverity(card) {
  const axes = Array.isArray(card?.axes) ? card.axes : [];
  let pain = 0;
  for (const axis of axes) {
    if (axis?.axis !== 'pain' && !/疼痛/.test(axis?.label ?? '')) continue;
    const level = axisNumber(axis.value);
    if (level !== null) pain = Math.max(pain, level);
  }
  if (pain > 0) return pain;
  return axes.some((axis) => axis?.abnormal) ? 1 : 0;
}

/**
 * Build the attention list the native archive and the non-visual path share.
 *
 * Rows come from the abnormal `{ siteId, side }` set, but their labels, groups
 * and worst axis come from the archive cards. Groups are ordered by their worst
 * card, rows inside a group by the same severity; equal severities keep the
 * archive order. `index` is the 1-based position in that flattened order, so
 * the model markers and the list share one numbering. A row whose site has no
 * meshes in the loaded tier is kept with `missing: true`; it is never dropped.
 */
export function buildAttention(cards, sites, loadedSiteIds, deepSiteIds = null) {
  const cardList = Array.isArray(cards) ? cards : [];
  const cardIndex = new Map(
    cardList.map((card, index) => [card, index]),
  );
  const loadedKnown = loadedSiteIds !== null && loadedSiteIds !== undefined;
  const loaded = loadedSiteIds instanceof Set
    ? loadedSiteIds
    : new Set(loadedSiteIds ?? []);
  const deep = deepSiteIds instanceof Set
    ? deepSiteIds
    : new Set(deepSiteIds ?? []);

  const seen = new Set();
  const entries = [];
  for (const raw of Array.isArray(sites) ? sites : []) {
    if (!raw || typeof raw !== 'object') continue;
    const siteId = raw.siteId ?? raw.site;
    if (typeof siteId !== 'string' || !siteId) continue;
    const side = normalizeSide(raw.side);
    const key = `${siteId}\u0000${side ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { card } = resolveCard(cardList, siteId, side);
    entries.push({
      card,
      order: card
        ? cardIndex.get(card) ?? Number.MAX_SAFE_INTEGER
        : Number.MAX_SAFE_INTEGER,
      severity: card ? cardSeverity(card) : 0,
      row: {
        siteId,
        side,
        siteZh: card?.siteZh ?? siteId,
        sideZh: sideZhOf(side) ?? card?.sideZh ?? null,
        worst: card?.worst ?? '状态平稳',
        deep: deep.has(siteId),
        missing: loadedKnown ? !loaded.has(siteId) : false,
      },
    });
  }

  entries.sort(
    (left, right) =>
      right.severity - left.severity || left.order - right.order,
  );

  const sections = [];
  const byGroup = new Map();
  for (const { card, severity, row } of entries) {
    const groupId = card?.groupId ?? '';
    const groupKey = groupId || '\u0000';
    let section = byGroup.get(groupKey);
    if (!section) {
      section = {
        groupId,
        groupZh: card?.groupZh || '其他',
        severity: 0,
        rows: [],
      };
      byGroup.set(groupKey, section);
      sections.push(section);
    }
    section.rows.push(row);
    section.severity = Math.max(section.severity, severity);
  }

  sections.sort((left, right) => right.severity - left.severity);
  let index = 0;
  for (const section of sections) {
    for (const row of section.rows) {
      index += 1;
      row.index = index;
    }
  }

  return { sections, count: entries.length };
}

/**
 * Initial view for `focus=attention`. The viewer passes one mesh-center z per
 * abnormal site that exists in the loaded model; three.js dorsal is z < 0.
 * Only a strict dorsal majority turns to the back; ties and an empty set stay
 * front.
 */
export function attentionFocusView(centers) {
  const list = (Array.isArray(centers) ? centers : []).filter(Number.isFinite);
  const back = list.filter((z) => z < 0).length;
  return back > list.length - back ? 'back' : 'front';
}

/**
 * Resolve the card a selection should show.
 *
 * Exact `site + side` first, then the site's midline card for a one-sided
 * selection. With no side requested the sheet must never guess silently:
 * a midline card wins; a site with cards on only one side returns that card and
 * asks for confirmation; a site with both sides returns no card and lets the
 * sheet offer the two choices. `reason` only describes a real absence.
 */
export function resolveCard(cards, siteId, side = null) {
  const empty = { card: null, reason: null, availableSides: [], needsSideChoice: false };
  if (!siteId) return empty;

  const wanted = normalizeSide(side);
  const list = Array.isArray(cards) ? cards : [];
  const siteCards = list.filter((card) => card.siteId === siteId);
  if (siteCards.length === 0) return { ...empty, reason: 'site' };

  const availableSides = [...new Set(
    siteCards.map((card) => card.side).filter((value) => value !== null),
  )];
  const midline = siteCards.find((card) => card.side === null) ?? null;

  if (wanted !== null) {
    const exact = siteCards.find((card) => card.side === wanted);
    if (exact) return { card: exact, reason: null, availableSides, needsSideChoice: false };
    if (midline) return { card: midline, reason: null, availableSides, needsSideChoice: false };
    return { card: null, reason: 'side', availableSides, needsSideChoice: false };
  }

  if (midline) return { card: midline, reason: null, availableSides, needsSideChoice: false };

  const sided = siteCards.filter((card) => card.side !== null);
  if (sided.length === 1) {
    return { card: sided[0], reason: null, availableSides, needsSideChoice: true };
  }
  return { card: null, reason: null, availableSides, needsSideChoice: true };
}

/**
 * The resting surface color, ignoring selection and abnormalities. Muscles use
 * the warm ivory and bones the slightly darker sand; side never changes it.
 */
export function baseColor(item, palette = DEFAULT_PALETTE) {
  if (item?.kind === 'bone' || item?.batch === 'bone') {
    return paletteColor(palette, 'bone');
  }
  return paletteColor(palette, 'muscle');
}

/** Whether an instance belongs to an abnormal site + side. Bones never do. */
export function isAbnormalInstance(item, highlight) {
  if (!item || item.kind === 'bone' || item.batch === 'bone') return false;
  return (highlight?.sites ?? []).some(
    (entry) => entry.siteId === item.siteId
      && (entry.side === null || entry.side === item.side),
  );
}

/**
 * The color priority: selected > abnormal > left/right base.
 * `item` is `{ siteId, side, kind }`; `kind` is `muscle` or `bone`.
 * A `selectedSide` narrows the selected tint to that side; `null` colors the
 * whole site.
 */
export function colorForInstance(
  item,
  highlight,
  selectedSite = null,
  selectedSide = null,
) {
  const palette = highlight?.palette ?? DEFAULT_PALETTE;
  const sameSide = selectedSide === null || selectedSide === item.side;
  if (selectedSite && item.siteId === selectedSite && sameSide) {
    return paletteColor(palette, 'selected');
  }
  if (isAbnormalInstance(item, highlight)) return paletteColor(palette, 'abnormal');
  return baseColor(item, palette);
}

/** Highlighted site ids that have no mesh in the loaded model. */
export function missingHighlightSites(highlight, loadedSiteIds) {
  const loaded = loadedSiteIds instanceof Set
    ? loadedSiteIds
    : new Set(loadedSiteIds ?? []);
  return [...new Set(
    (highlight?.sites ?? [])
      .map((entry) => entry.siteId)
      .filter((siteId) => !loaded.has(siteId)),
  )];
}

export function createViewerState(overrides = {}) {
  return {
    selectedSite: null,
    selectedSide: null,
    preset: 'all',
    view: 'front',
    isolate: false,
    tier: 'raw',
    framed: false,
    saved: null,
    ...overrides,
  };
}

function snapshotSite(value) {
  return typeof value === 'string' && value ? value : null;
}

function snapshotCamera(camera) {
  if (!camera || typeof camera !== 'object') return null;
  const vector = (value) => Array.isArray(value)
    && value.length === 3
    && value.every(Number.isFinite)
    ? value.slice()
    : null;
  const position = vector(camera.position);
  const target = vector(camera.target);
  const up = vector(camera.up);
  const numbers = {
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    minDistance: camera.minDistance,
    maxDistance: camera.maxDistance,
  };
  if (
    !position
    || !target
    || !up
    || !Object.values(numbers).every(Number.isFinite)
  ) {
    return null;
  }
  return { position, target, up, ...numbers };
}

function snapshotSaved(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const selectedSite = snapshotSite(saved.selectedSite);
  return {
    camera: snapshotCamera(saved.camera),
    preset: PRESETS.has(saved.preset) ? saved.preset : 'all',
    selectedSite,
    selectedSide: selectedSite ? normalizeSide(saved.selectedSide) : null,
    view: VIEWS.has(saved.view) ? saved.view : 'front',
  };
}

/**
 * Capture the cross-page contract. The camera is opaque to this module; the
 * renderer supplies its own snapshot and receives the same shape back.
 *
 * `saved` is only meaningful while isolated: it is what "show all" must
 * restore, so exporting outside isolation deliberately drops any stale copy.
 */
export function exportViewerState(state = {}, camera = null) {
  const current = { ...createViewerState(), ...state };
  const selectedSite = snapshotSite(current.selectedSite);
  const selectedSide = selectedSite ? normalizeSide(current.selectedSide) : null;
  const isolate = Boolean(current.isolate && selectedSite);
  return {
    camera: snapshotCamera(camera),
    view: VIEWS.has(current.view) ? current.view : 'front',
    preset: PRESETS.has(current.preset) ? current.preset : 'all',
    selectedSite,
    selectedSide,
    isolate,
    saved: isolate ? snapshotSaved(current.saved) : null,
  };
}

/**
 * Hydrate a snapshot for the renderer. Restoring is explicitly not a framing
 * action: the returned state is already `framed`, and the renderer applies the
 * camera directly. `attentionFacingApplied` is part of the contract so a
 * restored view can never be overwritten by the dorsal-majority heuristic.
 */
export function restoreViewerState(snapshot = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const selectedSite = snapshotSite(source.selectedSite);
  const isolate = Boolean(source.isolate && selectedSite);
  return {
    state: {
      view: VIEWS.has(source.view) ? source.view : 'front',
      preset: PRESETS.has(source.preset) ? source.preset : 'all',
      selectedSite,
      selectedSide: selectedSite ? normalizeSide(source.selectedSide) : null,
      isolate,
      saved: isolate ? snapshotSaved(source.saved) : null,
      framed: true,
    },
    camera: snapshotCamera(source.camera),
    attentionFacingApplied: true,
  };
}

/**
 * Label and pressed state for the sheet's isolation toggle. Isolation only
 * counts while a site is selected, so a stale flag can never label the button
 * as active without something to show.
 */
export function isolationControl(state = {}) {
  const active = Boolean(state.isolate && state.selectedSite);
  return {
    active,
    pressed: active,
    label: active ? '显示全部' : '只看这块',
  };
}

function visibility(state) {
  return {
    type: 'setVisibility',
    preset: state.preset,
    isolate: state.isolate,
    selectedSite: state.selectedSite,
    selectedSide: state.selectedSide,
  };
}

function unchanged(state) {
  return { state, commands: [] };
}

export function reduce(state, action = {}) {
  const current = { ...createViewerState(), ...state };

  switch (action.type) {
    case 'modelLoaded': {
      const next = { ...current, framed: true };
      const commands = [visibility(next)];
      if (!current.framed) {
        if (next.isolate && next.selectedSite) {
          commands.push({
            type: 'frameSite',
            siteId: next.selectedSite,
            view: next.view,
          });
        } else {
          commands.push({ type: 'frameBody', view: next.view });
        }
      }
      return { state: next, commands };
    }

    case 'select': {
      const siteId = action.siteId ?? null;

      if (siteId === null) {
        const saved = current.saved;
        const next = {
          ...current,
          selectedSite: null,
          selectedSide: null,
          isolate: false,
          saved: null,
        };
        if (saved) {
          next.preset = saved.preset;
          next.view = saved.view;
        }
        const commands = [visibility(next)];
        if (saved) {
          commands.push({
            type: 'restoreCamera',
            camera: saved.camera,
            view: saved.view,
          });
        }
        return { state: next, commands };
      }

      const preset = PRESETS.has(action.preset) ? action.preset : current.preset;
      const next = {
        ...current,
        selectedSite: siteId,
        selectedSide: normalizeSide(action.side),
        preset,
      };
      return { state: next, commands: [visibility(next)] };
    }

    case 'preset': {
      if (!PRESETS.has(action.preset)) return unchanged(current);
      const next = { ...current, preset: action.preset };
      return { state: next, commands: [visibility(next)] };
    }

    case 'view': {
      if (!VIEWS.has(action.view)) return unchanged(current);
      const next = { ...current, view: action.view };
      return {
        state: next,
        commands: [{ type: 'reorient', view: action.view }],
      };
    }

    case 'isolate': {
      const enabled = Boolean(action.enabled);

      if (enabled) {
        const siteId = action.siteId ?? current.selectedSite;
        if (!siteId) return unchanged(current);

        const saved = current.saved ?? {
          camera: action.camera ?? null,
          preset: current.preset,
          selectedSite: current.selectedSite ?? siteId,
          selectedSide: current.selectedSide ?? null,
          view: current.view,
        };
        const next = {
          ...current,
          isolate: true,
          selectedSite: siteId,
          saved,
        };
        return {
          state: next,
          commands: [
            visibility(next),
            { type: 'frameSite', siteId, view: next.view },
          ],
        };
      }

      if (!current.isolate) return unchanged(current);

      const saved = current.saved;
      const next = { ...current, isolate: false, saved: null };
      if (saved) {
        next.preset = saved.preset;
        next.selectedSite = saved.selectedSite;
        next.selectedSide = saved.selectedSide ?? null;
        next.view = saved.view;
      }
      const commands = [visibility(next)];
      if (saved) {
        commands.push({
          type: 'restoreCamera',
          camera: saved.camera,
          view: saved.view,
        });
      }
      return { state: next, commands };
    }

    case 'reset': {
      const next = {
        ...current,
        selectedSite: null,
        selectedSide: null,
        isolate: false,
        preset: 'all',
        view: 'front',
        saved: null,
      };
      return {
        state: next,
        commands: [visibility(next), { type: 'frameBody', view: 'front' }],
      };
    }

    case 'setTier':
    case 'downgrade': {
      if (!action.tier || action.tier === current.tier) {
        return unchanged(current);
      }
      return { state: { ...current, tier: action.tier }, commands: [] };
    }

    default:
      return unchanged(current);
  }
}
