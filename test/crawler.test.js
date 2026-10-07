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
  run(spider, 9, 1 / 60, (s) => {
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

test("desktop click crosses half of 3440 pixels within eight seconds without gliding", () => {
  const host = gridHost();
  host.bounds = () => ({left:0,top:0,right:3440,bottom:1440});
  host.footholdNear = (x,y) => ({x,y,chunk:null});
  const spider = core.createCrawler(host);
  spider.size = .714; spider.a = 0; spider.placeAt(860,720); spider.sendTo(2580,720);
  for (let frame=0;frame<480 && spider.tap;frame++) {
    const old = {x:spider.x,y:spider.y};
    const feet = spider.feet.map(f => ({x:f.x,y:f.y,swing:f.swing}));
    spider.step(1/60);
    if (Math.hypot(spider.x-old.x,spider.y-old.y)>1e-8) {
      assert.ok(spider.feet.filter((f,i) => !f.swing && !feet[i].swing && Math.hypot(f.x-feet[i].x,f.y-feet[i].y)<1e-8).length>=4);
    }
  }
  assert.equal(spider.tap,null,"1720px click did not arrive within 8 seconds");
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
    "beginPath", "moveTo", "lineTo", "arc", "stroke", "fill", "save", "restore", "translate", "rotate", "scale", "quadraticCurveTo", "clip", "closePath"
  ]);
  const used = new Set();
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        used.add(prop);
        for (const a of args) assert.ok(Number.isFinite(a) || typeof a === "boolean", `${String(prop)} got ${a}`);
      };
    }
  });
  core.drawSpider(ctx, spider, { ink: "#fff", fill: "#000", accent: "#f0f", legs: ["#0ff", "#f0f", "#90f", "#fa0"] });
  for (const name of used) assert.ok(allowed.has(name), `uses ${name}`);
  assert.ok(used.has("arc") && used.has("quadraticCurveTo"));
});

test("widow leg lengths follow 1-4-2-3 with the front pair at 1.5x", () => {
  const spider = core.createCrawler(gridHost());
  const reach = [0,1,2,3].map(i => spider.legReach({i}));
  assert.equal(reach[0], spider.reach() * 1.5);
  assert.ok(reach[0] > reach[3] && reach[3] > reach[1] && reach[1] > reach[2]);
});

test("unequal legs stay reachable and outside the body through turns and size changes", () => {
  for (const size of [0.5, 1, 2.5]) {
    const spider = core.createCrawler(gridHost());
    spider.size = size;
    spider.placeAt(600, 400);
    spider.mode = "follow";
    const stepped = new Set();
    const planted = new Set();
    const groups = new Set();
    for (let frame = 0; frame < 900; frame++) {
      const a = Math.floor(frame / 120) * Math.PI / 2;
      spider.setPointer(600 + Math.cos(a) * 300, 400 + Math.sin(a) * 250);
      if (frame === 450) spider.size = 0.5;
      spider.step(1 / 30);
      const swinging = new Set();
      for (const f of spider.feet) {
        const hip = spider.hip(f);
        assert.ok(Math.hypot(f.x - hip.x, f.y - hip.y) <= spider.legReach(f) * 1.4 + 1e-6, "foot beyond its two segments");
        const lateral = (-(f.x - spider.x) * Math.sin(spider.a) + (f.y - spider.y) * Math.cos(spider.a)) * f.side;
        assert.ok(lateral >= 20 * spider.size - 1e-6, `foot crossed the body: size ${size}, frame ${frame}, leg ${f.side}/${f.i}, lateral ${lateral}, min ${20 * spider.size}`);
        if (f.swing) { stepped.add(f); swinging.add(f.group); groups.add(f.group); }
        else if (f.chunk) planted.add(f);
      }
      assert.ok(swinging.size <= 1, "both gait groups swinging");
    }
    assert.equal(stepped.size, 8, "every leg must step");
    assert.equal(planted.size, 8, "every leg must grip");
    assert.equal(groups.size, 2, "both groups must take turns");
  }
});

