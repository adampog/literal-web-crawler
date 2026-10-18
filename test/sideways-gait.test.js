const test = require('node:test');
const assert = require('node:assert/strict');
const { scenario } = require('./gait-metrics.cjs');
const { loadCore } = require('./load-core');
const { createHash } = require('node:crypto');

// Measured on 410cfa2 before implementation; pooled left/right straight ranges.
// Angular tolerance=max(3 degrees,5% width). Other units use 5% width.
const reference = {
  3: {angle:[84.6042806948,120.541876951],knee:[116.312817495,179.936646928],extension:[0.750141459366,0.885020460018],swingDirection:[0,43.9734312091],stride:[0.934895066227,1.08163898379],plantedSpeed:[0,426.486263817]},
  4: {angle:[120.068154548,144.300135893],knee:[98.0802997356,179.999970922],extension:[0.597336019044,0.937376977687],swingDirection:[0,43.9734312091],stride:[0.911203790154,1.08163898379],plantedSpeed:[0,266.663295658]}
};
for (const name of ['pan','side-left','side-right','side-left-free','side-right-free']) {
  test(`sideways gait stays in accepted straight envelope: ${name}`, () => {
    const errors=[];
    for (const leg of scenario(name).legs.filter(l=>l.leg>=3)) {
      for (const [metric,[lo,hi]] of Object.entries(reference[leg.leg])) {
        const tolerance=Math.max((hi-lo)*.05,['angle','knee','swingDirection'].includes(metric)?3:0);
        const values=leg[metric];
        if (!values || values[0]<lo-tolerance-1e-8 || values[1]>hi+tolerance+1e-8) {
          errors.push(`${leg.side}${leg.leg} ${metric}=${JSON.stringify(values)}, expected ${lo-tolerance}..${hi+tolerance}`);
        }
      }
      assert.equal(leg.phase[1],0,'tetrapod group offset');
      assert.ok(Math.abs(leg.stepsPerSecond-4.846153846153846)<=4.846153846153846*.05,'cadence outside 5% straight reference');
      assert.ok(leg.flips<=127*1.05,'more projected knee bend flips than straight');
      assert.ok(leg.slide<1,'rear planted feet must not slide');
      assert.ok(leg.lift>0,'swing lifts');
    }
    assert.equal(errors.join('\n'),'');
  });
}

test('straight gait metrics for all eight legs and sampled poses remain exactly 410cfa2', () => {
  const expected = require('./fixtures/straight-410cfa2.json');
  const actual = scenario('straight');
  assert.equal(JSON.stringify(actual.legs), JSON.stringify(expected.legs));
  assert.equal(createHash('sha256').update(JSON.stringify(actual.frames)).digest('hex'),expected.poseHash);
});

test('lateral and straight handover stays in one tetrapod cycle with fixed stance feet', () => {
  const core = loadCore('crawler.js');
  const savedRandom = Math.random;
  let seed = 12345;
  Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  try {
    const c = core.createCrawler({footholdNear:()=>null,tearOff(){},removePiece(){},bounds:()=>({left:-10000,top:-10000,right:10000,bottom:10000})});
    c.ripRate = 0; c.mode = 'follow'; c.placeAt(0,0);
    let lateral = false, returned = false;
    for (let frame=0;frame<1500;frame++) {
      const direction = c.a + (frame>=120 && frame<720 ? Math.PI/2 : 0);
      c.setPointer(c.x+Math.cos(direction)*500,c.y+Math.sin(direction)*500);
      const phase = c.gaitPhase, group = c.gaitGroup, x = c.x, y = c.y;
      const feet = c.feet.map(f=>({x:f.x,y:f.y,swing:f.swing}));
      c.step(1/60);
      if (c.sidestep>.9) lateral = true;
      if (frame>720 && lateral && c.sidestep<.001) returned = true;
      const starts = c.feet.filter((f,i)=>f.swing&&!feet[i].swing);
      if (starts.length) {
        assert.equal(starts.length,4);
        assert.equal(phase,1,'no extra step during a running cycle');
        assert.equal(c.gaitGroup,1-group);
      }
      assert.ok(Math.hypot(c.x-x,c.y-y)<c.reach()*.2,'body handover snaps');
      c.feet.forEach((f,i)=>{
        const distance = Math.hypot(f.x-feet[i].x,f.y-feet[i].y);
        assert.ok(distance<c.legReach(f)*.4,'foot handover snaps');
        if (!f.swing&&!feet[i].swing) assert.ok(distance<1,'stance foot slides at handover');
      });
    }
    assert.ok(lateral&&returned,'exercise both mode boundaries');
  } finally { Math.random = savedRandom; }
});
