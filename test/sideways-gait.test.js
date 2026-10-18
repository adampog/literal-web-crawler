const test = require('node:test');
const assert = require('node:assert/strict');
const { scenario } = require('./gait-metrics.cjs');

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
        if (!values || values[0]<lo-tolerance-1e-8 || values[1]>hi+tolerance+1e-8)
          errors.push(`${leg.side}${leg.leg} ${metric}=${JSON.stringify(values)}, expected ${lo-tolerance}..${hi+tolerance}`);
      }
      assert.equal(leg.phase[1],0,'tetrapod group offset');
      assert.ok(leg.slide<1,'rear planted feet must not slide');
      assert.ok(leg.lift>0,'swing lifts');
    }
    assert.equal(errors.join('\n'),'');
  });
}
