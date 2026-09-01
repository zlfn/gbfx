const $ = (id) => document.getElementById(id);

// The four shades a Game Boy's screen shows, lightest first.
const DMG_SHADES = [[0x9b, 0xbc, 0x0f], [0x8b, 0xac, 0x0f], [0x30, 0x62, 0x30], [0x0f, 0x38, 0x0f]];

const worker = new Worker('./worker.js', { type: 'module' });
const pending = new Map();
let nextId = 0;

worker.onmessage = (e) => {
  const { id, ok, result, error } = e.data;
  const job = pending.get(id);
  if (!job) return;
  pending.delete(id);
  ok ? job.resolve(result) : job.reject(new Error(error));
};

function runConvert(rgba, width, height, opts) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, rgba, width, height, opts }, [rgba.buffer]);
  });
}

// ── state ──────────────────────────────────────────────────

const state = {
  name: 'image',
  source: null,     // ImageData of the loaded file
  out: null,        // last conversion
  zoom: 2,
  view: 'preview',
  seq: 0,
};

// ── loading an image ───────────────────────────────────────

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showError('That file is not an image.');
    return;
  }
  state.name = file.name.replace(/\.[^.]+$/, '') || 'image';

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    showError('Could not decode that image.');
    return;
  }

  const cv = document.createElement('canvas');
  cv.width = bitmap.width;
  cv.height = bitmap.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  state.source = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  $('opts').hidden = false;
  $('empty').hidden = true;
  drawSource();
  schedule();
}

// ── options ────────────────────────────────────────────────

function readOptions() {
  const dmg = $('c-dmg').checked;
  const quantizing = $('do-quantize').checked;
  return {
    obj: $('do-obj').checked,
    dmg,
    quantizeWidth: quantizing ? Math.max(8, +$('qw').value | 0) : 0,
    quantizeHeight: quantizing ? Math.max(8, +$('qh').value | 0) : 0,
    maxPalettes: dmg ? 1 : +$('maxpal').value,
    dither: $('do-dither').checked ? +$('dither-w').value : -1,
    ditherMethod: $('dither-m').value,
    gbcCorrection: !dmg && quantizing && $('gbc-correct').checked,
    metaWidth: $('do-meta').checked ? Math.max(8, +$('mw').value | 0) : 0,
    metaHeight: $('do-meta').checked ? Math.max(8, +$('mh').value | 0) : 0,
    map: $('do-map').checked,
    dedup: $('do-map').checked && $('do-dedup').checked,
    flip: $('do-map').checked && $('do-dedup').checked && !dmg && $('do-flip').checked,
  };
}

// Keep the form from offering combinations the converter refuses.
function syncForm() {
  const dmg = $('c-dmg').checked;
  const quantizing = $('do-quantize').checked;
  const map = $('do-map').checked;
  const dedup = map && $('do-dedup').checked;

  setEnabled($('do-dedup'), map);
  setEnabled($('do-flip'), dedup && !dmg);
  setEnabled($('gbc-correct'), !dmg && quantizing);
  $('palette-set').classList.toggle('is-hidden', dmg);
  $('size-row').classList.toggle('is-hidden', !quantizing);
  $('size-note').classList.toggle('is-hidden', !quantizing);
  $('dither-body').classList.toggle('is-hidden', !$('do-dither').checked);
  $('meta-row').classList.toggle('is-hidden', !$('do-meta').checked);

  $('maxpal-out').value = $('maxpal').value;
  $('dither-out').value = (+$('dither-w').value).toFixed(2);
  $('cap-result').textContent = dmg ? 'game boy' : 'game boy color';
}

function setEnabled(input, on) {
  input.disabled = !on;
  input.closest('.check').classList.toggle('is-off', !on);
}

// ── conversion ─────────────────────────────────────────────

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(convertNow, 180);
}

async function convertNow() {
  if (!state.source) return;
  syncForm();

  const seq = ++state.seq;
  const opts = readOptions();
  const rgba = new Uint8Array(state.source.data); // the worker takes ownership

  showError(null);
  $('busy').hidden = false;
  setViewsHidden(true);

  try {
    const out = await runConvert(rgba, state.source.width, state.source.height, opts);
    if (seq !== state.seq) return; // a newer run has started
    state.out = { ...out, opts };
    render();
  } catch (err) {
    if (seq !== state.seq) return;
    state.out = null;
    $('foot').hidden = true;
    showError(err.message);
  } finally {
    if (seq === state.seq) $('busy').hidden = true;
  }
}

