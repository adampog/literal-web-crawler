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
/* exported CRAWLER_PALETTE, createCrawler, drawSpider, legJoints */

/** Neon colors for legs and torn pieces: cyan, magenta, violet, amber. */
var CRAWLER_PALETTE = ["#55dcf2", "#e45cc0", "#9a82ff", "#ffb547"];

/**
 * Where each leg wants its foot, relative to the body, in units of reach.
 * `f` is how far forward, `l` how far out to the side. Index 0 is the front leg.
 */
var LEG_REACH_SCALE = [1.5, 1.05, 1, 1.2];
var LEG_ANGLES = [30, 70, 110, 150].map(function (degrees) { return degrees * Math.PI / 180; });

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
    roamWait: 0,
    locomotion: "pause",
    phaseRemaining: 0.18,
    gaitPhase: 1,
    gaitGroup: 1,
    bob: 0,
    lean: 0
  };

  // Eight feet. `group` splits them into the two sets of an alternating
  // tetrapod gait: L1 R2 L3 R4 step together, then R1 L2 R3 L4.
  for (var s = -1; s <= 1; s += 2) {
    for (var i = 0; i < 4; i++) {
      c.feet.push({
        side: s,
        i: i,
        group: (i + (s > 0 ? 1 : 0)) % 2,
        x: 0, y: 0, z: 0, vx: 0, vy: 0,
        stanceX: 0, stanceY: 0, stanceFromX: 0, stanceFromY: 0,
        fromX: 0, fromY: 0, toX: 0, toY: 0,
        t: 1,
        dur: 0.15,
        swing: false,
        probing: false,
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

  /** Front legs are longer; stance, stepping and drawing use the same reach. */
  c.legReach = function (f) {
    return c.reach() * LEG_REACH_SCALE[f.i];
  };

  /** Coxae spread along the cephalothorax rim, with the front pair forward. */
  c.hip = function (f) {
    var angle = LEG_ANGLES[f.i];
    var fw = (6 + 13 * Math.cos(angle)) * c.size;
    var lat = f.side * 11 * Math.sin(angle) * c.size;
    return { x: c.x + Math.cos(c.a) * fw - Math.sin(c.a) * lat,
      y: c.y + Math.sin(c.a) * fw + Math.cos(c.a) * lat, z: 8 * c.size + c.bob };
  };

  // Let distal legs sweep fore/aft while keeping feet beside the body.
  // The raised knee envelope keeps the lower joints within bone reach.
  function reachable(f, x, y) {
    var fx = Math.cos(c.a);
    var fy = Math.sin(c.a);
    var dx = x - c.x - fx * 6 * c.size;
    var dy = y - c.y - fy * 6 * c.size;
    var fw = dx * fx + dy * fy;
    var lat = (-dx * fy + dy * fx) * f.side;
    var r = c.legReach(f);
    var distance = clamp(Math.hypot(fw, lat), r * 0.35, r * 1.2);
    // Broader sectors let planted same-group shins cross during turns.
    var margin = 45 * Math.PI / 180;
    var minSide = Math.asin(Math.min(1, 20 * c.size / distance));
    var angle = clamp(Math.atan2(lat, fw), Math.max(LEG_ANGLES[f.i] - margin, minSide),
      Math.min(LEG_ANGLES[f.i] + margin, Math.PI - minSide));
    fw = Math.cos(angle) * distance;
    lat = Math.sin(angle) * distance * f.side;
    var candidate = { x: c.x + fx * (fw + 6 * c.size) - fy * lat,
      y: c.y + fy * (fw + 6 * c.size) + fx * lat };
    var hip = c.hip(f);
    var kneeForward = Math.sqrt(Math.max(0, Math.pow(r * 0.55, 2) - Math.pow(r * 0.38 - hip.z, 2)));
    var direction = c.a + f.side * LEG_ANGLES[f.i];
    var kx = hip.x + Math.cos(direction) * kneeForward;
    var ky = hip.y + Math.sin(direction) * kneeForward;
    var span = Math.hypot(candidate.x - kx, candidate.y - ky);
    if (span > r * 0.68) {
      candidate.x = kx + (candidate.x - kx) * r * 0.68 / span;
      candidate.y = ky + (candidate.y - ky) * r * 0.68 / span;
    }
    return candidate;
  }

  function foothold(f, x, y, radius) {
    var target = reachable(f, x, y);
    var hold = host.footholdNear(target.x, target.y, radius);
    if (hold) {
      var safe = reachable(f, hold.x, hold.y);
      if (Math.hypot(safe.x - hold.x, safe.y - hold.y) < 0.001) return hold;
    }
    return { x: target.x, y: target.y, chunk: null };
  }

  /** Where a foot would rest if the spider stood still right now. */
  c.idealFoot = function (f) {
    var r = c.legReach(f);
    var fx = Math.cos(c.a);
    var fy = Math.sin(c.a);
    var fw = 6 * c.size + Math.cos(LEG_ANGLES[f.i]) * r;
    var lat = f.side * Math.sin(LEG_ANGLES[f.i]) * r;
    return { x: c.x + fx * fw - fy * lat, y: c.y + fy * fw + fx * lat };
  };

  /** Rigid pose fitted to the fixed world anchors and pushing stance legs. */
  c.poseFromStance = function () {
    var px = 0, py = 0, lx = 0, ly = 0, count = 0;
    var n;
    for (n = 0; n < c.feet.length; n++) {
      var f = c.feet[n];
      if (f.group === c.gaitGroup) continue;
      px += f.x; py += f.y; lx += f.stanceX; ly += f.stanceY; count++;
    }
    px /= count; py /= count; lx /= count; ly /= count;
    var dot = 0, cross = 0;
    for (n = 0; n < c.feet.length; n++) {
      var support = c.feet[n];
      if (support.group === c.gaitGroup) continue;
      var qx = support.stanceX - lx;
      var qy = support.stanceY - ly;
      var wx = support.x - px;
      var wy = support.y - py;
      dot += qx * wx + qy * wy;
      cross += qx * wy - qy * wx;
    }
    var a = Math.atan2(cross, dot);
    return { x: px - Math.cos(a) * lx + Math.sin(a) * ly,
      y: py - Math.sin(a) * lx - Math.cos(a) * ly, a: a };
  };

  /** Put every foot straight down on the nearest foothold, no animation. */
  c.plantAll = function () {
    for (var k = 0; k < c.feet.length; k++) {
      var f = c.feet[k];
      var id = c.idealFoot(f);
      var hold = foothold(f, id.x, id.y, c.legReach(f) * 0.6);
      f.x = hold ? hold.x : id.x;
      f.y = hold ? hold.y : id.y;
      f.chunk = hold ? hold.chunk : null;
      f.swing = false;
      f.z = 0;
      f.probing = false;
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
    c.locomotion = "pause";
    c.phaseRemaining = 0.18;
    c.gaitPhase = 1;
    c.bob = c.lean = 0;
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
    if (typeof host.roamTarget === "function") {
      var preferred = host.roamTarget(c.x, c.y, c.reach());
      if (preferred && !outOfBounds(preferred)) {
        c.roam = preferred;
        c.roamWait = 0.2 + Math.random() * 1.4;
        return;
      }
    }
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
    var hold = foothold(f, px, py, c.legReach(f) * 0.55);
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

    // 2. Variable bursts and pauses, with motion driven by the leg cycle.
    dt = Math.max(0.0001, Math.min(dt, 1 / 30));
    var dx = tx - c.x;
    var dy = ty - c.y;
    var d = Math.hypot(dx, dy);
    var commanded = !!c.tap || (c.mode === "follow" && !!c.pointer);
    if (commanded && c.locomotion === "pause") c.phaseRemaining = Math.min(c.phaseRemaining, 0.05);
    c.phaseRemaining = Math.max(0, c.phaseRemaining - dt);
    if (c.phaseRemaining === 0 && c.gaitPhase >= 1) {
      c.locomotion = c.locomotion === "pause" ? "burst" : "pause";
      c.phaseRemaining = c.locomotion === "burst" ? 0.9 + Math.random() * 1.1 : (commanded ? 0.025 + Math.random() * 0.025 : 0.15 + Math.random() * 0.23);
    }
    var heading = d > 6 ? Math.atan2(dy, dx) : c.a;
    var maxV = Math.min(180 + 60 * c.size, d * 2.5) * 2;
    var duration = (0.18 + 0.04 * c.size) * 0.45;
    var n;
    // Start exactly one tetrapod. The other four feet remain planted.
    if (c.gaitPhase >= 1 && c.locomotion === "burst" && d > 6 && c.phaseRemaining > 0) {
      c.gaitPhase = 0;
      c.gaitGroup = 1 - c.gaitGroup;
      c.pushX = Math.cos(heading - c.a) * maxV * duration * 2 / Math.PI;
      c.pushY = Math.sin(heading - c.a) * maxV * duration * 2 / Math.PI;
      c.pushTurn = clamp(angleDelta(c.a, heading), -1.5 * duration * 2 / Math.PI, 1.5 * duration * 2 / Math.PI);
      c.pushProgress = 0;
      for (n = 0; n < c.feet.length; n++) {
        var moving = c.feet[n];
        if (moving.group !== c.gaitGroup) {
          var wx = moving.x - c.x;
          var wy = moving.y - c.y;
          moving.stanceFromX = moving.stanceX = wx * Math.cos(c.a) + wy * Math.sin(c.a);
          moving.stanceFromY = moving.stanceY = -wx * Math.sin(c.a) + wy * Math.cos(c.a);
          continue;
        }
        var target = c.idealFoot(moving);
        lift(moving, target.x + Math.cos(heading) * maxV * duration,
          target.y + Math.sin(heading) * maxV * duration, maxV);
        moving.dur = duration;
      }
    }
    var cycling = c.gaitPhase < 1;
    var pulse = cycling ? Math.sin(Math.PI * c.gaitPhase) : 0;
    var oldX = c.x;
    var oldY = c.y;
    var oldA = c.a;
    if (cycling) {
      // The stance feet push backward in body coordinates. Fit the body to
      // those fixed anchors; there is no independently integrated body speed.
      var progress = (1 - Math.cos(Math.PI * c.gaitPhase)) / 2;
      var turn = c.pushTurn * progress;
      var cos = Math.cos(-turn);
      var sin = Math.sin(-turn);
      for (n = 0; n < c.feet.length; n++) {
        var leg = c.feet[n];
        if (leg.group === c.gaitGroup) continue;
        var localX = leg.stanceFromX - c.pushX * progress;
        var localY = leg.stanceFromY - c.pushY * progress;
        leg.stanceX = localX * cos - localY * sin;
        leg.stanceY = localX * sin + localY * cos;
      }
      var pose = c.poseFromStance();
      c.x = pose.x; c.y = pose.y; c.a = pose.a;
      var legal = true;
      for (n = 0; n < c.feet.length; n++) {
        var support = c.feet[n];
        if (support.group === c.gaitGroup) continue;
        var check = reachable(support, support.x, support.y);
        if (Math.hypot(check.x - support.x, check.y - support.y) >= 0.001) legal = false;
      }
      if (!legal) {
        c.x = oldX; c.y = oldY; c.a = oldA;
        // Keep local support coordinates consistent with the accepted pose.
        for (n = 0; n < c.feet.length; n++) {
          var fixed = c.feet[n];
          if (fixed.group === c.gaitGroup) continue;
          var sx = fixed.x - c.x;
          var sy = fixed.y - c.y;
          fixed.stanceX = sx * Math.cos(c.a) + sy * Math.sin(c.a);
          fixed.stanceY = -sx * Math.sin(c.a) + sy * Math.cos(c.a);
        }
      } else c.pushProgress = progress;
    }
    c.vx = (c.x - oldX) / dt;
    c.vy = (c.y - oldY) / dt;
    c.bob = cycling ? pulse * 1.2 * c.size : 0;
    c.lean = cycling ? angleDelta(oldA, c.a) * 0.35 : 0;

    // 3. Reach, then tap/test the foothold before transferring weight.
    if (cycling) c.gaitPhase = Math.min(1, c.gaitPhase + dt / duration);
    for (n = 0; n < c.feet.length; n++) {
      var f = c.feet[n];
      if (f.swing) {
        f.t = c.gaitPhase;
        f.probing = f.t >= 0.8 && f.t < 1;
        f.z = f.t < 0.8 ? Math.sin(Math.PI * f.t / 0.8) * 12 * c.size
          : Math.sin((f.t - 0.8) / 0.2 * Math.PI) * 1.5 * c.size;
        var e = easeInOut(Math.min(1, f.t / 0.8));
        var tap = f.probing ? Math.sin((f.t - 0.8) / 0.2 * Math.PI * 2) * 2 * c.size : 0;
        var next = reachable(f, f.fromX + (f.toX - f.fromX) * e - Math.sin(c.a) * tap * f.side,
          f.fromY + (f.toY - f.fromY) * e + Math.cos(c.a) * tap * f.side);
        f.vx = (next.x - f.x) / dt;
        f.vy = (next.y - f.y) / dt;
        f.x = next.x;
        f.y = next.y;
        if (f.carry && f.t >= f.releaseAt) release(f);
        if (f.t >= 1) {
          f.swing = false;
          f.z = 0;
          f.probing = false;
          f.vx = f.vy = 0;
          // Grip the real host surface at the tested endpoint.
          var hold = foothold(f, f.x, f.y, c.legReach(f) * 0.15);
          f.x = hold.x;
          f.y = hold.y;
          f.chunk = hold.chunk;
        }
      } else {
        // Size changes are external to locomotion: replant a displaced foot,
        // without calling that a walking step or moving the body.
        var safe = reachable(f, f.x, f.y);
        if (Math.hypot(safe.x - f.x, safe.y - f.y) > 0.001) {
          f.x = safe.x;
          f.y = safe.y;
          f.chunk = null;
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
 * Three bones in each leg's vertical radial plane: raised femur/patella,
 * then a long tibia descending to the foot. Project height only at drawing;
 * world-space planted anchors remain fixed. Cached points avoid frame garbage.
 */
function legJoints(c, f) {
  var points = f.joints || (f.joints = [{}, {}, {}, {}]);
  var hip = c.hip(f);
  var r = c.legReach(f);
  var upper = r * 0.55;
  var middle = r * 0.25;
  var tip = r * 0.6;
  var dx = f.x - hip.x;
  var dy = f.y - hip.y;
  var horizontal = Math.hypot(dx, dy) || 0.001;
  var ux = Math.cos(c.a + f.side * LEG_ANGLES[f.i]);
  var uy = Math.sin(c.a + f.side * LEG_ANGLES[f.i]);
  var footZ = f.z || 0;
  var kneeZ = r * 0.38 + footZ * 0.8;
  // Upper legs stay directed from their separate coxae; the lower joints
  // fold through the stride rather than bunching the roots together.
  var kneeForward = Math.sqrt(Math.max(0, upper * upper - Math.pow(kneeZ - hip.z, 2)));
  var kneeX = hip.x + ux * kneeForward;
  var kneeY = hip.y + uy * kneeForward;
  var endX = f.x - kneeX;
  var endY = f.y - kneeY;
  var endZ = footZ - kneeZ;
  var d = Math.hypot(endX, endY, endZ);
  // Folded and extended strides must remain solvable by the two lower bones.
  if (d < Math.abs(tip - middle) || d > tip + middle) {
    var lower = clamp(d, Math.abs(tip - middle) + r * 0.001, tip + middle - r * 0.001);
    var hz = footZ - hip.z;
    var span = Math.hypot(horizontal, hz);
    var axial = (upper * upper - lower * lower + span * span) / (2 * span);
    var arch = Math.sqrt(Math.max(0, upper * upper - axial * axial));
    kneeX = hip.x + dx / horizontal * (horizontal / span * axial - hz / span * arch);
    kneeY = hip.y + dy / horizontal * (horizontal / span * axial - hz / span * arch);
    kneeZ = hip.z + hz / span * axial + horizontal / span * arch;
    endX = f.x - kneeX; endY = f.y - kneeY; endZ = footZ - kneeZ;
    d = Math.hypot(endX, endY, endZ);
  }
  var along = (middle * middle - tip * tip + d * d) / (2 * d);
  var h = Math.sqrt(Math.max(0, middle * middle - along * along));
  var ex = endX / d;
  var ey = endY / d;
  var ez = endZ / d;
  // Of the possible patella positions, choose the raised arch. The vector
  // below is vertical projected onto the plane perpendicular to knee->foot.
  var px = -ex * ez;
  var py = -ey * ez;
  var pz = 1 - ez * ez;
  var plen = Math.hypot(px, py, pz) || 1;
  var ankleX = kneeX + ex * along + px / plen * h;
  var ankleY = kneeY + ey * along + py / plen * h;
  var ankleZ = kneeZ + ez * along + pz / plen * h;
  points[0].x = hip.x; points[0].y = hip.y; points[0].z = hip.z;
  points[1].x = kneeX; points[1].y = kneeY; points[1].z = kneeZ;
  points[2].x = ankleX; points[2].y = ankleY; points[2].z = ankleZ;
  points[3].x = f.x; points[3].y = f.y; points[3].z = footZ;
  return points;
}

/** Round the segment profile without moving its anatomical endpoints. */
function curvedBone(ctx, a, b, width, bow) {
  var ay = a.y - a.z * 0.2;
  var by = b.y - b.z * 0.2;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, ay);
  ctx.quadraticCurveTo((a.x + b.x) / 2, (ay + by) / 2 - bow, b.x, by);
  ctx.stroke();
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
  var fx = Math.cos(c.a);
  var fy = Math.sin(c.a);
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

  // Occlude legs beneath the translucent abdomen without painting over the page.
  // Opposite winding makes the abdomen a hole in the leg drawing region.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(c.x - 10000 * s, c.y - 10000 * s);
  ctx.lineTo(c.x + 10000 * s, c.y - 10000 * s);
  ctx.lineTo(c.x + 10000 * s, c.y + 10000 * s);
  ctx.lineTo(c.x - 10000 * s, c.y + 10000 * s);
  ctx.lineTo(c.x - 10000 * s, c.y - 10000 * s);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a + c.lean);
  var bodyScale = 1 + c.bob / s * 0.008;
  ctx.scale(bodyScale, bodyScale * 17 / 19);
  ctx.moveTo(-s, 0);
  ctx.arc(-20 * s, 0, 19 * s, 0, Math.PI * 2, true);
  ctx.restore();
  ctx.clip();

  // Legs: hip -> knee -> ankle -> foot, using the shared three-segment IK.
  for (var n = 0; n < c.feet.length; n++) {
    var f = c.feet[n];
    var bones = legJoints(c, f);
    var joints = f.projectedJoints || (f.projectedJoints = [{}, {}, {}, {}]);
    var centerX = c.x + fx * 6 * s;
    var centerY = c.y + fy * 6 * s;
    for (var q = 0; q < 4; q++) {
      // Orthographic top view: height foreshortens within each leg's fan,
      // so raised knees never sweep across a neighbouring leg on a turn.
      var jx = bones[q].x - centerX;
      var jy = bones[q].y - centerY;
      var distance = Math.hypot(jx, jy) || 1;
      var foreshorten = Math.max(0.5, 1 - bones[q].z * 0.15 / distance);
      joints[q].x = centerX + jx * foreshorten;
      joints[q].y = centerY + jy * foreshorten;
      joints[q].z = 0;
    }
    var hip = joints[0];
    var knee = joints[1];
    var ankle = joints[2];
    var legColor = theme.legs ? theme.legs[f.i] : theme.ink;
    ctx.strokeStyle = legColor;
    ctx.fillStyle = legColor;
    // Femur and short rounded patella rise; tibia tapers to the planted toe.
    curvedBone(ctx, hip, knee, 2.5 * s, 0);
    curvedBone(ctx, knee, ankle, 2.1 * s, 2 * s);
    curvedBone(ctx, ankle, joints[3], 1.2 * s, 1 * s);
    // Small joint highlights, rather than the old mechanical hinge dots.
    ctx.fillStyle = legColor;
    for (var j = 1; j <= 2; j++) {
      ctx.beginPath();
      ctx.arc(joints[j].x, joints[j].y - joints[j].z * 0.2, 1.4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    if (f.swing && f.z > 2 * s) {
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.8 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(joints[3].x, joints[3].y, 1.6 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Translucent round abdomen, cephalothorax, red hourglass and eyes.
  ctx.save();
  ctx.translate(c.x, c.y);
  var breathe = 1 + c.bob / s * 0.008;
  ctx.scale(breathe, breathe);
  ctx.rotate(c.a + c.lean);
  ctx.strokeStyle = theme.ink;
  ctx.fillStyle = theme.fill;
  ctx.lineWidth = 1.7 * s;
  bodyPath(ctx, s);
  ctx.globalAlpha = 0.25;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.shadowColor = "#ff304b";
  ctx.shadowBlur = 6 * s;
  ctx.fillStyle = "#ff304b";
  ctx.strokeStyle = "#ff304b";
  ctx.beginPath();
  ctx.moveTo(-29 * s, -7 * s);
  ctx.lineTo(-11 * s, -7 * s);
  ctx.lineTo(-20 * s, 0);
  ctx.lineTo(-11 * s, 7 * s);
  ctx.lineTo(-29 * s, 7 * s);
  ctx.lineTo(-20 * s, 0);
  ctx.lineTo(-29 * s, -7 * s);
  ctx.globalAlpha = 0.25;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.shadowColor = theme.accent;
  ctx.fillStyle = theme.eyes || theme.accent;
  for (var e = -1; e <= 1; e += 2) {
    ctx.beginPath();
    ctx.arc(17 * s, e * 2.4 * s, 1.4 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

/** Joined silhouette: only the exterior arcs of the two overlapping ellipses. */
function bodyPath(ctx, s) {
  // Their intersection is x=-3.13383254, giving these ellipse angles.
  var abdomenAngle = 0.47848603358321723;
  var headAngle = 2.3498445969823814;
  ctx.beginPath();
  ctx.save();
  ctx.translate(-20 * s, 0);
  ctx.scale(1, 17 / 19);
  ctx.arc(0, 0, 19 * s, abdomenAngle, Math.PI * 2 - abdomenAngle);
  ctx.restore();
  ctx.save();
  ctx.translate(6 * s, 0);
  ctx.scale(1, 11 / 13);
  ctx.arc(0, 0, 13 * s, -headAngle, headAngle);
  ctx.restore();
  ctx.closePath();
}