test("body stays translucent and hourglass stays red in light and dark themes", () => {
  const spider = core.createCrawler(gridHost());
  spider.placeAt(300, 300);
  for (const fill of ["#ffffff", "#101820"]) {
    const paints = [];
    let path = [];
    const ctx = new Proxy({ globalAlpha: 1 }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === "beginPath") return () => { path = []; };
        if (prop === "moveTo" || prop === "lineTo") return (...args) => { path.push(args); };
        if (prop === "fill") return () => { paints.push({ color: target.fillStyle, alpha: target.globalAlpha, path }); };
        return () => {};
      }
    });
    core.drawSpider(ctx, spider, { ink: "#888888", fill, accent: "#00ff00", legs: core.CRAWLER_PALETTE });
    const body = paints.filter((p) => p.color === fill);
    assert.equal(body.length, 1, "head and abdomen share one outline");
    assert.ok(body.every((p) => p.alpha > 0 && p.alpha < 1), "opaque body hides the page");
    const hourglass = paints.find((p) => p.color === "#ff304b");
    assert.ok(hourglass, "theme replaced red mark");
    assert.equal(hourglass.path.length, 7, "hourglass must have two lobes joined at a waist");
    assert.deepEqual(hourglass.path[2], hourglass.path[5], "lobes meet at the waist");
    assert.equal(hourglass.alpha, body[0].alpha, "red fill is as translucent as the body");
  }
});

test("three-segment IK preserves every bone length and ends at the planted foot", () => {
  for (const size of [0.5, 1, 2.5]) {
  const spider = core.createCrawler(gridHost());
  spider.size = size;
  spider.placeAt(600, 400);
  spider.mode = "follow";
  for (let frame = 0; frame < 720; frame++) {
    const a = Math.floor(frame / 90) * Math.PI / 2;
    spider.setPointer(600 + Math.cos(a) * 300, 400 + Math.sin(a) * 250);
    spider.step(1 / 30);
    for (const f of spider.feet) {
      const joints = core.legJoints(spider, f);
      assert.equal(joints.length, 4, "hip, knee, ankle, foot");
      for (let i = 0; i < 3; i++) {
        const length = Math.hypot(joints[i+1].x - joints[i].x, joints[i+1].y - joints[i].y, joints[i+1].z - joints[i].z);
        const expected = spider.legReach(f) * [0.55, 0.25, 0.6][i];
        assert.ok(Math.abs(length - expected) < 1e-6, `bone ${i}: ${length} != ${expected}`);
      }
      assert.equal(joints[3].x, f.x);
      assert.equal(joints[3].y, f.y);
    }
  }
  }
});

function segmentsCross(a, b, c, d) {
  const turn = (p, q, r) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  return turn(a,b,c)*turn(a,b,d) < -1e-8 && turn(c,d,a)*turn(c,d,b) < -1e-8;
}

test("leg roots and planted same-side legs do not cross while walking and turning", () => {
  for (const size of [0.5, 1, 2.5]) {
  const spider = core.createCrawler(gridHost());
  spider.size = size;
  spider.a = 0;
  spider.placeAt(300, 300);
  spider.mode = "follow";
  for (let frame = 0; frame < 900; frame++) {
    const angle = Math.floor(frame / 150) * Math.PI / 3;
    spider.setPointer(600 + 250 * Math.cos(angle), 400 + 200 * Math.sin(angle));
    spider.step(1 / 60);
    for (const side of [-1, 1]) {
      const feet = spider.feet.filter((f) => f.side === side);
      const legs = feet.map((f) => core.legJoints(spider, f));
      for (let i = 0; i < 4; i++) {for (let j = i + 1; j < 4; j++) {
        for (let a = 0; a < 3; a++) {for (let b = 0; b < 3; b++) {
          const moving = feet[i].group !== feet[j].group || feet[i].swing || feet[j].swing;
          if (moving && (a !== 0 || b !== 0)) continue;
          const rootEnd = (leg) => ({x:leg[0].x+(leg[1].x-leg[0].x)*0.3,y:leg[0].y+(leg[1].y-leg[0].y)*0.3});
          assert.ok(!segmentsCross(legs[i][a], moving ? rootEnd(legs[i]) : legs[i][a+1], legs[j][b], moving ? rootEnd(legs[j]) : legs[j][b+1]), `frame ${frame}, side ${side}, legs ${i}/${j}`);
        }}
      }}
    }
  }
  }
});

