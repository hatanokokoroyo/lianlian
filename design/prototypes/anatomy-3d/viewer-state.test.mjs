import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PALETTE,
  FRAME_COMMAND_TYPES,
  PRESET_IDS,
  VIEW_IDS,
  attentionFocusView,
  buildAttention,
  colorForInstance,
  createCards,
  createHighlight,
  createViewerState,
  exportViewerState,
  isolationControl,
  missingHighlightSites,
  nextTierForFps,
  reduce,
  resolveCard,
  restoreViewerState,
} from './viewer-state.js';

const FRAME_COMMANDS = new Set(FRAME_COMMAND_TYPES);

function framing(commands) {
  return commands.filter((command) => FRAME_COMMANDS.has(command.type));
}

function commandTypes(commands) {
  return commands.map((command) => command.type);
}

test('first model load frames the whole body exactly once', () => {
  const boot = reduce(createViewerState(), { type: 'modelLoaded' });

  assert.equal(boot.state.framed, true);
  assert.deepEqual(framing(boot.commands), [{ type: 'frameBody', view: 'front' }]);

  const reload = reduce(boot.state, { type: 'modelLoaded' });
  assert.deepEqual(commandTypes(reload.commands), ['setVisibility']);
  assert.deepEqual(framing(reload.commands), []);
});

test('export and restore round-trip camera, view, preset, site, side, isolate and saved', () => {
  const camera = {
    position: [1.25, 2.5, 3.75],
    target: [0.5, 1, -0.25],
    up: [0, 1, 0],
    fov: 32,
    near: 0.02,
    far: 18,
    minDistance: 0.8,
    maxDistance: 9.5,
  };
  const savedCamera = {
    position: [-4, 2, 1],
    target: [0, 1, 0],
    up: [0, 1, 0],
    fov: 32,
    near: 0.05,
    far: 24,
    minDistance: 1.1,
    maxDistance: 12,
  };
  const state = createViewerState({
    framed: true,
    view: 'left',
    preset: 'deep',
    selectedSite: 'multifidus',
    selectedSide: 'left',
    isolate: true,
    saved: {
      camera: savedCamera,
      view: 'back',
      preset: 'all',
      selectedSite: 'gluteus-maximus',
      selectedSide: 'right',
    },
  });

  const snapshot = exportViewerState(state, camera);

  assert.deepEqual(snapshot, {
    camera,
    view: 'left',
    preset: 'deep',
    selectedSite: 'multifidus',
    selectedSide: 'left',
    isolate: true,
    saved: {
      camera: savedCamera,
      view: 'back',
      preset: 'all',
      selectedSite: 'gluteus-maximus',
      selectedSide: 'right',
    },
  });
  assert.notEqual(snapshot.camera, camera);
  assert.notEqual(snapshot.saved.camera, savedCamera);

  const restored = restoreViewerState(snapshot);

  assert.deepEqual(restored.state, {
    view: 'left',
    preset: 'deep',
    selectedSite: 'multifidus',
    selectedSide: 'left',
    isolate: true,
    saved: snapshot.saved,
    framed: true,
  });
  assert.deepEqual(restored.camera, camera);
  assert.equal(restored.attentionFacingApplied, true);
});

test('restoring clears the attention-facing gate so a saved view is not overridden', () => {
  const restored = restoreViewerState(exportViewerState(
    createViewerState({
      framed: true,
      view: 'right',
      preset: 'bone',
      selectedSite: 'gluteus-medius',
      selectedSide: 'right',
    }),
    {
      position: [3, 1, 0],
      target: [0, 1, 0],
      up: [0, 1, 0],
      fov: 32,
      near: 0.02,
      far: 18,
      minDistance: 0.8,
      maxDistance: 9,
    },
  ));

  assert.equal(restored.attentionFacingApplied, true);
  assert.equal(restored.state.view, 'right');
  assert.equal(restored.state.preset, 'bone');
  assert.equal(restored.state.selectedSite, 'gluteus-medius');
  assert.equal(restored.state.framed, true);
});

