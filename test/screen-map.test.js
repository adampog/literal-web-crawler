const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const core = loadCore("screen-map.js");

/**
 * A fake 200x100 sample screenshot: dark background with one bright "word"
 * spanning x 40-90, y 30-40, made of vertical strokes like letters.
 */
function fakeScreen() {
  const sw = 200;
  const sh = 100;
  const pixels = new Uint8Array(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const ink = x >= 40 && x <= 90 && y >= 30 && y <= 40 && x % 3 !== 0;
      const o = (y * sw + x) * 4;
      pixels[o] = pixels[o + 1] = pixels[o + 2] = ink ? 240 : 20;
      pixels[o + 3] = 255;
    }
  }
  return { pixels, sw, sh };
}

test("finds footholds on the text and none on empty background", () => {
  const { pixels, sw, sh } = fakeScreen();
  const map = core.buildScreenMap(pixels, sw, sh, 1);
  assert.ok(core.screenFoothold(map, 65, 35, 30), "no foothold on the word");
  assert.equal(core.screenFoothold(map, 160, 80, 20), null, "foothold on blank background");
});

test("chunks cover the word around a foothold", () => {
  const { pixels, sw, sh } = fakeScreen();
  const map = core.buildScreenMap(pixels, sw, sh, 1);
  const chunk = core.screenChunkAt(map, 65, 35);
  assert.ok(chunk.x <= 42 && chunk.x + chunk.w >= 88, `x span ${chunk.x}..${chunk.x + chunk.w}`);
  assert.ok(chunk.y <= 31 && chunk.y + chunk.h >= 39, `y span ${chunk.y}..${chunk.y + chunk.h}`);
  assert.ok(chunk.h < 30, "chunk grew too tall");
});

test("scale converts samples to logical pixels", () => {
  const { pixels, sw, sh } = fakeScreen();
  const map = core.buildScreenMap(pixels, sw, sh, 3);
  const hold = core.screenFoothold(map, 65 * 3, 35 * 3, 60);
  assert.ok(hold && hold.x > 40 * 3 && hold.x < 91 * 3, "foothold not scaled");
});

test("two feet on one word share a chunk, and holes stop being footholds", () => {
  const { pixels, sw, sh } = fakeScreen();
  const map = core.buildScreenMap(pixels, sw, sh, 1);
  const a = core.screenChunkAt(map, 50, 35);
  const b = core.screenChunkAt(map, 80, 35);
  assert.equal(a, b);
  a.gone = true;
  for (let i = 0; i < 20; i++) {
    const hold = core.screenFoothold(map, 65, 35, 30);
    if (hold) {
      const inside = hold.x >= a.x && hold.x <= a.x + a.w && hold.y >= a.y && hold.y <= a.y + a.h;
      assert.ok(!inside, "foothold inside a torn hole");
    }
  }
});