test("burst and pause clocks are bounded; movement is carried by stationary planted feet", () => {
  const spider = core.createCrawler(gridHost());
  spider.placeAt(300, 300);
  spider.mode = "follow";
  spider.setPointer(1050, 650);
  const phases = new Set();
  let moved = 0;
  let probed = false;
  for (let frame = 0; frame < 1200; frame++) {
    const old = { x: spider.x, y: spider.y, a: spider.a };
    const oldFeet = spider.feet.map((f) => ({x:f.x,y:f.y,swing:f.swing}));
    spider.step(1/60);
    phases.add(spider.locomotion);
    assert.ok(spider.phaseRemaining >= 0 && spider.phaseRemaining <= 2.1);
    const distance = Math.hypot(spider.x-old.x, spider.y-old.y);
    if (distance > 1e-8 || Math.abs(spider.a-old.a) > 1e-8) {
      moved += distance;
      const supports = spider.feet.filter((f,i) => !f.swing && !oldFeet[i].swing && Math.hypot(f.x-oldFeet[i].x,f.y-oldFeet[i].y) < 1e-8);
      assert.ok(supports.length >= 4, "body glides without four anchored feet");
      assert.equal(spider.locomotion, "burst");
    }
    probed ||= spider.feet.some((f) => f.probing);
  }
  assert.ok(moved > 200, "never travelled");
  assert.deepEqual([...phases].sort(), ["burst", "pause"]);
  assert.ok(probed, "never tested a foothold");
});

test("body pose is solved from the four planted stance anchors", () => {
  const spider = core.createCrawler(gridHost());
  spider.a = 0;
  spider.placeAt(300, 300);
  spider.sendTo(900, 300);
  let examined = false;
  for (let i=0;i<120;i++) {
    spider.step(1/60);
    if (spider.gaitPhase > 0.2 && spider.gaitPhase < 0.7) {
      const pose = spider.poseFromStance();
      assert.ok(Math.hypot(pose.x-spider.x, pose.y-spider.y) < 1e-6);
      assert.ok(Math.abs(core.angleDelta(pose.a,spider.a)) < 1e-6);
      const supports=spider.feet.filter(f=>f.group!==spider.gaitGroup);
      for(const f of supports){f.x+=17;f.y-=11;}
      const shifted=spider.poseFromStance();
      assert.ok(Math.abs(shifted.x-pose.x-17)<1e-6);
      assert.ok(Math.abs(shifted.y-pose.y+11)<1e-6);
      examined=true;
      break;
    }
  }
  assert.ok(examined);
});

test("swing tetrapod lifts feet in an arc while the stance tetrapod stays on the ground", () => {
  const spider = core.createCrawler(gridHost());
  spider.placeAt(300,300);spider.sendTo(900,300);
  let lifted=0;
  for(let i=0;i<360;i++){
    spider.step(1/60);
    for(const f of spider.feet){
      assert.equal(f.group,(f.i+(f.side>0?1:0))%2);
      if(!f.swing)assert.equal(f.z,0);
      else if(f.t>.2&&f.t<.6){assert.ok(f.z>3*spider.size);lifted++;}
    }
  }
  assert.ok(lifted>0);
});