test('export drops saved state outside isolation and restore tolerates a bad snapshot', () => {
  const idle = createViewerState({
    framed: true,
    selectedSite: 'gluteus-maximus',
    selectedSide: 'left',
    saved: {
      camera: null,
      view: 'back',
      preset: 'all',
      selectedSite: 'gluteus-maximus',
      selectedSide: 'left',
    },
  });

  const snapshot = exportViewerState(idle, null);
  assert.equal(snapshot.saved, null);
  assert.equal(snapshot.camera, null);

  const restored = restoreViewerState({
    camera: { position: [1, 2], target: [0, 1, 0] },
    view: 'missing',
    preset: 'missing',
    selectedSite: 'gluteus-maximus',
    selectedSide: 'middle',
    isolate: true,
    saved: { view: 'missing', preset: 'missing' },
  });

  assert.equal(restored.state.view, 'front');
  assert.equal(restored.state.preset, 'all');
  assert.equal(restored.state.selectedSide, null);
  assert.equal(restored.state.isolate, true);
  assert.equal(restored.state.saved.view, 'front');
  assert.equal(restored.state.saved.preset, 'all');
  assert.equal(restored.camera, null);
});

test('attention focus turns back only when dorsal mesh centers are the majority', () => {
  assert.equal(attentionFocusView([-1.2, -0.4, 0.8]), 'back');
  assert.equal(attentionFocusView([-1.2, 0.8]), 'front');
  assert.equal(attentionFocusView([0]), 'front');
  assert.equal(attentionFocusView([]), 'front');
});

test('selecting and clearing a site never frames', () => {
  const selected = reduce(createViewerState({ framed: true }), {
    type: 'select',
    siteId: 'multifidus',
  });

  assert.equal(selected.state.selectedSite, 'multifidus');
  assert.deepEqual(framing(selected.commands), []);
  assert.deepEqual(selected.commands, [
    {
      type: 'setVisibility',
      preset: 'all',
      isolate: false,
      selectedSite: 'multifidus',
      selectedSide: null,
    },
  ]);

  const cleared = reduce(selected.state, { type: 'select', siteId: null });
  assert.equal(cleared.state.selectedSite, null);
  assert.deepEqual(framing(cleared.commands), []);
});

test('selecting a side records it without framing', () => {
  const selected = reduce(createViewerState({ framed: true }), {
    type: 'select',
    siteId: 'gluteus-maximus',
    side: 'left',
  });

  assert.equal(selected.state.selectedSite, 'gluteus-maximus');
  assert.equal(selected.state.selectedSide, 'left');
  assert.deepEqual(selected.commands, [
    {
      type: 'setVisibility',
      preset: 'all',
      isolate: false,
      selectedSite: 'gluteus-maximus',
      selectedSide: 'left',
    },
  ]);
  assert.deepEqual(framing(selected.commands), []);

  const cleared = reduce(selected.state, { type: 'select', siteId: null });
  assert.equal(cleared.state.selectedSite, null);
  assert.equal(cleared.state.selectedSide, null);
  assert.deepEqual(framing(cleared.commands), []);
});

test('a side selection only tints that side', () => {
  const highlight = createHighlight(DEFAULT_PALETTE, [
    { siteId: 'gluteus-maximus', side: null },
  ]);

  assert.equal(
    colorForInstance(
      { siteId: 'gluteus-maximus', side: 'left', kind: 'muscle' },
      highlight,
      'gluteus-maximus',
      'left',
    ),
    DEFAULT_PALETTE.selected,
  );
  assert.equal(
    colorForInstance(
      { siteId: 'gluteus-maximus', side: 'right', kind: 'muscle' },
      highlight,
      'gluteus-maximus',
      'left',
    ),
    DEFAULT_PALETTE.abnormal,
  );
  assert.equal(
    colorForInstance(
      { siteId: 'gluteus-maximus', side: 'left', kind: 'muscle' },
      highlight,
      'gluteus-maximus',
      null,
    ),
    DEFAULT_PALETTE.selected,
  );
});

