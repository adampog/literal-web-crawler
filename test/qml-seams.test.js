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
