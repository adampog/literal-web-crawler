const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

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

test("closing during capture fences late exits and serializes cleanup before reopening", () => {
  for (const code of [0,1,127]) {
    const root = {opened:false,capturing:false,parseId:0,captureDir:"/private/crawler",captureScript:"capture"};
    const capture = {running:false}, cleanup = {running:false};
    const notifications = [];
    const context = {root,capture,cleanup,JSON,Date,Quickshell:{screens:[{name:"test"}],execDetached(args) { notifications.push(args); }}};
    const open = qmlFunction("Crawler.qml","function open(payloadJson)",context);
    const close = qmlFunction("Crawler.qml","function close()",context);
    const exit = qmlFunction("Crawler.qml","function(exitCode)",context);
    open("{}");
    assert.equal(root.capturing,true);
    close();
    assert.equal(cleanup.running,false,"do not remove files while grim writes");
    assert.equal(root.capturing,false);
    open("{}");
    assert.equal(root.capturing,false,"old capture must drain first");
    capture.running = false; exit(code);
    assert.equal(root.opened,false);
    assert.equal(cleanup.running,true);
    assert.equal(notifications.length,0,"canceled errors must not notify");
    open("{}");
    assert.equal(root.capturing,false,"cleanup must finish before a new capture");
    cleanup.running = false; open("{}");
    capture.running = false; exit(0);
    assert.equal(root.opened,true,"a later open still works");
    assert.equal(root.capturing,false);
  }
});

test("article state keeps search prompt visible while loading or failed; Esc cancels only the search", () => {
  const root = {articleClient:null,searchPrompt:true};
  let changed;
  const submit = qmlFunction("Crawler.qml","function submitSearch(term)",{
    root,Article:{createArticleClient(adapters) { changed = adapters.changed; return {search() {}}; }}
  });
  submit("Earth");
  for (const state of [{busy:true,message:"Loading",article:{}},{busy:false,message:"Not found",article:{}}]) {
    changed(state); assert.equal(root.searchPrompt,true);
  }
  changed({busy:false,message:"",article:{}});
  assert.equal(root.searchPrompt,false);
  let canceled = false, dismissed = false;
  root.searchPrompt = true;
  root.articleClient = {cancel(keep) { canceled = keep; }};
  root.dismiss = () => { dismissed = true; };
  const escape = qmlFunction("CrawlerScreen.qml","function(event) {\n          if (win.host.article)",{win:{host:root}});
  const event = {};
  escape(event);
  assert.equal(canceled,true);
  assert.equal(root.searchPrompt,false);
  assert.equal(event.accepted,true);
  assert.equal(dismissed,false);
});

test("missing runtime directory fails capture without a shared-folder fallback", () => {
  const source = fs.readFileSync(path.join(__dirname,"..","Crawler.qml"),"utf8");
  const expression = source.match(/readonly property string captureDir: (.*)/)[1];
  const dir = vm.runInNewContext(expression,{Quickshell:{env() { return ""; }}});
  assert.equal(dir,"");
  const script = vm.runInNewContext(source.match(/readonly property string captureScript: ([\s\S]*?\.join\("\\n"\))/)[1]);
  const result = spawnSync("/bin/bash",["-c",script,"crawler",dir,"stamp","test-monitor"],{env:{PATH:""},encoding:"utf8"});
  assert.equal(result.status,1);
  assert.equal(result.stderr,"");
  const cleanup = vm.runInNewContext(source.match(/command: (\["bash", "-c", "test[^\n]+\])/)[1],{root:{captureDir:dir}});
  const cleaned = spawnSync("/bin/bash",Array.from(cleanup).slice(1),{env:{PATH:""},encoding:"utf8"});
  assert.equal(cleaned.status,1);
  assert.equal(cleaned.stderr,"","cleanup must not run rm on an empty path");
});

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