test('clearing selection while isolated restores the camera without framing', () => {
  const camera = { position: [1, 2, 3], target: [0, 1, 0] };
  const isolated = reduce(
    createViewerState({ framed: true, selectedSite: 'multifidus' }),
    { type: 'isolate', enabled: true, camera },
  ).state;

  const cleared = reduce(isolated, { type: 'select', siteId: null });

  assert.equal(cleared.state.selectedSite, null);
  assert.equal(cleared.state.isolate, false);
  assert.deepEqual(framing(cleared.commands), []);
  assert.deepEqual(cleared.commands[1], {
    type: 'restoreCamera',
    camera,
    view: 'front',
  });
});

test('clearing selection after changing preset while isolated restores the saved preset first', () => {
  const camera = { position: [1, 2, 3], target: [0, 1, 0] };
  const isolated = reduce(
    createViewerState({ framed: true, selectedSite: 'multifidus', preset: 'deep' }),
    { type: 'isolate', enabled: true, camera },
  ).state;
  const changed = reduce(isolated, { type: 'preset', preset: 'bone' }).state;

  const cleared = reduce(changed, { type: 'select', siteId: null });

  assert.equal(cleared.state.preset, 'deep');
  assert.deepEqual(cleared.commands[0], {
    type: 'setVisibility',
    preset: 'deep',
    isolate: false,
    selectedSite: null,
    selectedSide: null,
  });
  assert.equal(cleared.commands[1].type, 'restoreCamera');
});

test('every preset change leaves the camera alone', () => {
  for (const preset of PRESET_IDS) {
    const result = reduce(createViewerState({ framed: true }), {
      type: 'preset',
      preset,
    });

    assert.equal(result.state.preset, preset);
    assert.deepEqual(commandTypes(result.commands), ['setVisibility']);
    assert.deepEqual(framing(result.commands), []);
  }
});

test('view changes emit only a reorient command', () => {
  for (const view of VIEW_IDS) {
    const result = reduce(createViewerState({ framed: true }), {
      type: 'view',
      view,
    });

    assert.equal(result.state.view, view);
    assert.deepEqual(result.commands, [{ type: 'reorient', view }]);
    assert.deepEqual(
      result.commands.filter(
        (command) => command.type === 'frameBody' || command.type === 'frameSite',
      ),
      [],
    );
  }
});

test('isolating saves the pre-isolation camera and preset, then frames the site', () => {
  const camera = { position: [1, 2, 3], target: [0, 1, 0] };
  const before = createViewerState({
    framed: true,
    selectedSite: 'multifidus',
    preset: 'deep',
    view: 'back',
  });

  const result = reduce(before, { type: 'isolate', enabled: true, camera });

  assert.equal(result.state.isolate, true);
  assert.equal(result.state.preset, 'deep');
  assert.deepEqual(result.state.saved, {
    camera,
    preset: 'deep',
    selectedSite: 'multifidus',
    selectedSide: null,
    view: 'back',
  });
  assert.deepEqual(result.commands, [
    {
      type: 'setVisibility',
      preset: 'deep',
      isolate: true,
      selectedSite: 'multifidus',
      selectedSide: null,
    },
    { type: 'frameSite', siteId: 'multifidus', view: 'back' },
  ]);
});