test("rendered roots and planted same-side legs do not cross through turns", () => {
  for (const size of [0.5, 1, 2.5]) {
    const spider = core.createCrawler(gridHost());
    spider.size = size;
    spider.a = 0;
    spider.placeAt(300, 300);
    spider.mode = "follow";
    let curves = [], start, curve;
    const ctx = new Proxy({}, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === "beginPath") return () => { curve = null; };
        if (prop === "moveTo") return (x,y) => { start = {x,y}; };
        if (prop === "quadraticCurveTo") return (cx,cy,x,y) => { curve = {start,cx,cy,x,y}; };
        if (prop === "stroke") {return () => {
          if (!curve) return;
          const points = [];
          for (let i=0;i<=8;i++) {
            const t=i/8, u=1-t;
            points.push({x:u*u*curve.start.x+2*u*t*curve.cx+t*t*curve.x,
              y:u*u*curve.start.y+2*u*t*curve.cy+t*t*curve.y});
          }
          curves.push(points);
        };}
        return () => {};
      }
    });
    for (let frame=0;frame<900;frame++) {
      const angle=Math.floor(frame/150)*Math.PI/3;
      spider.setPointer(600+250*Math.cos(angle),400+200*Math.sin(angle));
      spider.step(1/60);
      curves=[];
      core.drawSpider(ctx,spider,{ink:"#fff",fill:"#101820",accent:"#ff00ff",legs:core.CRAWLER_PALETTE});
      assert.equal(curves.length,24);
      for (let i=0;i<8;i++) {for(let j=i+1;j<8;j++) {
        if(spider.feet[i].side!==spider.feet[j].side)continue;
        for(let a=0;a<3;a++){for(let b=0;b<3;b++) {
          if ((spider.feet[i].group !== spider.feet[j].group || spider.feet[i].swing || spider.feet[j].swing) && (a !== 0 || b !== 0)) continue;
          const p=curves[i*3+a],q=curves[j*3+b];
          const end = spider.feet[i].group !== spider.feet[j].group || spider.feet[i].swing || spider.feet[j].swing ? 2 : 8;
          for(let k=0;k<end;k++){for(let l=0;l<end;l++) {
            assert.ok(!segmentsCross(p[k],p[k+1],q[l],q[l+1]),`size ${size}, frame ${frame}, legs ${i}/${j}`);
          }}
        }}
      }}
    }
  }
});


test("click and follow pause only briefly while roaming retains longer rests", () => {
  for (const mode of ["click", "follow", "roam"]) {
    const spider = core.createCrawler(gridHost());
    spider.placeAt(200, 200);
    if (mode === "click") spider.sendTo(1100, 700);
    if (mode === "follow") { spider.mode = "follow"; spider.setPointer(1100, 700); }
    let longest = 0;
    for (let frame = 0; frame < 240; frame++) {
      spider.step(1 / 60);
      if (spider.locomotion === "pause") longest = Math.max(longest, spider.phaseRemaining);
    }
    if (mode === "roam") assert.ok(longest >= 0.15 && longest <= 0.38);
    else assert.ok(longest <= 0.05, `${mode} pause ${longest}`);
  }
});


test("desktop default footprint is smaller than the original at true screen scale", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const qml = fs.readFileSync(path.join(__dirname,"../Crawler.qml"),"utf8");
  const defaultSize = Number(/property real size: ([0-9.]+)/.exec(qml)[1]);
  const host = gridHost();
  host.footholdNear = (x,y) => ({x,y,chunk:null});
  const spider = core.createCrawler(host);
  spider.size = defaultSize; spider.a = 0; spider.placeAt(1720,720);
  const xs = spider.feet.map(f => f.x); const ys = spider.feet.map(f => f.y);
  const width = Math.max(...xs)-Math.min(...xs); const height = Math.max(...ys)-Math.min(...ys);
  // bb4fa73 at size1, neutral pose: 107.26 x 124 logical pixels.
  assert.ok(width < 107.26 && height < 124, `${width} x ${height}`);
  assert.ok(Math.abs(width-103.5104739517692) < 1e-6);
  assert.ok(Math.abs(height-87.3564571675986) < 1e-6);
});
