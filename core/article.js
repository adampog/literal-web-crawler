/* eslint no-unused-vars: ["error", { "caughtErrorsIgnorePattern": "^ignored" }] */
/* Wikipedia REST transport and inert text layout. No DOM, processes or disk cache. */
/* global WorkerScript */
/* exported createArticleLayout, parseArticleMessage, createArticleClient, parseArticle, layoutArticle, articleFoothold, articleCanTear, repairArticle, articleTarget, drawArticle */

var ARTICLE_RESPONSE_BYTE_LIMIT = 4000000;

function countResponseBytes(text, start, complete) {
  var bytes = 0;
  var i = start || 0;
  for (; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      var next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i++; }
      else if (!complete && i + 1 === text.length) break;
      else bytes += 3;
    } else bytes += 3;
  }
  return {bytes:bytes, scanned:i};
}

function articleText(html) {
  var parts = [];
  var skipped = [];
  var cursor = 0;
  while (cursor < html.length) {
    var text;
    var end;
    if (html[cursor] === "<") {
      if (html.slice(cursor,cursor + 4) === "<!--") {
        end = html.indexOf("-->",cursor + 4);
        if (end < 0) break;
        cursor = end + 3;
        continue;
      }
      var quote = "";
      for (end = cursor + 1; end < html.length; end++) {
        var character = html[end];
        if (quote) { if (character === quote) quote = ""; }
        else if (character === '"' || character === "'") quote = character;
        else if (character === ">") break;
      }
      if (end >= html.length) break;
      text = html.slice(cursor,end + 1);
      cursor = end + 1;
    } else {
      end = html.indexOf("<",cursor);
      if (end < 0) end = html.length;
      text = html.slice(cursor,end);
      cursor = end;
    }
    if (text[0] === "<") {
      var tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(text);
      if (!tag) continue;
      var name = tag[2].toLowerCase();
      if (tag[1]) {
        if (skipped.length && skipped[skipped.length - 1] === name) skipped.pop();
        if (!skipped.length && /^(p|h[1-6]|li|div|section)$/.test(name)) parts.push("\n");
      } else if (/^(head|script|style|table|figure|nav|aside|math|sup)$/.test(name) && !/\/\s*>$/.test(text)) skipped.push(name);
      else if (!skipped.length && name === "br") parts.push("\n");
    } else if (!skipped.length) parts.push(text);
  }
  var entities = {amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",ndash:"–",mdash:"—",rsquo:"’",lsquo:"‘",ldquo:"“",rdquo:"”"};
  return parts.join("").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (whole, entity) {
    if (entity[0] !== "#") return entities[entity] || whole;
    var n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  }).split(/\n+/).map(function (line) { return line.replace(/\s+/g," ").trim(); }).filter(Boolean).join("\n");
}

function parseArticle(body) {
  if (typeof body !== "string" || countResponseBytes(body,0,true).bytes > ARTICLE_RESPONSE_BYTE_LIMIT) throw new Error("This article is too large. Try a narrower topic.");
  var data;
  try { data = JSON.parse(body); } catch (ignoredError) { throw new Error("Could not read Wikipedia's response."); }
  if (!data || typeof data.html !== "string" || typeof data.title !== "string") throw new Error("Could not read Wikipedia's article.");
  if (/mw:PageProp\/disambiguation/i.test(data.html) || /\(disambiguation\)$/i.test(data.title)) {
    throw new Error("This topic has several meanings. Enter a more specific article title.");
  }
  var text = articleText(data.html);
  if (!text) throw new Error("This article has no readable text. Try another title.");
  return {title:data.title, text:text, url:"https://en.wikipedia.org/wiki/" + encodeURIComponent(data.key || data.title),
    license:data.license && String(data.license.title || "CC BY-SA"),
    licenseUrl:data.license && String(data.license.url || "https://creativecommons.org/licenses/by-sa/4.0/"), revision:data.latest && data.latest.id};
}