test('leaving isolation restores the saved camera, preset, selection, and view', () => {
  const camera = { position: [1, 2, 3], target: [0, 1, 0] };
  const before = createViewerState({
    framed: true,
    selectedSite: 'multifidus',
    preset: 'deep',
    view: 'back',
  });
  const isolated = reduce(before, { type: 'isolate', enabled: true, camera }).state;
  const changed = reduce(isolated, { type: 'preset', preset: 'bone' }).state;

  const result = reduce(changed, { type: 'isolate', enabled: false });

  assert.equal(result.state.isolate, false);
  assert.equal(result.state.preset, 'deep');
  assert.equal(result.state.selectedSite, 'multifidus');
  assert.equal(result.state.view, 'back');
  assert.equal(result.state.saved, null);
  assert.deepEqual(framing(result.commands), []);
  assert.deepEqual(result.commands, [
    {
      type: 'setVisibility',
      preset: 'deep',
      isolate: false,
      selectedSite: 'multifidus',
      selectedSide: null,
    },
    { type: 'restoreCamera', camera, view: 'back' },
  ]);
});

test('isolation saves and restores the selected side while isolating the whole site', () => {
  const camera = { position: [1, 2, 3], target: [0, 1, 0] };
  const before = createViewerState({
    framed: true,
    selectedSite: 'gluteus-maximus',
    selectedSide: 'left',
    preset: 'all',
    view: 'front',
  });

  const isolated = reduce(before, { type: 'isolate', enabled: true, camera });

  assert.equal(isolated.state.saved.selectedSite, 'gluteus-maximus');
  assert.equal(isolated.state.saved.selectedSide, 'left');
  assert.deepEqual(isolated.commands[0], {
    type: 'setVisibility',
    preset: 'all',
    isolate: true,
    selectedSite: 'gluteus-maximus',
    selectedSide: 'left',
  });
  assert.deepEqual(isolated.commands[1], {
    type: 'frameSite',
    siteId: 'gluteus-maximus',
    view: 'front',
  });

  const restored = reduce(isolated.state, { type: 'isolate', enabled: false });

  assert.equal(restored.state.selectedSite, 'gluteus-maximus');
  assert.equal(restored.state.selectedSide, 'left');
  assert.deepEqual(framing(restored.commands), []);
});

test('the isolation control follows enter and exit, and cannot activate without a selection', () => {
  const idle = createViewerState({ framed: true });
  assert.deepEqual(isolationControl(idle), {
    active: false,
    pressed: false,
    label: '只看这块',
  });

  const noSelection = reduce(idle, {
    type: 'isolate',
    enabled: true,
    camera: { position: [1, 2, 3], target: [0, 1, 0] },
  });
  assert.deepEqual(noSelection.commands, []);
  assert.deepEqual(noSelection.state, idle);

  const camera = { position: [1, 2, 3], target: [0, 1, 0] };
  const isolated = reduce(
    createViewerState({ framed: true, selectedSite: 'gluteus-maximus', selectedSide: 'left' }),
    { type: 'isolate', enabled: true, camera },
  ).state;
  assert.deepEqual(isolationControl(isolated), {
    active: true,
    pressed: true,
    label: '显示全部',
  });

  const restored = reduce(isolated, { type: 'isolate', enabled: false }).state;
  assert.deepEqual(isolationControl(restored), {
    active: false,
    pressed: false,
    label: '只看这块',
  });
});

test('reset during a side isolation clears the saved snapshot and selected side', () => {
  const camera = { position: [4, 5, 6], target: [0, 1, 0] };
  const isolated = reduce(
    createViewerState({
      framed: true,
      selectedSite: 'gluteus-maximus',
      selectedSide: 'right',
      preset: 'bone',
      view: 'left',
    }),
    { type: 'isolate', enabled: true, camera },
  ).state;

  const result = reduce(isolated, { type: 'reset' });

  assert.equal(result.state.isolate, false);
  assert.equal(result.state.saved, null);
  assert.equal(result.state.selectedSite, null);
  assert.equal(result.state.selectedSide, null);
  assert.equal(result.state.preset, 'all');
  assert.equal(result.state.view, 'front');
  assert.deepEqual(framing(result.commands), [{ type: 'frameBody', view: 'front' }]);
});

