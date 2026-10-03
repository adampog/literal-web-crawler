/*
 * Literal Web Crawler: footholds from a screenshot.
 *
 * The Omarchy plugin has no DOM to walk on, only pixels. This file turns a
 * downscaled screenshot into the two things the spider engine asks a host for:
 *
 *   - footholds: points on high-contrast edges, which on a desktop are
 *     mostly text, icons and window borders;
 *   - chunks: a word-sized rectangle of "ink" around a foothold, which is
 *     what a foot tears off.
 *
 * Plain JS with no QML types, so it can be linted and tested like the rest.
 */
/* exported buildScreenMap, screenFoothold, screenChunkAt */

/** Luminance difference that counts as an edge (0-255 scale, summed over x and y). */
var EDGE_THRESHOLD = 46;
/** Spatial hash cell size in logical pixels, and the most footholds kept per cell. */
var MAP_CELL = 48;
var MAX_PER_CELL = 18;

/**
 * Analyse an RGBA pixel array of a sw x sh downscaled screenshot.
 * `scale` is how many logical pixels one sample covers.
 */
function buildScreenMap(pixels, sw, sh, scale) {
  var count = sw * sh;
  var lum = new Float32Array(count);
  var i;
  for (i = 0; i < count; i++) {
    var o = i * 4;
    lum[i] = 0.299 * pixels[o] + 0.587 * pixels[o + 1] + 0.114 * pixels[o + 2];
  }

  var edge = new Uint8Array(count);
  var grid = {};
  var perCell = {};
  for (var y = 1; y < sh - 1; y++) {
    for (var x = 1; x < sw - 1; x++) {
      i = y * sw + x;
      var g = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + sw] - lum[i - sw]);
      if (g < EDGE_THRESHOLD) continue;
      edge[i] = 1;

      // Keep a capped, spread-out sample of edge points as footholds.
      var lx = (x + 0.5) * scale;
      var ly = (y + 0.5) * scale;
      var key = Math.floor(lx / MAP_CELL) + "," + Math.floor(ly / MAP_CELL);
      var n = perCell[key] || 0;
      if (n >= MAX_PER_CELL) continue;
      // Skip some points at random so a dense cell is not just its top rows.
      if (n > 4 && Math.random() < 0.6) continue;
      perCell[key] = n + 1;
      (grid[key] || (grid[key] = [])).push({ x: lx, y: ly });
    }
  }

  return { sw: sw, sh: sh, scale: scale, edge: edge, grid: grid, chunks: [] };
}

/** True when a torn-off chunk covers (x, y): that spot is now a hole. */
function inHole(map, x, y) {
  for (var k = 0; k < map.chunks.length; k++) {
    var ch = map.chunks[k];
    if (ch.gone && x >= ch.x && x <= ch.x + ch.w && y >= ch.y && y <= ch.y + ch.h) return true;
  }
  return false;
}

/** Does any edge sample sit in column sx between rows y0 and y1? */
function columnInked(map, sx, y0, y1) {
  for (var y = y0; y <= y1; y++) if (map.edge[y * map.sw + sx]) return true;
  return false;
}

/** Does any edge sample sit in row sy between columns x0 and x1? */
function rowInked(map, sy, x0, x1) {
  var base = sy * map.sw;
  for (var x = x0; x <= x1; x++) if (map.edge[base + x]) return true;
  return false;
}

/**
 * The word-sized chunk of ink around (x, y), in logical pixels.
 * Reuses a chunk already found there so two feet on one word share it.
 */
function screenChunkAt(map, x, y) {
  var k;
  for (k = 0; k < map.chunks.length; k++) {
    var ch = map.chunks[k];
    if (!ch.gone && x >= ch.x && x <= ch.x + ch.w && y >= ch.y && y <= ch.y + ch.h) return ch;
  }

  var s = map.scale;
  var sx = Math.max(1, Math.min(map.sw - 2, Math.floor(x / s)));
  var sy = Math.max(1, Math.min(map.sh - 2, Math.floor(y / s)));
  var gap = Math.max(2, Math.ceil(9 / s)); // a gap this wide ends a word
  var maxW = Math.ceil(260 / s);
  var maxH = Math.ceil(34 / s);
  var y0 = Math.max(0, sy - 1);
  var y1 = Math.min(map.sh - 1, sy + 1);

  // Walk left and right along the text line until a word gap.
  var left = sx;
  var miss = 0;
  while (left > 0 && sx - left < maxW) {
    if (columnInked(map, left - 1, y0, y1)) miss = 0;
    else if (++miss > gap) break;
    left--;
  }
  left += miss;
  var right = sx;
  miss = 0;
  while (right < map.sw - 1 && right - sx < maxW) {
    if (columnInked(map, right + 1, y0, y1)) miss = 0;
    else if (++miss > gap) break;
    right++;
  }
  right -= miss;

  // Then grow up and down while rows still have ink in that span.
  var top = sy;
  while (top > 0 && sy - top < maxH && rowInked(map, top - 1, left, right)) top--;
  var bottom = sy;
  while (bottom < map.sh - 1 && bottom - top < maxH && rowInked(map, bottom + 1, left, right)) bottom++;

  var pad = 2;
  var chunk = {
    x: left * s - pad,
    y: top * s - pad,
    w: (right - left + 1) * s + pad * 2,
    h: (bottom - top + 1) * s + pad * 2,
    gone: false
  };
  // Too small to read as a piece of anything: tear a small square instead.
  if (chunk.w < 14) { chunk.x = x - 9; chunk.w = 18; }
  if (chunk.h < 10) { chunk.y = y - 7; chunk.h = 14; }
  map.chunks.push(chunk);
  return chunk;
}

/** Nearest foothold to (x, y) within radius r that is not in a hole, with its chunk. */
function screenFoothold(map, x, y, r) {
  var best = null;
  var bestD = Infinity;
  var x0 = Math.floor((x - r) / MAP_CELL);
  var x1 = Math.floor((x + r) / MAP_CELL);
  var y0 = Math.floor((y - r) / MAP_CELL);
  var y1 = Math.floor((y + r) / MAP_CELL);
  for (var cx = x0; cx <= x1; cx++) {
    for (var cy = y0; cy <= y1; cy++) {
      var list = map.grid[cx + "," + cy];
      if (!list) continue;
      for (var k = 0; k < list.length; k++) {
        var p = list[k];
        var d = Math.hypot(p.x - x, p.y - y);
        if (d > r) continue;
        d += Math.random() * 14; // a little randomness keeps the gait organic
        if (d < bestD && !inHole(map, p.x, p.y)) {
          bestD = d;
          best = p;
        }
      }
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, chunk: screenChunkAt(map, best.x, best.y) };
}