/** Adapters supply an asynchronous XHR and a single 12-second QML timer. */
function createArticleClient(adapters) {
  var active = null;
  var state = {busy:false, article:null, term:"", message:"Enter a Wikipedia article title."};
  function publish() { adapters.changed(state); }
  function finish(req, article, message) {
    if (active !== req) return;
    active = null;
    adapters.stopTimer();
    state = {busy:false, article:article || state.article, term:state.term, message:message};
    publish();
  }
  return {
    search: function (input) {
      if (active) return false;
      var term = String(input || "").trim();
      if (!term || term.length > 160) {
        state = {busy:false, article:state.article, term:term, message:"Enter an article title (up to 160 characters)."};
        publish(); return false;
      }
      var req;
      try {
        req = adapters.request(); active = req;
        var responseScanned = 0;
        var responseBytes = 0;
        state = {busy:true, article:state.article, term:term, message:"Loading Wikipedia…"}; publish();
        req.onreadystatechange = function () {
          if (active !== req) return;
          if (req.readyState === 3) {
            var measured = countResponseBytes(req.responseText,responseScanned,false);
            responseScanned = measured.scanned;
            responseBytes += measured.bytes;
            if (responseBytes > ARTICLE_RESPONSE_BYTE_LIMIT) {
              finish(req,null,"This article is too large. Try a narrower topic.");
              try { req.abort(); } catch (ignoredAbort) { /* Request already ended. */ }
            }
            return;
          }
          if (req.readyState !== 4) return;
          if (req.status !== 200) {
            finish(req,null,req.status === 404 ? "Article not found. Try its exact Wikipedia title."
              : req.status === 0 ? "Could not connect to Wikipedia. You may be offline."
                : "Wikipedia returned " + req.status + ". Try again later.");
            return;
          }
          try {
            if (adapters.parse) {
              adapters.parse(req.responseText,function (article, message) { finish(req,article,message || ""); });
            } else finish(req,parseArticle(req.responseText),"");
          }
          catch (error) { finish(req,null,String(error.message || "Could not read Wikipedia's article.")); }
        };
        req.open("GET", "https://en.wikipedia.org/w/rest.php/v1/page/" + encodeURIComponent(term.replace(/ /g,"_")) + "/with_html", true);
        req.setRequestHeader("User-Agent", "LiteralWebCrawler/1.0 (https://github.com/adampog/literal-web-crawler)");
        req.setRequestHeader("Accept", "application/json");
        adapters.startTimer(function () {
          if (active !== req) return;
          finish(req,null,"Wikipedia took too long to respond. Try again.");
          try { req.abort(); } catch (ignoredAbort) { /* Already finished. */ }
        });
        req.send();
      } catch (ignoredError) {
        if (req) {
          finish(req,null,"Could not connect to Wikipedia. Try again.");
          try { req.abort(); } catch (ignoredAbort) { /* No live request. */ }
        } else {
          state = {busy:false, article:state.article, term:term, message:"Could not start the Wikipedia request."}; publish();
        }
      }
      return true;
    },
    cancel: function (keepArticle) {
      var req = active; active = null; adapters.stopTimer();
      if (req) { try { req.abort(); } catch (ignoredAbort) { /* No live request. */ } }
      state = {busy:false, article:keepArticle ? state.article : null, term:"", message:"Enter a Wikipedia article title."}; publish();
    }
  };
}

function termTokens(term) {
  return String(term).toLowerCase().match(/[a-z0-9\u00c0-\u02ff\u0370-\u1fff\u3040-\ud7ff]+/g) || [];
}