test('card resolution prefers the same side, then the midline card, then reports what is missing', () => {
  const cards = createCards([
    {
      siteId: 'gluteus-maximus',
      siteZh: '臀大肌',
      side: 'left',
      sideZh: '左',
      axes: [],
      at: 1,
      resolved: false,
      worst: '臀大肌左 · 张力 紧',
    },
    {
      siteId: 'transversus-abdominis',
      siteZh: '腹横肌',
      side: null,
      sideZh: null,
      axes: [],
      at: 2,
      resolved: false,
      worst: '腹横肌 · 张力 紧',
    },
  ]);

  assert.equal(
    resolveCard(cards, 'gluteus-maximus', 'left').card.siteId,
    'gluteus-maximus',
  );
  assert.deepEqual(resolveCard(cards, 'gluteus-maximus', 'right'), {
    card: null,
    reason: 'side',
  });
  assert.equal(
    resolveCard(cards, 'transversus-abdominis', null).card.siteId,
    'transversus-abdominis',
  );
  assert.deepEqual(resolveCard(cards, 'multifidus', 'left'), {
    card: null,
    reason: 'site',
  });
});

test('midline card fallback wins for one-sided selections', () => {
  const cards = createCards([
    {
      siteId: 'transversus-abdominis',
      siteZh: '腹横肌',
      side: null,
      sideZh: null,
      axes: [],
      at: 1,
      resolved: false,
      worst: '腹横肌 · 张力 紧',
    },
  ]);

  const resolved = resolveCard(cards, 'transversus-abdominis', 'left');
  assert.equal(resolved.reason, null);
  assert.equal(resolved.card.side, null);
  assert.equal(resolved.card.worst, '腹横肌 · 张力 紧');
});

test('attention groups follow the archive card order, not the highlight order', () => {
  const cards = createCards([
    {
      siteId: 'transversus-abdominis',
      siteZh: '腹横肌',
      side: null,
      sideZh: null,
      groupId: 'core',
      groupZh: '核心',
      axes: [],
      at: 1,
      resolved: false,
      worst: '腹横肌 · 张力 紧',
    },
    {
      siteId: 'gluteus-maximus',
      siteZh: '臀大肌',
      side: 'left',
      sideZh: '左',
      groupId: 'gluteal',
      groupZh: '臀肌群',
      axes: [],
      at: 2,
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
      at: 3,
      resolved: false,
      worst: '多裂肌左 · 张力 紧',
    },
    {
      siteId: 'gluteus-maximus',
      siteZh: '臀大肌',
      side: 'right',
      sideZh: '右',
      groupId: 'gluteal',
      groupZh: '臀肌群',
      axes: [],
      at: 4,
      resolved: false,
      worst: '臀大肌右 · 张力 紧',
    },
  ]);
  const sites = [
    { siteId: 'multifidus', side: 'left' },
    { siteId: 'gluteus-maximus', side: 'right' },
    { siteId: 'gluteus-maximus', side: 'left' },
    { siteId: 'gluteus-maximus', side: 'left' },
    { siteId: 'transversus-abdominis', side: null },
  ];

  const attention = buildAttention(cards, sites, [
    'transversus-abdominis',
    'gluteus-maximus',
    'multifidus',
  ]);

  assert.equal(attention.count, 4);
  assert.deepEqual(
    attention.sections.map((section) => [section.groupId, section.groupZh]),
    [
      ['core', '核心'],
      ['gluteal', '臀肌群'],
      ['spinal-deep', '脊柱深层'],
    ],
  );
  assert.deepEqual(
    attention.sections.map((section) => section.rows.map((row) => `${row.siteId}:${row.side}`)),
    [
      ['transversus-abdominis:null'],
      ['gluteus-maximus:left', 'gluteus-maximus:right'],
      ['multifidus:left'],
    ],
  );
  assert.equal(attention.sections[0].rows[0].sideZh, null);
  assert.equal(attention.sections[1].rows[0].sideZh, '左');
  assert.equal(attention.sections[1].rows[0].worst, '臀大肌左 · 张力 紧');
});

