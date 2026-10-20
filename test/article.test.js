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
    parse,
    request() {
      const req = {headers:{}, open(...args) { this.args = args; }, setRequestHeader(k,v) { this.headers[k] = v; }, send() {}, abort() { this.aborted = true; }};
      requests.push(req);
      return req;
    },
    startTimer(fn) { timer = fn; }, stopTimer() { timer = null; },
    changed(state) { states.push(state); }
  });
  return {client,requests,states,timeout() { timer(); }, finish(status, text) {
    const req = requests.at(-1); req.status = status; req.responseText = text; req.readyState = 4; req.onreadystatechange();
  }};
}

test("one asynchronous identified REST request per search, no parallel or automatic retry", () => {
  const h = harness();
  assert.equal(h.client.search(" Earth "), true);
  assert.equal(h.client.search("Mars"), false);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(Array.from(h.requests[0].args), ["GET", "https://en.wikipedia.org/w/rest.php/v1/page/Earth/with_html", true]);
  assert.match(h.requests[0].headers["User-Agent"], /LiteralWebCrawler.*github.com\/adampog/);
  h.finish(200, response());
  assert.equal(h.states.at(-1).article.title, "Earth");
  assert.equal(h.states.at(-1).busy, false);
  assert.equal(h.requests.length, 1);
});

test("worker parsing is asynchronous and late results are fenced after close", () => {
  let callback;
  const h = harness((body, done) => { callback = done; });
  h.client.search("Earth"); h.finish(200,response());
  assert.equal(h.states.at(-1).busy,true,"main thread parsed the article synchronously");
  h.client.cancel();
  callback(core.parseArticle(response()),"");
  assert.equal(h.states.at(-1).article,null);
});

test("failed replacement searches keep the previous article, including 404 and offline", () => {
  for (const failure of [h => h.finish(404,""), h => h.finish(0,""),
    h => h.finish(200,"bad JSON"), h => h.timeout()]) {
    const h = harness();
    h.client.search("Earth"); h.finish(200,response());
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
  h.client.search("Earth"); h.finish(200,response());
  const previous = h.states.at(-1).article;
  h.client.search("Mars"); h.client.cancel(true);
  assert.equal(h.requests.at(-1).aborted,true);
  h.finish(200,response().replaceAll("Earth","Mars"));
  assert.equal(h.states.at(-1).article,previous);
  assert.equal(h.states.at(-1).busy,false);
  h.client.cancel();
  assert.equal(h.states.at(-1).article,null,"closing clears the session");
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

test("offline, missing, disambiguation, malformed and oversized responses fail plainly", () => {
  for (const [status, body, message] of [
    [0,"",/offline|connection/i], [404,"",/not found/i], [429,"",/Wikipedia.*429/],
    [200,response('<meta property="mw:PageProp/disambiguation"/><p>Choose a topic</p>'),/specific/i],
    [200,"not json",/read/i], [200,"x".repeat(4000001),/large/i]
  ]) {
    const h = harness(); h.client.search("Earth"); h.finish(status,body);
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
    h.finish(200,response());
    assert.equal(h.states.at(-1).article,null);
    assert.equal(h.states.at(-1).busy,false);
    h.client.search("Mars");
    old.readyState = 4; old.onreadystatechange();
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
