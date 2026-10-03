/*
 * Literal Web Crawler: the shared spider engine.
 *
 * The same file runs in two places:
 *   - the browser toy (index.html) loads it as a classic <script>;
 *   - the Omarchy plugin imports it in QML with `import "core/crawler.js" as Core`.
 *
 * So it uses no modules, no DOM and no QML types. Everything it needs from
 * the outside world comes through a small "host" object:
 *
 *   host.footholdNear(x, y, radius) -> { x, y, chunk } | null
 *       A spot a foot can grip near (x, y). `chunk` is the thing that foot is
 *       standing on (a link, a word, a patch of screen) or null. A chunk is any
 *       object; the engine only reads and writes its `gone` flag.
 *   host.tearOff(chunk, foot) -> { x, y, w, h } | null
 *       Rip `chunk` off the page and return its rectangle. The host marks the
 *       chunk gone and creates whatever visual stands in for the torn piece.
 *   host.bounds() -> { left, top, right, bottom }
 *       The area the spider may roam in, in the same coordinates as everything else.
 *   host.removePiece(piece)
 *       A torn piece has faded out; drop its visual.
 *
 * Top-level declarations use `var` and `function` so QML exposes them on the
 * import namespace.
 */
/* exported CRAWLER_PALETTE, createCrawler, drawSpider */

/** Neon colors for legs and torn pieces: cyan, magenta, violet, amber. */
var CRAWLER_PALETTE = ["#55dcf2", "#e45cc0", "#9a82ff", "#ffb547"];

/**
 * Where each leg wants its foot, relative to the body, in units of reach.
 * `f` is how far forward, `l` how far out to the side. Index 0 is the front leg.
 */
var LEG_LAYOUT = [
  { f: 0.95, l: 0.6 },
  { f: 0.38, l: 1.0 },
  { f: -0.22, l: 1.0 },
  { f: -0.78, l: 0.62 }
];

/** Where each leg joins the body, forward offset as a fraction of body length. */
var HIP_OFFSETS = [0.42, 0.16, -0.08, -0.3];