test('attention keeps missing meshes visible and marks only those rows', () => {
  const cards = createCards([
    {
      siteId: 'gluteus-maximus',
      siteZh: '臀大肌',
      side: 'left',
      sideZh: '左',
      groupId: 'gluteal',
      groupZh: '臀肌群',
      axes: [],
      at: 1,
      resolved: false,
      worst: '臀大肌左 · 张力 紧',
    },
    {
      siteId: 'quadratus-lumborum',
      siteZh: '腰方肌',
      side: 'right',
      sideZh: '右',
      groupId: 'lumbar',
      groupZh: '腰背肌群',
      axes: [],
      at: 2,
      resolved: false,
      worst: '腰方肌右 · 张力 紧',
    },
  ]);

  const attention = buildAttention(
    cards,
    [
      { siteId: 'gluteus-maximus', side: 'left' },
      { siteId: 'quadratus-lumborum', side: 'right' },
    ],
    new Set(['gluteus-maximus']),
  );

  assert.equal(attention.count, 2);
  assert.deepEqual(
    attention.sections.flatMap((section) => section.rows.map((row) => ({
      siteId: row.siteId,
      sideZh: row.sideZh,
      missing: row.missing,
    }))),
    [
      { siteId: 'gluteus-maximus', sideZh: '左', missing: false },
      { siteId: 'quadratus-lumborum', sideZh: '右', missing: true },
    ],
  );
});

test('attention is empty when no site needs attention', () => {
  assert.deepEqual(buildAttention([], [], ['gluteus-maximus']), {
    sections: [],
    count: 0,
  });

  const cards = createCards([
    {
      siteId: 'gluteus-maximus',
      siteZh: '臀大肌',
      side: 'left',
      sideZh: '左',
      groupId: 'gluteal',
      groupZh: '臀肌群',
      axes: [],
      at: 1,
      resolved: false,
      worst: '臀大肌左 · 张力 紧',
    },
  ]);
  assert.deepEqual(buildAttention(cards, [], new Set()), {
    sections: [],
    count: 0,
  });
});

test('attention does not mark rows missing before the model is ready', () => {
  const cards = createCards([
    {
      siteId: 'gluteus-maximus',
      siteZh: '臀大肌',
      side: 'left',
      sideZh: '左',
      groupId: 'gluteal',
      groupZh: '臀肌群',
      axes: [],
      at: 1,
      resolved: false,
      worst: '臀大肌左 · 张力 紧',
    },
  ]);
  const sites = [{ siteId: 'gluteus-maximus', side: 'left' }];

  assert.equal(buildAttention(cards, sites, null).sections[0].rows[0].missing, false);
  assert.equal(
    buildAttention(cards, sites, new Set(['something-else']))
      .sections[0].rows[0].missing,
    true,
  );
});

test('reset frames the whole body and clears selection, isolation, preset, and view', () => {
  const camera = { position: [1, 2, 3], target: [0, 1, 0] };
  const isolated = reduce(
    createViewerState({
      framed: true,
      selectedSite: 'multifidus',
      preset: 'deep',
      view: 'back',
    }),
    { type: 'isolate', enabled: true, camera },
  ).state;

  const result = reduce(isolated, { type: 'reset' });

  assert.equal(result.state.selectedSite, null);
  assert.equal(result.state.isolate, false);
  assert.equal(result.state.preset, 'all');
  assert.equal(result.state.view, 'front');
  assert.equal(result.state.saved, null);
  assert.deepEqual(result.commands, [
    {
      type: 'setVisibility',
      preset: 'all',
      isolate: false,
      selectedSite: null,
      selectedSide: null,
    },
    { type: 'frameBody', view: 'front' },
  ]);
});

