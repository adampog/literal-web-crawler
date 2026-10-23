const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");
const core = loadCore("article.js");

function response(html = "<p>Earth is a planet. Earth has water.</p>") {
  return JSON.stringify({title:"Earth", key:"Earth", latest:{id:123}, license:{title:"CC BY-SA 4.0"}, html});
}

function harness(parse) {
  const requests = [];
  const states = [];
  let timer = null;
  const client = core.createArticleClient({
    request(command, complete) {
      const req = {command, complete, aborted:false, abort() { this.aborted = true; }};
      requests.push(req);
      return req;
    },
    parse,
    startTimer(fn) { timer = fn; }, stopTimer() { timer = null; },
    changed(state) { states.push(state); }
  });
  return {client,requests,states,timeout() { timer(); },finish(exitCode, body = "", status = 200) {
    requests.at(-1).complete(exitCode,body + "\n" + String(status).padStart(3,"0") + " " + String(Buffer.byteLength(body)));
  }};
}

test("curl argv caps the direct HTTPS request without a shell or compression", () => {
  const h = harness();
  h.client.search("Earth & Moon");
  const args = h.requests[0].command;
  assert.equal(args[0],"curl");
  assert.equal(args[1],"--disable","do not allow curl configuration files to change the argv policy");
  assert.ok(args.includes("--max-filesize") && args[args.indexOf("--max-filesize") + 1] === "4000000");
  assert.ok(args.includes("--max-time") && args[args.indexOf("--max-time") + 1] === "12");
  assert.ok(args.includes("--proto") && args[args.indexOf("--proto") + 1] === "=https");
  assert.ok(args.includes("--proto-redir") && args[args.indexOf("--proto-redir") + 1] === "=https");
  assert.ok(args.includes("--location") && args.includes("--max-redirs"));
  assert.ok(!args.includes("--compressed"));
  assert.ok(args.at(-1).endsWith("/Earth_%26_Moon/with_html"));
  assert.equal(args.includes("bash"),false);
  assert.ok(args.includes("--header") && args[args.indexOf("--header") + 1] === "Accept: application/json");
  assert.match(args[args.indexOf("--user-agent") + 1],/LiteralWebCrawler.*github.com\/adampog/);
});

test("curl outcomes map to existing messages and preserve the previous article", () => {
  const h = harness();
  h.client.search("Earth");
  h.finish(0,response());
  const previous = h.states.at(-1).article;
  for (const [exitCode,status,message] of [
    [63,200,/too large/i], [28,0,/too long/i], [22,404,/not found/i],
    [22,503,/Wikipedia returned 503/], [7,0,/offline|connect/i]
  ]) {
    h.client.search("Mars");
    h.finish(exitCode,"",status);
    assert.match(h.states.at(-1).message,message);
    assert.equal(h.states.at(-1).article,previous);
    assert.equal(h.states.at(-1).busy,false);
  }
});

test("curl cancellation aborts and ignores a late process result", () => {
  const h = harness();
  h.client.search("Earth");
  const req = h.requests[0];
  h.client.cancel(true);
  assert.equal(req.aborted,true);
  const afterCancel = h.states.at(-1);
  h.finish(0,response());
  assert.equal(h.states.at(-1),afterCancel);
});

test("one identified REST request per search, no parallel or automatic retry", () => {
  const h = harness();
  assert.equal(h.client.search(" Earth "), true);
  assert.equal(h.client.search("Mars"), false);
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].command.at(-1).endsWith("/Earth/with_html"));
  h.finish(0,response());
  assert.equal(h.states.at(-1).article.title, "Earth");
  assert.equal(h.states.at(-1).busy, false);
  assert.equal(h.requests.length, 1);
});

test("worker parsing is asynchronous and late results are fenced after close", () => {
  let callback;
  const h = harness((body, done) => { callback = done; });
  h.client.search("Earth"); h.finish(0,response());
  assert.equal(h.states.at(-1).busy,true,"main thread parsed the article synchronously");
  h.client.cancel();
  callback(core.parseArticle(response()),"");
  assert.equal(h.states.at(-1).article,null);
});