/** Seconds a torn piece drifts at full opacity, then how long it takes to fade. */
var PIECE_LIFE = 5;
var PIECE_FADE = 1.6;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Ease in and out over t in [0, 1], used for the arc of a stepping foot. */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Shortest signed angle from a to b, in radians. */
function angleDelta(a, b) {
  return ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

/**
 * Build a spider bound to a host (see the header comment).
 * Returns the crawler state plus the methods that drive it.
 */
function createCrawler(host) {
  var c = {
    // Body position and velocity, heading in radians.
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    a: -Math.PI / 2,

    // Tunables a host exposes as controls.
    size: 1,
    ripRate: 0.35,
    mode: "roam", // "roam" wanders on its own, "follow" chases the pointer

    feet: [],
    pieces: [],
    torn: 0,

    pointer: null, // { x, y } while a pointer is known
    tap: null, // a one-off destination that beats roam and follow
    roam: null,
    roamWait: 0
  };

  // Eight feet. `group` splits them into the two sets of an alternating
  // tetrapod gait: L1 R2 L3 R4 step together, then R1 L2 R3 L4.
  for (var s = -1; s <= 1; s += 2) {
    for (var i = 0; i < 4; i++) {
      c.feet.push({
        side: s,
        i: i,
        group: (i + (s > 0 ? 1 : 0)) % 2,
        x: 0, y: 0, vx: 0, vy: 0,
        fromX: 0, fromY: 0, toX: 0, toY: 0,
        t: 1,
        dur: 0.15,
        swing: false,
        chunk: null, // what the planted foot is standing on
        carry: null, // a torn piece this foot is dragging
        carrySteps: 0,
        releaseAt: 2 // swing progress at which the carried piece is flung
      });
    }
  }

  /** Leg reach in pixels; everything about the body scales with it. */
  c.reach = function () {
    return 62 * c.size;
  };

  /** Where a foot would rest if the spider stood still right now. */
  c.idealFoot = function (f) {
    var r = c.reach();
    var fx = Math.cos(c.a);
    var fy = Math.sin(c.a);
    var fw = LEG_LAYOUT[f.i].f * r;
    var lat = f.side * LEG_LAYOUT[f.i].l * r;
    return { x: c.x + fx * fw - fy * lat, y: c.y + fy * fw + fx * lat };
  };

  /** Put every foot straight down on the nearest foothold, no animation. */
  c.plantAll = function () {
    for (var k = 0; k < c.feet.length; k++) {
      var f = c.feet[k];
      var id = c.idealFoot(f);
      var hold = host.footholdNear(id.x, id.y, c.reach() * 0.6);
      f.x = hold ? hold.x : id.x;
      f.y = hold ? hold.y : id.y;
      f.chunk = hold ? hold.chunk : null;
      f.swing = false;
      f.t = 1;
      f.carry = null;
      f.releaseAt = 2;
    }
  };

  /** Drop the spider at (x, y) with its feet planted. */
  c.placeAt = function (x, y) {
    c.x = x;
    c.y = y;
    c.vx = c.vy = 0;
    c.roam = null;
    c.tap = null;
    c.plantAll();
  };

  /** Walk to (x, y) once, then go back to roaming or following. */
  c.sendTo = function (x, y) {
    c.tap = { x: x, y: y };
  };

  c.setPointer = function (x, y) {
    c.pointer = { x: x, y: y };
  };

  /** Forget every torn piece without asking the host to remove visuals. */
  c.clearPieces = function () {
    c.pieces.length = 0;
    for (var k = 0; k < c.feet.length; k++) {
      c.feet[k].carry = null;
      c.feet[k].releaseAt = 2;
    }
    c.torn = 0;
  };

  /** Choose a new wander target inside the host's bounds, not too near or far. */
  function pickRoam() {
    var b = host.bounds();
    var m = 60;
    var x = c.x;
    var y = c.y;
    for (var k = 0; k < 10; k++) {
      x = b.left + m + Math.random() * Math.max(10, b.right - b.left - 2 * m);
      y = b.top + m + Math.random() * Math.max(10, b.bottom - b.top - 2 * m);
      var d = Math.hypot(x - c.x, y - c.y);
      if (d > 140 && d < 460) break;
    }
    c.roam = { x: x, y: y };
    c.roamWait = 0.2 + Math.random() * 1.4;
  }

  function outOfBounds(p) {
    var b = host.bounds();
    return p.x < b.left || p.x > b.right || p.y < b.top || p.y > b.bottom;
  }

  /** Rip the chunk under a foot and attach the torn piece to that foot. */
  function rip(f) {
    var rect = host.tearOff(f.chunk, f);
    if (!rect) return;
    var p = {
      x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      vx: 0, vy: 0, rot: 0, vr: 0,
      life: 0,
      alpha: 1,
      hue: c.torn % CRAWLER_PALETTE.length,
      by: f,
      // Where on the piece the foot grabbed it, so it hangs from that point.
      ox: clamp(f.x - rect.x, 0, rect.w),
      oy: clamp(f.y - rect.y, 0, rect.h),
      chunk: f.chunk
    };
    // Hand the host's visual back to it through the piece.
    if (rect.visual !== undefined) p.visual = rect.visual;
    c.pieces.push(p);
    f.carry = p;
    f.carrySteps = 1 + Math.floor(Math.random() * 3);
    c.torn++;
  }

  /** Let go of a carried piece and fling it in the direction the foot moves. */
  function release(f) {
    var p = f.carry;
    if (!p) return;
    p.by = null;
    p.vx = f.vx * 0.7 + (Math.random() - 0.5) * 260;
    p.vy = f.vy * 0.7 + (Math.random() - 0.5) * 260;
    p.vr = (Math.random() - 0.5) * 7;
    f.carry = null;
    f.releaseAt = 2;
  }

  /** Start a step: maybe rip what the foot stood on, then pick where it lands. */
  function lift(f, px, py, speed) {
    if (f.carry) {
      f.carrySteps--;
      if (f.carrySteps <= 0) f.releaseAt = 0.45 + Math.random() * 0.3;
    } else if (f.chunk && !f.chunk.gone && Math.random() < c.ripRate * 0.6) {
      rip(f);
    }
    var hold = host.footholdNear(px, py, c.reach() * 0.55);
    f.toX = hold ? hold.x : px;
    f.toY = hold ? hold.y : py;
    f.chunk = hold ? hold.chunk : null;
    f.fromX = f.x;
    f.fromY = f.y;
    f.t = 0;
    f.swing = true;
    // Faster walking means quicker steps.
    f.dur = Math.max(0.08, 0.17 - speed / 2600);
  }

  /** Advance the simulation by dt seconds. */
  c.step = function (dt) {
    // 1. Decide where the body is heading.
    var tx;
    var ty;
    if (c.tap) {
      tx = c.tap.x;
      ty = c.tap.y;
      if (Math.hypot(tx - c.x, ty - c.y) < 14) c.tap = null;
    } else if (c.mode === "follow" && c.pointer) {
      tx = c.pointer.x;
      ty = c.pointer.y;
    } else {
      if (!c.roam || outOfBounds(c.roam)) pickRoam();
      if (Math.hypot(c.roam.x - c.x, c.roam.y - c.y) < 20) {
        c.roamWait -= dt;
        if (c.roamWait < 0) pickRoam();
      }
      tx = c.roam.x;
      ty = c.roam.y;
    }

    // 2. Steer the body: ease toward a capped speed, slow down on arrival.
    var dx = tx - c.x;
    var dy = ty - c.y;
    var d = Math.hypot(dx, dy);
    var maxV = 110 + 50 * c.size;
    var want = d > 6 ? Math.min(maxV, d * 2.2) : 0;
    var k = 1 - Math.exp(-dt * 4);
    c.vx += ((d ? dx / d : 0) * want - c.vx) * k;
    c.vy += ((d ? dy / d : 0) * want - c.vy) * k;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    var speed = Math.hypot(c.vx, c.vy);
    if (speed > 8) c.a += angleDelta(c.a, Math.atan2(c.vy, c.vx)) * (1 - Math.exp(-dt * 6));

    // 3. Move the legs. A planted foot steps once it falls too far behind its
    //    ideal spot, but only while the other gait group is on the ground.
    var r = c.reach();
    var stepDist = r * 0.42;
    var swinging = [0, 0];
    var n;
    for (n = 0; n < c.feet.length; n++) if (c.feet[n].swing) swinging[c.feet[n].group]++;
    for (n = 0; n < c.feet.length; n++) {
      var f = c.feet[n];
      var id = c.idealFoot(f);
      if (f.swing) {
        f.t = Math.min(1, f.t + dt / f.dur);
        var e = easeInOut(f.t);
        var nx = f.fromX + (f.toX - f.fromX) * e;
        var ny = f.fromY + (f.toY - f.fromY) * e;
        f.vx = (nx - f.x) / dt;
        f.vy = (ny - f.y) / dt;
        f.x = nx;
        f.y = ny;
        if (f.carry && f.t >= f.releaseAt) release(f);
        if (f.t >= 1) {
          f.swing = false;
          f.vx = f.vy = 0;
        }
      } else {
        var off = Math.hypot(f.x - id.x, f.y - id.y);
        // Hopelessly far (after a teleport or a big scroll): snap into place.
        if (off > r * 3) {
          f.x = id.x;
          f.y = id.y;
          f.chunk = null;
          continue;
        }
        // While standing still, now and then shuffle a foot back under the body.
        var settle = speed < 5 && off > r * 0.18 && Math.random() < dt * 2.5;
        if ((off > stepDist || settle) && swinging[1 - f.group] === 0) {
          // Aim a little ahead of the body so the stride matches the speed.
          lift(f, id.x + c.vx * 0.2, id.y + c.vy * 0.2, speed);
          swinging[f.group]++;
        }
      }
    }

    // 4. Torn pieces: hang from the carrying foot, or drift, spin and fade.
    for (n = c.pieces.length - 1; n >= 0; n--) {
      var p = c.pieces[n];
      if (p.by) {
        var kk = 1 - Math.exp(-dt * 16);
        p.x += (p.by.x - p.ox - p.x) * kk;
        p.y += (p.by.y - p.oy - p.y) * kk;
        p.rot += (clamp(p.by.vx * 0.0012, -0.5, 0.5) - p.rot) * kk;
      } else {
        p.vy += 70 * dt; // a little gravity
        var drag = Math.exp(-dt * 1.3);
        p.vx *= drag;
        p.vy *= drag;
        p.vr *= Math.exp(-dt * 0.7);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life += dt;
        if (p.life > PIECE_LIFE) {
          p.alpha = 1 - (p.life - PIECE_LIFE) / PIECE_FADE;
          if (p.alpha <= 0) {
            c.pieces.splice(n, 1);
            host.removePiece(p);
          }
        }
      }
    }
  };

  return c;
}

/**
 * Draw the spider with a 2D canvas context. Works with both the browser's
 * CanvasRenderingContext2D and QML's Context2D, so it sticks to the API the
 * two share (no ellipse(): QML's takes a bounding box instead of radii).
 *
 * theme: { ink, fill, accent, silk, legs: [4 colors, front to back] }
 * The caller sets up any scroll translation before calling.
 */
function drawSpider(ctx, c, theme) {
  var s = c.size;
  var L = c.reach() * 0.7; // length of each leg segment
  var fx = Math.cos(c.a);
  var fy = Math.sin(c.a);
  var rx = -fy;
  var ry = fx;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Silk threads from the abdomen to anything being carried.
  ctx.lineWidth = 1;
  for (var k = 0; k < c.feet.length; k++) {
    var cf = c.feet[k];
    if (!cf.carry) continue;
    ctx.strokeStyle = CRAWLER_PALETTE[cf.carry.hue];
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(c.x - fx * 14 * s, c.y - fy * 14 * s);
    ctx.lineTo(cf.carry.x + cf.carry.ox, cf.carry.y + cf.carry.oy);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Legs: hip -> knee -> foot, solved with two-bone inverse kinematics.
  for (var n = 0; n < c.feet.length; n++) {
    var f = c.feet[n];
    var hx = c.x + fx * HIP_OFFSETS[f.i] * 22 * s + rx * f.side * 4 * s;
    var hy = c.y + fy * HIP_OFFSETS[f.i] * 22 * s + ry * f.side * 4 * s;
    var ux = f.x - hx;
    var uy = f.y - hy;
    var dd = Math.hypot(ux, uy) || 1;
    ux /= dd;
    uy /= dd;
    var kx;
    var ky;
    if (dd >= 2 * L) {
      // Fully stretched: the knee sits halfway.
      kx = (hx + f.x) / 2;
      ky = (hy + f.y) / 2;
    } else {
      var half = dd / 2;
      // A lifted leg bends higher, which reads as a raised knee from above.
      var h = Math.sqrt(L * L - half * half) * (f.swing ? 1.25 : 1);
      var px = -uy;
      var py = ux;
      // Knees point away from the body...
      if ((px * rx + py * ry) * f.side < 0) {
        px = -px;
        py = -py;
      }
      // ...front knees bend forward, back knees backward.
      if ((px * fx + py * fy) * (f.i < 2 ? 1 : -1) < -0.6) {
        px = -px;
        py = -py;
      }
      kx = hx + ux * half + px * h;
      ky = hy + uy * half + py * h;
    }
    var legColor = theme.legs ? theme.legs[f.i] : theme.ink;
    ctx.strokeStyle = legColor;
    ctx.fillStyle = legColor;
    ctx.lineWidth = 1.7 * s;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(kx, ky);
    ctx.lineTo(f.x, f.y);
    ctx.stroke();
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(kx, ky, 1.7 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = legColor;
    ctx.beginPath();
    ctx.arc(f.x, f.y, (f.swing ? 2.6 : 1.9) * s, 0, Math.PI * 2);
    if (f.swing) {
      ctx.lineWidth = 1.2 * s;
      ctx.stroke();
    } else {
      ctx.fill();
    }
  }

  // Body: abdomen and cephalothorax as scaled circles, then a glowing
  // abdomen mark and two eyes.
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a);
  ctx.strokeStyle = theme.ink;
  ctx.fillStyle = theme.fill;
  ctx.lineWidth = 1.7 * s;
  oval(ctx, -15 * s, 0, 12 * s, 9 * s);
  oval(ctx, 2 * s, 0, 8 * s, 6.5 * s);
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = 10 * s;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(-15 * s, 0, 3.4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.eyes || theme.accent;
  for (var e = -1; e <= 1; e += 2) {
    ctx.beginPath();
    ctx.arc(8 * s, e * 2.4 * s, 1.4 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

/** Fill and stroke an axis-aligned oval centred on (cx, cy) with radii rx, ry. */
function oval(ctx, cx, cy, rx, ry) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.restore();
  ctx.fill();
  ctx.stroke();
}