// ── rendering ──────────────────────────────────────────────

function render() {
  setViewsHidden(true);
  $('view-' + state.view).hidden = false;
  $('zoom-wrap').style.visibility = state.view === 'palettes' ? 'hidden' : 'visible';

  if (state.view === 'preview') drawPreview();
  else if (state.view === 'tiles') drawTiles();
  else drawPalettes();

  drawStats();
  drawDownloads();
  $('foot').hidden = false;
}

function setViewsHidden(hidden) {
  for (const v of ['preview', 'tiles', 'palettes']) $('view-' + v).hidden = hidden;
}

function drawSource() {
  const { width: w, height: h } = state.source;
  const max = 320;
  const scale = Math.min(1, max / w, max / h);
  const cv = $('cv-source');
  cv.width = Math.max(1, Math.round(w * scale));
  cv.height = Math.max(1, Math.round(h * scale));
  cv.style.width = cv.width + 'px';
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').putImageData(state.source, 0, 0);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
}

function drawPreview() {
  const o = state.out;
  const cv = $('cv-result');
  cv.width = o.previewWidth;
  cv.height = o.previewHeight;
  cv.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(o.preview), o.previewWidth, o.previewHeight), 0, 0);
  cv.style.width = o.previewWidth * state.zoom + 'px';
  cv.classList.toggle('checker', o.opts.obj);
}

// Every tile drawn with the palette of the first cell that uses it.
function drawTiles() {
  const o = state.out;
  const grid = $('tilegrid');
  grid.textContent = '';

  const count = o.tiles.length / 16;
  const palettes = readPalettes(o);
  const palOf = new Array(count).fill(0);
  if (o.attributes.length) {
    const cells = o.map.length ? o.map : null;
    for (let cell = o.attributes.length - 1; cell >= 0; cell--) {
      const t = cells ? cells[cell] : cell;
      if (t < count) palOf[t] = o.attributes[cell] & 0x07;
    }
  }

  const z = Math.max(2, state.zoom * 2);
  const frag = document.createDocumentFragment();
  for (let t = 0; t < count; t++) {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 8;
    cv.style.width = cv.style.height = 8 * z + 'px';
    cv.title = `tile ${t}`;
    const img = new ImageData(8, 8);
    const pal = palettes[palOf[t]] || palettes[0];
    for (let r = 0; r < 8; r++) {
      const lo = o.tiles[t * 16 + r * 2], hi = o.tiles[t * 16 + r * 2 + 1];
      for (let c = 0; c < 8; c++) {
        const i = ((lo >> (7 - c)) & 1) | (((hi >> (7 - c)) & 1) << 1);
        const p = (r * 8 + c) * 4;
        const rgb = pal[i];
        img.data[p] = rgb[0]; img.data[p + 1] = rgb[1]; img.data[p + 2] = rgb[2];
        img.data[p + 3] = o.opts.obj && i === 0 ? 0 : 255;
      }
    }
    cv.getContext('2d').putImageData(img, 0, 0);
    if (o.opts.obj) cv.classList.add('checker');
    frag.append(cv);
  }
  grid.append(frag);
}

function readPalettes(o) {
  if (!o.palettes.length) return [DMG_SHADES];
  const out = [];
  for (let p = 0; p + 8 <= o.palettes.length; p += 8) {
    const pal = [];
    for (let i = 0; i < 4; i++) {
      const v = o.palettes[p + i * 2] | (o.palettes[p + i * 2 + 1] << 8);
      const e = (x) => (x << 3) | (x >> 2);
      pal.push([e(v & 31), e((v >> 5) & 31), e((v >> 10) & 31)]);
    }
    out.push(pal);
  }
  return out;
}

