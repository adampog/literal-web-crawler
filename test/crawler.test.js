const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const core = loadCore("crawler.js");

/** A host with a foothold every 20px and a chunk per 100px tile, for testing. */
function gridHost() {
  const chunks = new Map();
  const removed = [];
  return {
    removed,
    footholdNear(x, y, r) {
      const gx = Math.round(x / 20) * 20;
      const gy = Math.round(y / 20) * 20;
      if (Math.hypot(gx - x, gy - y) > r) return null;
      const key = Math.floor(gx / 100) + "," + Math.floor(gy / 100);
      if (!chunks.has(key)) {
        chunks.set(key, { gone: false, x: Math.floor(gx / 100) * 100, y: Math.floor(gy / 100) * 100 });
      }
      return { x: gx, y: gy, chunk: chunks.get(key) };
    },
    tearOff(chunk) {
      chunk.gone = true;
      return { x: chunk.x, y: chunk.y, w: 60, h: 16, visual: { id: Math.random() } };
    },
    bounds() {
      return { left: 0, top: 0, right: 1200, bottom: 800 };
    },
    removePiece(p) {
      removed.push(p);
    }
  };
}

function run(spider, seconds, dt = 1 / 60, each) {
  for (let t = 0; t < seconds; t += dt) {
    spider.step(dt);
    if (each) each(spider);
  }
}

test("walks to a point it is sent to, then resumes roaming", () => {
  const spider = core.createCrawler(gridHost());
  spider.placeAt(200, 200);
  spider.sendTo(700, 500);
  let closest = Infinity;
  run(spider, 8, 1 / 60, (s) => {
    closest = Math.min(closest, Math.hypot(s.x - 700, s.y - 500));
  });
  assert.ok(closest < 15, `got no closer than ${closest.toFixed(1)}px`);
  assert.equal(spider.tap, null, "the one-off destination should be cleared on arrival");
});

test("feet stay within reach of the body while walking", () => {
  const spider = core.createCrawler(gridHost());
  spider.placeAt(300, 300);
  spider.sendTo(900, 600);
  run(spider, 4, 1 / 60, (s) => {
    for (const f of s.feet) {
      assert.ok(Math.hypot(f.x - s.x, f.y - s.y) < s.reach() * 2.6, "a foot drifted away from the body");
    }
  });
});

test("alternating tetrapod gait: the two leg groups never swing together", () => {
  const spider = core.createCrawler(gridHost());
  spider.placeAt(100, 100);
  spider.sendTo(1000, 700);
  let steps = 0;
  run(spider, 5, 1 / 60, (s) => {
    const swinging = [0, 0];
    for (const f of s.feet) if (f.swing) swinging[f.group]++;
    assert.ok(!(swinging[0] && swinging[1]), "both groups in the air");
    steps += swinging[0] + swinging[1];
  });
  assert.ok(steps > 0, "never stepped");
});

test("tears pieces off, carries them, then lets them fade away", () => {
  const host = gridHost();
  const spider = core.createCrawler(host);
  spider.ripRate = 1;
  spider.placeAt(200, 200);
  spider.sendTo(1000, 600);
  run(spider, 4);
  assert.ok(spider.torn > 0, "nothing was torn off");
  spider.ripRate = 0;
  spider.sendTo(spider.x, spider.y);
  run(spider, 12);
  assert.equal(spider.pieces.length, 0, "pieces should have faded out");
  assert.equal(host.removed.length, spider.torn);
  for (const p of host.removed) assert.ok(p.visual, "host visual handed back");
});

test("rip rate 0 never tears anything", () => {
  const spider = core.createCrawler(gridHost());
  spider.ripRate = 0;
  spider.placeAt(200, 200);
  spider.sendTo(1000, 600);
  run(spider, 5);
  assert.equal(spider.torn, 0);
});

test("roams inside the host bounds", () => {
  const spider = core.createCrawler(gridHost());
  spider.placeAt(600, 400);
  run(spider, 20, 1 / 30, (s) => {
    assert.ok(s.x > -30 && s.x < 1230 && s.y > -30 && s.y < 830, `left the bounds at ${s.x}, ${s.y}`);
  });
});

test("clearPieces forgets every piece and carried piece", () => {
  const spider = core.createCrawler(gridHost());
  spider.ripRate = 1;
  spider.placeAt(200, 200);
  spider.sendTo(900, 600);
  run(spider, 2);
  spider.clearPieces();
  assert.equal(spider.pieces.length, 0);
  assert.equal(spider.torn, 0);
  assert.ok(spider.feet.every((f) => f.carry === null));
});

test("drawSpider only uses canvas calls QML's Context2D also has", () => {
  const spider = core.createCrawler(gridHost());
  spider.placeAt(300, 300);
  const allowed = new Set([
    "beginPath", "moveTo", "lineTo", "arc", "stroke", "fill", "save", "restore", "translate", "rotate", "scale"
  ]);
  const used = new Set();
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        used.add(prop);
        for (const a of args) assert.ok(Number.isFinite(a), `${String(prop)} got ${a}`);
      };
    }
  });
  core.drawSpider(ctx, spider, { ink: "#fff", fill: "#000", accent: "#f0f", legs: ["#0ff", "#f0f", "#90f", "#fa0"] });
  for (const name of used) assert.ok(allowed.has(name), `uses ${name}`);
  assert.ok(used.has("arc") && used.has("lineTo"));
});