test("failed replacement searches keep the previous article", () => {
  for (const failure of [h => h.finish(22,"",404), h => h.finish(7,"",0),
    h => h.finish(0,"bad JSON"), h => h.timeout()]) {
    const h = harness();
    h.client.search("Earth"); h.finish(0,response());
    const previous = h.states.at(-1).article;
    h.client.search("Missing");
    assert.equal(h.states.at(-1).article,previous,"loading preserves the page");
    failure(h);
    assert.equal(h.states.at(-1).article,previous);
    assert.equal(h.states.at(-1).busy,false);
    assert.ok(h.states.at(-1).message);
    h.client.search("");
    assert.equal(h.states.at(-1).article,previous,"invalid input preserves the page");
  }
});

test("canceling a replacement search keeps the article and fences late responses", () => {
  const h = harness();
  h.client.search("Earth"); h.finish(0,response());
  const previous = h.states.at(-1).article;
  h.client.search("Mars"); h.client.cancel(true);
  assert.equal(h.requests.at(-1).aborted,true);
  h.finish(0,response().replaceAll("Earth","Mars"));
  assert.equal(h.states.at(-1).article,previous);
  assert.equal(h.states.at(-1).busy,false);
  h.client.cancel();
  assert.equal(h.states.at(-1).article,null,"closing clears the session");
});

test("parseArticle keeps the same UTF-8 ceiling behind curl", () => {
  assert.throws(() => core.parseArticle(response("<p>" + "é".repeat(2000001) + "</p>")),/too large/i,
    "the completed-response parser uses the same UTF-8 byte ceiling");
});

test("article layout yields between bounded batches and preserves the full layout", () => {
  const article = core.parseArticle(response("<p>" + "Earth water planet. ".repeat(200) + "</p>"));
  const job = core.createArticleLayout(article,"earth",1000,600,w => w.length * 10);
  assert.equal(job.advance(50),false);
  let batches = 1;
  while (!job.advance(50)) batches++;
  assert.ok(batches > 5);
  assert.deepEqual(JSON.parse(JSON.stringify(job.result)),JSON.parse(JSON.stringify(core.layoutArticle(article,"earth",1000,600,w => w.length * 10))));
});

test("worker returns a bounded excerpt with license attribution and reports parse failures", () => {
  const result = core.parseArticleMessage({id:7,body:response("<p>" + "Earth ".repeat(40000) + "</p>")});
  assert.equal(result.id,7);
  assert.equal(result.article.text.length,200000);
  assert.equal(result.article.truncated,true);
  assert.equal(result.article.license,"CC BY-SA 4.0");
  assert.equal(result.article.licenseUrl,"https://creativecommons.org/licenses/by-sa/4.0/");
  assert.equal(core.parseArticleMessage({id:8,body:"bad"}).article,null);
});

test("missing, disambiguation, malformed and oversized responses fail plainly", () => {
  for (const [exitCode, status, body, message] of [
    [22,429,"",/Wikipedia.*429/],
    [0,200,response('<meta property="mw:PageProp/disambiguation"/><p>Choose a topic</p>'),/specific/i],
    [0,200,"not json",/read/i], [63,200,"",/large/i]
  ]) {
    const h = harness(); h.client.search("Earth"); h.finish(exitCode,body,status);
    assert.match(h.states.at(-1).message,message);
    assert.equal(h.states.at(-1).busy,false);
    assert.equal(h.states.at(-1).article,null);
    assert.equal(h.requests.length,1);
  }
});

test("timeout and close abort; late callbacks cannot revive an old article", () => {
  for (const reason of ["timeout", "cancel"]) {
    const h = harness(); h.client.search("Earth");
    const old = h.requests[0];
    if (reason === "timeout") h.timeout(); else h.client.cancel();
    assert.equal(old.aborted,true);
    h.finish(0,response());
    assert.equal(h.states.at(-1).article,null);
    assert.equal(h.states.at(-1).busy,false);
    h.client.search("Mars");
    old.complete(0,response() + "\n200 " + String(Buffer.byteLength(response())));
    assert.equal(h.states.at(-1).busy,true);
  }
});

