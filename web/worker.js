// Runs the conversion off the main thread: a dithered quantize takes seconds,
// which would otherwise freeze the page.
import init, { convert, Options } from './pkg/gb_image_fx_wasm.js';

const ready = init();

self.onmessage = async (e) => {
  const { id, rgba, width, height, opts } = e.data;
  await ready;

  let options, out;
  try {
    options = new Options();
    options.obj = opts.obj;
    options.dmg = opts.dmg;
    options.quantize_width = opts.quantizeWidth;
    options.quantize_height = opts.quantizeHeight;
    options.max_palettes = opts.maxPalettes;
    options.dither = opts.dither;
    options.dither_method = opts.ditherMethod;
    options.gbc_correction = opts.gbcCorrection;
    options.metasprite_width = opts.metaWidth;
    options.metasprite_height = opts.metaHeight;
    options.dedup = opts.dedup;
    options.flip = opts.flip;
    options.map = opts.map;
    options.preview = true;

    const started = performance.now();
    out = convert(rgba, width, height, options);

    // Each getter copies out of wasm memory, so read every field once.
    const result = {
      tiles: out.tiles,
      palettes: out.palettes,
      attributes: out.attributes,
      map: out.map,
      preview: out.preview,
      previewWidth: out.preview_width,
      previewHeight: out.preview_height,
      uniqueTiles: out.unique_tiles,
      totalTiles: out.total_tiles,
      paletteCount: out.palette_count,
      ms: Math.round(performance.now() - started),
    };

    const buffers = [result.tiles, result.palettes, result.attributes, result.map, result.preview]
      .filter((b) => b.byteLength > 0)
      .map((b) => b.buffer);
    self.postMessage({ id, ok: true, result }, buffers);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    out?.free();
    options?.free();
  }
};