/** Layout is bounded to 10,000 words. Pages share word objects with the engine. */
function createArticleLayout(article, term, width, height, measure) {
  var pages = [[]];
  var grids = [{}];
  var tokens = termTokens(term);
  var x = 24;
  var y = 110;
  var lineHeight = 26;
  var right = Math.max(100,width - 24);
  var bottom = Math.max(136,height - 56);
  var words = article.text.match(/\S+|\n/g) || [];
  var count = 0;
  var page = 0;
  var truncated = !!article.truncated;
  var i = 0;
  var job = {result:null, advance:function (limit) {
  var stop = Math.min(words.length,i + Math.max(1,limit));
  for (; i < stop; i++) {
    var word = words[i];
    if (word === "\n") { x = 24; y += lineHeight; continue; }
    if (++count > 10000) { truncated = true; i = words.length; break; }
    var w = Math.min(right - 24,Math.max(1,measure(word)));
    if (x + w > right && x > 24) { x = 24; y += lineHeight; }
    if (y + 22 > bottom) { page++; pages.push([]); grids.push({}); x = 24; y = 110; }
    var normalized = termTokens(word);
    var match = normalized.some(function (t) { return tokens.indexOf(t) >= 0; });
    var chunk = {x:x,y:y,w:w,h:22,text:word,match:match,gone:false};
    pages[page].push(chunk);
    // Index the center and ends: long words can be gripped anywhere along them.
    for (var px = x; px <= x + w + 1; px += 16) {
      var point = {x:Math.min(x+w,px),y:y+11,chunk:chunk};
      var key = Math.floor(point.x/64) + "," + Math.floor(point.y/64);
      (grids[page][key] || (grids[page][key] = [])).push(point);
    }
    x += w + measure(" ");
  }
  if (i < words.length) return false;
  job.result = {pages:pages,grids:grids,truncated:truncated};
  return true;
  }};
  return job;
}

/** Synchronous convenience for tests/renderers; QML advances a job per frame. */
function layoutArticle(article, term, width, height, measure) {
  var job = createArticleLayout(article,term,width,height,measure);
  while (!job.advance(10000)) { /* Offscreen callers only. */ }
  return job.result;
}

function articleFoothold(map, page, x, y, radius) {
  var grid = map.grids[page] || {};
  var best = null;
  var bestD = Infinity;
  for (var gx = Math.floor((x-radius)/64); gx <= Math.floor((x+radius)/64); gx++) {
    for (var gy = Math.floor((y-radius)/64); gy <= Math.floor((y+radius)/64); gy++) {
      var list = grid[gx+","+gy] || [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var d = Math.hypot(p.x-x,p.y-y);
        if (p.chunk.gone || d > radius) continue;
        if (!best || (p.chunk.match && !best.chunk.match) || (p.chunk.match === best.chunk.match && d < bestD)) {
          best = p; bestD = d;
        }
      }
    }
  }
  return best;
}

function articleCanTear(map, page, chunk) {
  if (chunk.gone) return false;
  return chunk.match || !(map.pages[page] || []).some(function (w) { return w.match && !w.gone; });
}

function articleTarget(map, page, x, y, reach) {
  var words = map.pages[page] || [];
  var best = null;
  var distance = Infinity;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (!w.match || w.gone) continue;
    var d = Math.hypot(w.x+w.w/2-x,w.y+w.h/2-y);
    if (d < distance) { best = w; distance = d; }
  }
  if (!best) return null;
  // Put the word under the feet rather than directly beneath the body.
  var angle = Math.random() * Math.PI * 2;
  return {x:best.x+best.w/2+Math.cos(angle)*(reach || 44),y:best.y+best.h/2+Math.sin(angle)*(reach || 44)};
}

function repairArticle(map) {
  for (var p = 0; p < map.pages.length; p++) {
    for (var i = 0; i < map.pages[p].length; i++) map.pages[p][i].gone = false;
  }
}

function drawArticle(ctx, map, page, ink, accent) {
  var words = map.pages[page] || [];
  ctx.font = "18px monospace";
  ctx.textBaseline = "top";
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.gone) continue;
    ctx.fillStyle = w.match ? accent : ink;
    ctx.fillText(w.text,w.x,w.y,w.w);
  }
}


/** Worker response is bounded so copying it back cannot carry a multi-MB page. */
function parseArticleMessage(message) {
  try {
    var article = parseArticle(message.body);
    article.truncated = article.text.length > 200000;
    if (article.truncated) article.text = article.text.slice(0,200000);
    return {id:message.id,article:article,message:""};
  } catch (error) {
    return {id:message.id,article:null,message:String(error.message || "Could not read Wikipedia's article.")};
  }
}

// The same plain script is imported by QML and loaded in its isolated worker.
if (typeof WorkerScript !== "undefined") {
  WorkerScript.onMessage = function (message) { WorkerScript.sendMessage(parseArticleMessage(message)); };
}