function drawPalettes() {
  const box = $('palettes');
  box.textContent = '';
  const palettes = readPalettes(state.out);
  palettes.forEach((pal, i) => {
    const el = document.createElement('div');
    el.className = 'pal';
    const head = document.createElement('div');
    head.className = 'pal-head';
    head.textContent = state.out.palettes.length ? `palette ${i}` : 'screen shades';
    const row = document.createElement('div');
    row.className = 'pal-swatches';
    pal.forEach(([r, g, b], j) => {
      const sw = document.createElement('div');
      sw.className = 'pal-swatch';
      sw.style.background = `rgb(${r},${g},${b})`;
      const code = document.createElement('code');
      code.textContent = state.out.opts.obj && j === 0 ? '—' : hex(r, g, b);
      sw.append(code);
      row.append(sw);
    });
    el.append(head, row);
    box.append(el);
  });
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

function drawStats() {
  const o = state.out;
  const rows = [
    ['tiles', `${o.uniqueTiles}${o.uniqueTiles !== o.totalTiles ? ` / ${o.totalTiles}` : ''}`],
    ['palettes', o.palettes.length ? o.paletteCount : '—'],
    ['size', `${o.previewWidth}×${o.previewHeight}`],
    ['took', `${o.ms} ms`],
  ];
  $('stats').innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
}

function drawDownloads() {
  const o = state.out;
  const box = $('downloads');
  box.textContent = '';
  const files = [
    ['tiles', o.tiles],
    ['palettes', o.palettes],
    ['attributes', o.attributes],
    ['map', o.map],
  ].filter(([, d]) => d.length);

  for (const [kind, data] of files) {
    const b = document.createElement('button');
    b.className = 'dl';
    b.innerHTML = `${kind}.bin <small>${data.length} B</small>`;
    b.onclick = () => save(`${state.name}_${kind}.bin`, data);
    box.append(b);
  }
  const png = document.createElement('button');
  png.className = 'dl';
  png.innerHTML = 'preview.png';
  png.onclick = () => $('cv-result').toBlob((blob) => saveBlob(`${state.name}_preview.png`, blob));
  box.append(png);
}

function save(name, data) {
  saveBlob(name, new Blob([data], { type: 'application/octet-stream' }));
}
function saveBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The converter reports in command-line terms; say it in the page's terms.
const CONTROL_NAMES = {
  '--quantize': 'the target size',
  '--dither': 'Dither',
  '--map': 'Tile map',
  '--dedup': 'Fold identical tiles',
  '--flip': 'Also fold mirrored',
  '--dmg': 'Game Boy mode',
  '--gbc-correction': 'Correct for the console screen',
  '--obj': 'Transparent index 0',
  '--metasprite': 'Metasprite cells',
};

function humanize(msg) {
  return msg
    .replace(/\s*\n\s*/g, ' ')
    .replace(/--[a-z-]+/g, (f) => CONTROL_NAMES[f] ? `\u201c${CONTROL_NAMES[f]}\u201d` : f)
    .replace(/\(smaller \u201cthe target size\u201d, or drop \u201cDither\u201d\)/, '(a smaller size, or no dithering)')
    .replace(/, or drop \u201cTile map\u201d and place the tiles yourself\./,
             ', or turn \u201cTile map\u201d off and place the tiles yourself.');
}

function showError(msg) {
  const el = $('error');
  el.hidden = !msg;
  el.textContent = msg ? humanize(msg) : '';
}

// ── wiring ─────────────────────────────────────────────────

$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));

async function loadExample() {
  const res = await fetch('./sample.png');
  await loadFile(new File([await res.blob()], 'example.png', { type: 'image/png' }));
}
$('try-example').onclick = loadExample;
if (new URLSearchParams(location.search).has('demo')) loadExample();

const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); });
}
for (const ev of ['dragleave', 'drop']) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); });
}
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
});

$('opts').addEventListener('input', () => { syncForm(); schedule(); });
$('opts').addEventListener('change', () => { syncForm(); schedule(); });

$('preset-screen').onclick = () => {
  $('qw').value = 160; $('qh').value = 144;
  schedule();
};

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('is-active', t === tab);
    state.view = tab.dataset.view;
    if (state.out) render();
  };
}

const setZoom = (z) => {
  state.zoom = Math.min(8, Math.max(1, z));
  $('zoom-label').textContent = state.zoom + '×';
  if (state.out) render();
};
$('zoom-in').onclick = () => setZoom(state.zoom + 1);
$('zoom-out').onclick = () => setZoom(state.zoom - 1);

syncForm();
