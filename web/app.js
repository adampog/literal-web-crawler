/*
 * Literal Web Crawler: the browser host.
 *
 * Turns the article into footholds (one per word), lets the shared engine in
 * core/crawler.js walk on them, and renders torn-off links and IDs as glowing
 * DOM pieces. Coordinates are document coordinates (page scroll included);
 * the canvas is fixed to the viewport, so drawing subtracts the scroll.
 */
// Uses createCrawler, drawSpider and CRAWLER_PALETTE from core/crawler.js,
// loaded by an earlier <script> tag (declared as globals in eslint.config.js).
"use strict";

(function () {
  var doc = document.getElementById("doc");
  var layer = document.getElementById("debris");
  var canvas = document.getElementById("legs");
  var ctx = canvas.getContext("2d");
  var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- page content ----------

  /** Words that look like identifiers (ISBNs, DOIs, years, URLs) can be torn off on their own. */
  var ID_PATTERN = /\d{3,}|^\(?(ISBN|PMID|PMC|OCLC|S2CID|doi|DOI|arXiv|Bibcode|RFC)\b|^https?:|^www\./;

  /**
   * Wrap every word in a span.w so each one can be a foothold. Links and
   * identifier-looking words become "chunks": the unit a foot tears off.
   */
  function wrapWords(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      if (!node.nodeValue.trim()) return;
      var inChunk = node.parentElement && node.parentElement.closest("a,.grab");
      var frag = document.createDocumentFragment();
      node.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.append(part);
          return;
        }
        var span = document.createElement("span");
        span.className = !inChunk && ID_PATTERN.test(part) ? "w grab" : "w";
        span.textContent = part;
        frag.append(span);
      });
      node.replaceWith(frag);
    });
  }

  /** Tags a paste may keep, mapped to what we rebuild them as. Everything else is unwrapped. */
  var KEEP = {
    P: "p", H1: "h1", H2: "h2", H3: "h3", H4: "h4", H5: "h4", H6: "h4", UL: "ul", OL: "ol", LI: "li", A: "a",
    B: "b", STRONG: "b", I: "i", EM: "i", CITE: "cite", BLOCKQUOTE: "blockquote", BR: "br", SUP: "sup", SUB: "sub",
    CODE: "code", DD: "p", DT: "p", CAPTION: "p", DIV: "div", SECTION: "div", ARTICLE: "div", TABLE: "div", TR: "div",
    FIGCAPTION: "p"
  };
  /** Tags dropped along with everything inside them. */
  var DROP = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "IMG", "PICTURE", "VIDEO", "AUDIO",
    "CANVAS", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "FORM", "LINK", "META", "HEAD", "TITLE", "NAV", "MATH"
  ]);

  /**
   * Rebuild pasted HTML from scratch with only safe tags and no attributes
   * (links get href="#"), so nothing from the paste can run or navigate.
   * `budget.n` caps the amount of text so huge pastes stay responsive.
   */
  function clean(src, out, budget) {
    src.childNodes.forEach(function (n) {
      if (budget.n <= 0) return;
      if (n.nodeType === Node.TEXT_NODE) {
        out.append(n.nodeValue);
        budget.n -= n.nodeValue.length;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        var tag = n.tagName.toUpperCase();
        if (DROP.has(tag)) return;
        var keep = KEEP[tag];
        if (keep) {
          var el = document.createElement(keep);
          if (keep === "a") el.href = "#";
          if (keep === "ol" && /ref/.test(n.getAttribute("class") || "")) el.className = "refs";
          out.append(el);
          if (keep !== "br") clean(n, el, budget);
        } else {
          clean(n, out, budget);
          if (tag === "TD" || tag === "TH") out.append(" ");
        }
      }
    });
  }

  function setContent(build) {
    repair();
    doc.textContent = "";
    build(doc);
    wrapWords(doc);
    requestAnimationFrame(function () {
      layout();
      centerSpider();
    });
  }

  function loadSample() {
    setContent(function (d) {
      d.append(document.getElementById("sampleTpl").content.cloneNode(true));
    });
  }

  // ---------- footholds ----------

  /** Spatial hash of every word's box, keyed by 48px cells, in document coordinates. */
  var CELL = 48;
  var grid = new Map();

  function layout() {
    grid = new Map();
    var sx = scrollX;
    var sy = scrollY;
    doc.querySelectorAll(".w").forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (!r.width) return;
      var word = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height, chunk: el.closest("a,.grab") };
      var key = Math.floor((word.x + word.w / 2) / CELL) + "," + Math.floor((word.y + word.h / 2) / CELL);
      var list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(word);
    });
    layer.style.height = document.documentElement.scrollHeight + "px";
  }

  // The host object the engine talks to (see core/crawler.js).
  var host = {
    footholdNear: function (x, y, r) {
      var best = null;
      var bestD = Infinity;
      for (var cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
        for (var cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
          var list = grid.get(cx + "," + cy);
          if (!list) continue;
          for (var k = 0; k < list.length; k++) {
            var o = list[k];
            if (o.chunk && o.chunk.gone) continue;
            var d = Math.hypot(o.x + o.w / 2 - x, o.y + o.h / 2 - y);
            if (d > r) continue;
            // Some randomness, and a pull toward links and IDs: they are what it eats.
            d += Math.random() * 14 - (o.chunk ? 12 : 0);
            if (d < bestD) {
              bestD = d;
              best = o;
            }
          }
        }
      }
      if (!best) return null;
      return { x: best.x + best.w * (0.15 + Math.random() * 0.7), y: best.y + best.h * 0.55, chunk: best.chunk };
    },

    tearOff: function (chunk) {
      // A link that wraps lines tears off as its first line.
      var r = chunk.getClientRects()[0];
      if (!r) return null;
      chunk.gone = true;
      chunk.classList.add("gone");
      var el = document.createElement("span");
      var styles = ["fill", "fill", "outline", "mono"];
      el.className = "debris h" + (spider.torn % CRAWLER_PALETTE.length) + " " + styles[Math.floor(Math.random() * styles.length)];
      el.textContent = chunk.textContent.replace(/\s+/g, " ").trim().slice(0, 70);
      layer.appendChild(el);
      updateCount(spider.torn + 1);
      return { x: r.left + scrollX, y: r.top + scrollY, w: el.offsetWidth, h: el.offsetHeight, visual: el };
    },

    bounds: function () {
      return {
        left: scrollX,
        top: scrollY + barBottom(),
        right: scrollX + innerWidth,
        bottom: scrollY + innerHeight
      };
    },

    removePiece: function (p) {
      p.visual.remove();
    }
  };

  var spider = createCrawler(host);
  var paused = reduceMotion;

  function barBottom() {
    return document.querySelector(".bar").getBoundingClientRect().bottom;
  }

  function centerSpider() {
    spider.placeAt(scrollX + innerWidth * 0.55, scrollY + Math.max(barBottom() + 120, innerHeight * 0.5));
  }

  function updateCount(n) {
    document.getElementById("torn").textContent = n + " torn off";
  }

  /** Put every torn link back and clear the flying pieces. */
  function repair() {
    doc.querySelectorAll(".gone").forEach(function (el) {
      el.classList.remove("gone");
      el.gone = false;
    });
    spider.pieces.forEach(function (p) {
      p.visual.remove();
    });
    spider.clearPieces();
    updateCount(0);
  }

  // ---------- drawing ----------

  var dpr = 1;
  function resizeCanvas() {
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  }

  /** Colors come from the CSS tokens, so the spider follows light and dark themes. */
  var theme = {};
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    var token = function (name) {
      return cs.getPropertyValue(name).trim();
    };
    theme = {
      ink: token("--spider"),
      fill: token("--bg"),
      accent: token("--hl-magenta"),
      eyes: token("--hl-cyan"),
      legs: [token("--hl-cyan"), token("--hl-violet"), token("--hl-magenta"), token("--hl-amber")]
    };
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.translate(-scrollX, -scrollY);
    drawSpider(ctx, spider, theme);
    spider.pieces.forEach(function (p) {
      p.visual.style.transform = "translate(" + p.x + "px," + p.y + "px) rotate(" + p.rot + "rad)";
      p.visual.style.opacity = p.alpha;
    });
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    if (!paused && dt > 0) spider.step(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- controls ----------

  var roamBtn = document.getElementById("mRoam");
  var followBtn = document.getElementById("mFollow");
  function setMode(mode) {
    spider.mode = mode;
    spider.tap = null;
    roamBtn.setAttribute("aria-pressed", String(mode === "roam"));
    followBtn.setAttribute("aria-pressed", String(mode === "follow"));
  }
  roamBtn.onclick = function () {
    setMode("roam");
  };
  followBtn.onclick = function () {
    setMode("follow");
  };

  var ripInput = document.getElementById("rip");
  var sizeInput = document.getElementById("size");
  ripInput.oninput = function () {
    spider.ripRate = Number(ripInput.value);
  };
  sizeInput.oninput = function () {
    spider.size = Number(sizeInput.value);
  };
  spider.ripRate = Number(ripInput.value);
  spider.size = Number(sizeInput.value);

  var pauseBtn = document.getElementById("pause");
  function syncPause() {
    pauseBtn.textContent = paused ? "Start crawling" : "Pause";
  }
  pauseBtn.onclick = function () {
    paused = !paused;
    syncPause();
  };
  syncPause();
  document.getElementById("repair").onclick = repair;

  var own = document.getElementById("own");
  var ownBtn = document.getElementById("ownBtn");
  var src = document.getElementById("src");
  var msg = document.getElementById("ownMsg");
  function closeOwn() {
    own.hidden = true;
    ownBtn.setAttribute("aria-expanded", "false");
  }
  ownBtn.onclick = function () {
    own.hidden = !own.hidden;
    ownBtn.setAttribute("aria-expanded", String(!own.hidden));
    if (!own.hidden) src.focus();
    requestAnimationFrame(layout);
  };

  // Keep the HTML version of a paste so links survive, as long as the text is unedited.
  var pastedHTML = null;
  var pastedText = null;
  src.addEventListener("paste", function (e) {
    var html = e.clipboardData && e.clipboardData.getData("text/html");
    pastedHTML = html || null;
    setTimeout(function () {
      pastedText = src.value;
      msg.textContent = pastedHTML ? "Got formatted content with links. Press Crawl this." : "Got plain text. Press Crawl this.";
    }, 0);
  });

  document.getElementById("crawl").onclick = function () {
    var text = src.value.trim();
    if (!text) {
      msg.textContent = "Paste some text first.";
      return;
    }
    if (pastedHTML && src.value === pastedText) {
      var parsed = new DOMParser().parseFromString(pastedHTML, "text/html");
      setContent(function (d) {
        clean(parsed.body, d, { n: 25000 });
      });
    } else {
      setContent(function (d) {
        text.slice(0, 25000).split(/\n\s*\n/).forEach(function (para) {
          var p = document.createElement("p");
          para.split("\n").forEach(function (line, i) {
            if (i) p.append(document.createElement("br"));
            p.append(line);
          });
          d.append(p);
        });
      });
    }
    msg.textContent = "";
    closeOwn();
    scrollTo(0, 0);
  };

  document.getElementById("sample").onclick = function () {
    loadSample();
    msg.textContent = "";
    closeOwn();
    scrollTo(0, 0);
  };

  // Links in the article are footholds, not navigation.
  doc.addEventListener("click", function (e) {
    if (e.target.closest("a")) e.preventDefault();
  });
  addEventListener("pointermove", function (e) {
    spider.setPointer(e.clientX + scrollX, e.clientY + scrollY);
  }, { passive: true });
  addEventListener("scroll", function () {
    if (spider.pointer) spider.pointer = null; // stale until the mouse moves again
  }, { passive: true });
  addEventListener("pointerdown", function (e) {
    if (e.target.closest(".bar, #own")) return;
    // In follow mode a mouse already steers; taps (touch, pen) always send it.
    if (spider.mode === "follow" && e.pointerType === "mouse") return;
    spider.sendTo(e.clientX + scrollX, e.clientY + scrollY);
    if (paused) {
      paused = false;
      syncPause();
    }
  });

  var layoutTimer;
  function scheduleLayout(ms) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(layout, ms);
  }
  addEventListener("resize", function () {
    resizeCanvas();
    scheduleLayout(150);
  });
  new ResizeObserver(function () {
    scheduleLayout(100);
  }).observe(doc);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (document.fonts) {
    document.fonts.ready.then(function () {
      layout();
      spider.plantAll();
    });
  }

  resizeCanvas();
  readTheme();
  loadSample();
  requestAnimationFrame(frame);
})();
