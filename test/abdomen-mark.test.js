const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");
const core = loadCore("crawler.js");

function trace(mark) {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]),
    set: (target, key, value) => { target[key] = value; calls.push([key, value]); return true; }
  });
  const spider = core.createCrawler({ footholdNear: () => null, bounds: () => ({ left: 0, top: 0, right: 3440, bottom: 1440 }) });
  spider.placeAt(500, 500);
  core.drawSpider(ctx, spider, { ink: "#fff", fill: "#000", accent: "#f0f", legs: core.CRAWLER_PALETTE, abdomenMark: mark });
  return calls;
}

test("Arch marking requires an explicit option; unknown options keep the hourglass", () => {
  assert.deepEqual(trace(), trace("hourglass"));
  assert.deepEqual(trace(), trace("unknown"));
  assert.deepEqual(trace(), trace("omarchy"));
  assert.notDeepEqual(trace(), trace("arch"));
  assert.notDeepEqual(trace("omarchy"), trace("arch"));
});