test('automatic tier downgrade preserves camera, selection, preset, and view', () => {
  const camera = { position: [1, 2, 3], target: [0, 1, 0] };
  const isolated = reduce(
    createViewerState({
      framed: true,
      selectedSite: 'multifidus',
      preset: 'deep',
      view: 'back',
    }),
    { type: 'isolate', enabled: true, camera },
  ).state;

  const result = reduce(isolated, { type: 'downgrade', tier: 'cap3000' });

  assert.equal(result.state.tier, 'cap3000');
  assert.equal(result.state.selectedSite, 'multifidus');
  assert.equal(result.state.preset, 'deep');
  assert.equal(result.state.view, 'back');
  assert.equal(result.state.isolate, true);
  assert.equal(result.state.saved, isolated.saved);
  assert.deepEqual(result.commands, []);
  assert.deepEqual(framing(result.commands), []);
});

test('the tier ladder uses strict 24/20 fps boundaries and keeps its order', () => {
  assert.equal(nextTierForFps(24, 'raw'), null);
  assert.equal(nextTierForFps(23.99, 'raw'), 'cap3000');
  assert.equal(nextTierForFps(20, 'cap3000'), null);
  assert.equal(nextTierForFps(19.99, 'cap3000'), 'cap2000');
  assert.equal(nextTierForFps(20, 'cap2000'), null);
  assert.equal(nextTierForFps(19.99, 'cap2000'), 'slow');
  assert.equal(nextTierForFps(30, 'raw'), null);
  assert.equal(nextTierForFps(30, 'cap3000'), null);
  assert.equal(nextTierForFps(30, 'cap2000'), null);
});

test('the tier ladder is one-way and ignores invalid readings or unknown tiers', () => {
  assert.equal(nextTierForFps(23, 'cap3000'), null);
  assert.equal(nextTierForFps(19, 'raw'), 'cap3000');
  assert.equal(nextTierForFps(10, 'cap3000'), 'cap2000');
  assert.equal(nextTierForFps(10, 'cap2000'), 'slow');
  assert.equal(nextTierForFps(10, 'unknown'), null);
  assert.equal(nextTierForFps(0, 'raw'), null);
  assert.equal(nextTierForFps(-1, 'raw'), null);
  assert.equal(nextTierForFps(Number.NaN, 'raw'), null);
  assert.equal(nextTierForFps(Infinity, 'raw'), null);
  assert.equal(nextTierForFps('24', 'raw'), null);
});

test('a downgrade never emits a frame command and preserves the isolation snapshot', () => {
  const camera = { position: [1, 2, 3], target: [0, 1, 0] };
  const isolated = reduce(
    createViewerState({
      framed: true,
      selectedSite: 'gluteus-maximus',
      selectedSide: 'left',
      preset: 'deep',
      view: 'back',
      tier: 'raw',
    }),
    { type: 'isolate', enabled: true, camera },
  ).state;
  const before = JSON.parse(JSON.stringify(isolated));

  for (const tier of ['cap3000', 'cap2000']) {
    const result = reduce(isolated, { type: 'downgrade', tier });
    assert.equal(result.state.tier, tier);
    assert.equal(result.state.selectedSite, before.selectedSite);
    assert.equal(result.state.selectedSide, before.selectedSide);
    assert.equal(result.state.preset, before.preset);
    assert.equal(result.state.view, before.view);
    assert.equal(result.state.isolate, true);
    assert.deepEqual(result.state.saved, before.saved);
    assert.deepEqual(result.commands, []);
    assert.deepEqual(framing(result.commands), []);
  }
});

test('first load in an isolated URL frames the site instead of the body', () => {
  const result = reduce(
    createViewerState({
      selectedSite: 'multifidus',
      isolate: true,
      preset: 'deep',
      view: 'back',
    }),
    { type: 'modelLoaded' },
  );

  assert.deepEqual(framing(result.commands), [
    { type: 'frameSite', siteId: 'multifidus', view: 'back' },
  ]);
});

test('invalid preset and view actions leave the state untouched', () => {
  const state = createViewerState({ framed: true, preset: 'deep', view: 'left' });

  const preset = reduce(state, { type: 'preset', preset: 'missing' });
  const view = reduce(state, { type: 'view', view: 'missing' });

  assert.deepEqual(preset.commands, []);
  assert.equal(preset.state.preset, 'deep');
  assert.deepEqual(view.commands, []);
  assert.equal(view.state.view, 'left');
});

