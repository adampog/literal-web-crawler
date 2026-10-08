const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function qmlFunction(file, signature, context) {
  const source = fs.readFileSync(path.join(__dirname,"..",file),"utf8");
  const start = source.indexOf(signature);
  assert.ok(start >= 0,signature);
  let end = source.indexOf("{",start), depth = 1;
  while (depth && ++end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
  }
  return vm.runInNewContext("(" + source.slice(start,end+1) + ")",context);
}

test("inline own-entry marking selects arch and malformed or missing settings fall back", () => {
  const root = { pluginId: "io.github.adampog.literal-web-crawler", marking: "hourglass" };
  const load = qmlFunction("Crawler.qml", "function loadMarking(raw)", { root, JSON, Array });
  for (const [raw, expected] of [
    [JSON.stringify({ version: 1, plugins: [{ id: root.pluginId, marking: "arch" }] }), "arch"],
    [JSON.stringify({ version: 1, plugins: [{ id: "other", marking: "arch" }, { id: root.pluginId }] }), "hourglass"],
    [JSON.stringify({ version: 1, plugins: [{ id: root.pluginId, marking: "hourglass" }] }), "hourglass"],
    [JSON.stringify({ version: 1, plugins: [{ id: root.pluginId, marking: "unknown" }] }), "hourglass"],
    [JSON.stringify({ version: 2, plugins: [{ id: root.pluginId, marking: "arch" }] }), "hourglass"],
    ['{"version":1,"plugins":{}}', "hourglass"], ['{"version":1}', "hourglass"],
    ['{"version":1,"plugins":[', "hourglass"], ["null", "hourglass"], ["broken", "hourglass"], ["", "hourglass"]
  ]) {
    root.marking = "arch";
    load(raw);
    assert.equal(root.marking, expected, raw);
    const screenSource = fs.readFileSync(path.join(__dirname, "..", "CrawlerScreen.qml"), "utf8");
    const themeExpression = screenSource.match(/readonly property var theme: \((\{[\s\S]*?\})\)/)[1];
    const theme = vm.runInNewContext("(" + themeExpression + ")", {
      win: { host: root }, Color: { foreground: "#fff", background: "#000", accent: "#f0f" },
      Core: { CRAWLER_PALETTE: ["#0ff"] }
    });
    assert.equal(theme.abdomenMark, expected, "screen forwards the selected setting to drawSpider");
  }
});

test("hot-plug article setup waits for a Canvas context instead of throwing", () => {
  const win = {host:{searchMode:true,article:{}},width:3440,height:1440,repair() {}};
  const prepare = qmlFunction("CrawlerScreen.qml","function prepareArticle()",{win,articleCanvas:{getContext() { return null; }}});
  assert.doesNotThrow(() => prepare());
  assert.equal(win.articlePending,true,"setup must retry when the canvas becomes available");
});

test("idle service neither summons nor owns an already-open overlay", () => {
  let summoned = 0;
  const root = {showing:false,pluginId:"crawler",shell:{isPluginOpen() { return true; },summon() { summoned++; return true; }}};
  const exited = qmlFunction("Service.qml","function(exitCode)",{root,idle:{isIdle:true},JSON});
  exited(0);
  assert.equal(summoned,0);
  assert.equal(root.showing,false,"next input must not hide an interactive overlay");
  root.shell.isPluginOpen = () => false;
  exited(0);
  assert.equal(summoned,1);
  assert.equal(root.showing,true,"idle service owns the screensaver it summons");
});