test("article text is inert, excludes embedded content and decodes text entities", () => {
  const a = core.parseArticle(response('<head>hidden</head><script>bad()</script><style>bad</style><p>Earth &amp; water &#x1f30d;.</p><table><tr><td>box</td></tr></table><p>Second paragraph.</p>'));
  assert.equal(a.text,"Earth & water 🌍.\nSecond paragraph.");
  assert.match(a.url,/Earth$/);
  const metadata = `<table data-mw='{"template":"<ref>private</ref>"}'><tr><td>hidden box</td></tr></table><!-- > hidden --><p>Visible text.</p>`;
  assert.equal(core.parseArticle(response(metadata)).text,"Visible text.");
  assert.throws(() => core.parseArticle(response("<".repeat(500000))), /no readable text/);
});

test("layout wraps and paginates bounded words with whole search-token matching", () => {
  const article = core.parseArticle(response('<p>Earth earthling earth, WATER water. ' + 'planet '.repeat(100) + '</p>'));
  const map = core.layoutArticle(article,"earth water",320,240,(word) => word.length * 10);
  assert.ok(map.pages.length > 1);
  assert.equal(map.pages[0].filter(w => w.match).length,4);
  for (const page of map.pages) {for (const w of page) {
    assert.ok(w.x >= 24 && w.x + w.w <= 296);
    assert.ok(w.y >= 110 && w.y + w.h <= 184);
  }}
});

test("matching footholds win locally, matching tears win on page, repair restores words", () => {
  const article = core.parseArticle(response("<p>planet Earth planet</p>"));
  const map = core.layoutArticle(article,"earth",600,400,w => w.length * 10);
  const page = map.pages[0]; const match = page.find(w => w.match); const other = page.find(w => !w.match);
  assert.equal(core.articleFoothold(map,0,other.x,other.y,200).chunk,match);
  assert.equal(core.articleCanTear(map,0,other),false);
  assert.equal(core.articleCanTear(map,0,match),true);
  match.gone = true;
  assert.equal(core.articleCanTear(map,0,other),true);
  assert.notEqual(core.articleFoothold(map,0,other.x,other.y,200).chunk,match);
  core.repairArticle(map);
  assert.equal(match.gone,false);
});

test("real engine seeks term words and tears them before other words", () => {
  const engine = loadCore("crawler.js", "article.js");
  const article = engine.parseArticle(response("<p>" + "Earth is a planet with water. ".repeat(40) + "</p>"));
  const map = engine.layoutArticle(article,"earth",1000,600,w => w.length * 10);
  const torn = [];
  const host = {
    bounds() { return {left:0,top:100,right:1000,bottom:544}; },
    footholdNear(x,y,r) { return engine.articleFoothold(map,0,x,y,r); },
    roamTarget(x,y,r) { return engine.articleTarget(map,0,x,y,r); },
    tearOff(chunk) {
      if (!engine.articleCanTear(map,0,chunk)) return null;
      chunk.gone = true; torn.push(chunk);
      return {x:chunk.x,y:chunk.y,w:chunk.w,h:chunk.h,visual:{}};
    },
    removePiece() {}
  };
  const spider = engine.createCrawler(host);
  spider.size = 0.7; spider.ripRate = 1; spider.placeAt(500,300);
  for (let frame = 0; frame < 1800; frame++) spider.step(1/30);
  assert.ok(torn.length > 0,"no article word was torn");
  assert.ok(torn[0].match,"a nonmatching word was torn first");
  const firstOther = torn.findIndex(w => !w.match);
  if (firstOther >= 0) assert.ok(map.pages[0].filter(w => w.match).every(w => w.gone));
});