test('highlight priority is selected over abnormal over side color', () => {
  const highlight = createHighlight(DEFAULT_PALETTE, [
    { siteId: 'gluteus-maximus', side: null },
  ]);
  const item = { siteId: 'gluteus-maximus', side: 'left', kind: 'muscle' };

  assert.equal(
    colorForInstance(item, highlight, 'gluteus-maximus'),
    DEFAULT_PALETTE.selected,
  );
  assert.equal(colorForInstance(item, highlight), DEFAULT_PALETTE.abnormal);
  assert.equal(
    colorForInstance({ ...item, siteId: 'gluteus-medius' }, highlight),
    DEFAULT_PALETTE.left,
  );
  assert.equal(
    colorForInstance(
      { ...item, siteId: 'gluteus-medius', side: 'right' },
      highlight,
    ),
    DEFAULT_PALETTE.right,
  );
});

test('a null side colors both sides while a named side colors only that side', () => {
  const both = createHighlight(DEFAULT_PALETTE, [
    { siteId: 'transversus-abdominis', side: null },
  ]);
  assert.equal(
    colorForInstance(
      { siteId: 'transversus-abdominis', side: 'left', kind: 'muscle' },
      both,
    ),
    DEFAULT_PALETTE.abnormal,
  );
  assert.equal(
    colorForInstance(
      { siteId: 'transversus-abdominis', side: 'right', kind: 'muscle' },
      both,
    ),
    DEFAULT_PALETTE.abnormal,
  );

  const left = createHighlight(DEFAULT_PALETTE, [
    { siteId: 'gluteus-maximus', side: 'left' },
  ]);
  assert.equal(
    colorForInstance(
      { siteId: 'gluteus-maximus', side: 'left', kind: 'muscle' },
      left,
    ),
    DEFAULT_PALETTE.abnormal,
  );
  assert.equal(
    colorForInstance(
      { siteId: 'gluteus-maximus', side: 'right', kind: 'muscle' },
      left,
    ),
    DEFAULT_PALETTE.right,
  );
});

test('bones ignore the abnormal set even when a site is listed', () => {
  const highlight = createHighlight(DEFAULT_PALETTE, [
    { siteId: 'lumbar-vertebrae', side: null },
  ]);

  assert.equal(
    colorForInstance(
      { siteId: 'lumbar-vertebrae', side: 'mid', kind: 'bone', batch: 'bone' },
      highlight,
    ),
    DEFAULT_PALETTE.mid,
  );
});

test('missing highlight sites keep their identity instead of disappearing', () => {
  const highlight = createHighlight(DEFAULT_PALETTE, [
    { siteId: 'multifidus', side: 'left' },
    { siteId: 'not-in-model', side: 'right' },
    { siteId: 'not-in-model', side: null },
  ]);

  assert.deepEqual(
    missingHighlightSites(highlight, ['multifidus', 'gluteus-maximus']),
    ['not-in-model'],
  );
  assert.deepEqual(missingHighlightSites(highlight, new Set(['multifidus'])), [
    'not-in-model',
  ]);
});

test('highlight requests merge palette defaults and collapse duplicate sites', () => {
  const highlight = createHighlight(
    { abnormal: '#ff0000', selected: '#00ff00' },
    [
      { siteId: 'multifidus', side: 'left' },
      { siteId: 'multifidus', side: 'left' },
      { siteId: 'multifidus', side: 'sideways' },
    ],
  );

  assert.equal(highlight.palette.abnormal, '#ff0000');
  assert.equal(highlight.palette.selected, '#00ff00');
  assert.equal(highlight.palette.left, DEFAULT_PALETTE.left);
  assert.deepEqual(highlight.sites, [
    { siteId: 'multifidus', side: 'left' },
    { siteId: 'multifidus', side: null },
  ]);
});
