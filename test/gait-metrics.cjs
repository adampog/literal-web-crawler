// Diagnostic only: no engine source is altered. Usage: node measure.cjs repo output.json
const core = require('./load-core').loadCore('crawler.js');
const deg = 180 / Math.PI;
const delta = (a,b) => Math.atan2(Math.sin(b-a),Math.cos(b-a));
function scenario(name) {
  let seed=12345; Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
  const c=core.createCrawler({footholdNear:()=>null,tearOff(){},removePiece(){},bounds:()=>({left:-10000,top:-10000,right:10000,bottom:10000})});
  c.ripRate=0; c.placeAt(0,0); c.mode='follow';
  const lateral=name.startsWith('side');
  const held=lateral&&!name.endsWith('-free');
  // Hold orientation through the public stance-fit seam, cancelling only commanded
  // rotation. Body translation is still solved from four planted anchors.
  if(held) { const fit=c.poseFromStance; c.poseFromStance=function(){this.pushTurn=0; const p=fit(); p.a=-Math.PI/2; return p;}; }
  const stats=c.feet.map(()=>({angle:[],knee:[],extension:[],swingDirection:[],stride:[],plantedSpeed:[],phase:[],flips:0,steps:0,slide:0,lift:0}));
  let prev=c.feet.map(f=>({x:f.x,y:f.y,swing:false,angle:0,bend:0}));
  const frames=[];
  for(let frame=0;frame<900;frame++) {
    if(name==='pan')c.setPointer(c.x+(Math.floor(frame/30)%2?-500:500),c.y);
    else if(lateral)c.setPointer((name.includes('left')?-1:1)*(500+200*frame/60),0);
    else c.setPointer(0,-500-200*frame/60);
    const ox=c.x,oy=c.y; c.step(1/60);
    c.feet.forEach((f,i)=>{
      const p=prev[i],o=stats[i],j=core.legJoints(c,f).map(v=>({...v}));
      const fw=(f.x-c.x)*Math.cos(c.a)+(f.y-c.y)*Math.sin(c.a)-6*c.size;
      const lat=(-(f.x-c.x)*Math.sin(c.a)+(f.y-c.y)*Math.cos(c.a))*f.side;
      const a=Math.atan2(lat,fw);
      const v={x:j[0].x-j[1].x,y:j[0].y-j[1].y-(j[0].z-j[1].z)*.2};
      const w={x:j[2].x-j[1].x,y:j[2].y-j[1].y-(j[2].z-j[1].z)*.2};
      const bend=Math.sign(v.x*w.y-v.y*w.x);
      if(frame>=120){
        o.angle.push(a*deg);o.knee.push(Math.acos(Math.max(-1,Math.min(1,(v.x*w.x+v.y*w.y)/(Math.hypot(v.x,v.y)*Math.hypot(w.x,w.y)))))*deg);
        o.extension.push(Math.hypot(f.x-j[0].x,f.y-j[0].y)/c.legReach(f));
        if(bend&&p.bend&&bend!==p.bend)o.flips++;
        if(f.swing&&!p.swing){o.steps++;const front=c.feet.filter(v=>v.group===f.group&&v.i<2);const mean=front.reduce((sum,v)=>sum+Math.hypot(v.toX-v.fromX,v.toY-v.fromY),0)/front.length;o.stride.push(Math.hypot(f.toX-f.fromX,f.toY-f.fromY)/mean);o.phase.push(Number(f.group!==c.gaitGroup));}
        const travel=Math.hypot(c.x-ox,c.y-oy),swing=Math.hypot(f.x-p.x,f.y-p.y);
        if(f.swing&&p.swing&&travel>.01&&swing>.01)o.swingDirection.push(Math.abs(delta(Math.atan2(c.y-oy,c.x-ox),Math.atan2(f.y-p.y,f.x-p.x)))*deg);
        if(!f.swing&&!p.swing){o.plantedSpeed.push(Math.abs(delta(p.angle,a))*deg*60);o.slide+=swing;}
        if(f.swing)o.lift=Math.max(o.lift,f.z);
      }
      prev[i]={x:f.x,y:f.y,swing:f.swing,angle:a,bend};
    });
    if([120,125,130,135,140,145,150,155].includes(frame))frames.push({frame,x:c.x,y:c.y,a:c.a,feet:c.feet.map(f=>({i:f.i,side:f.side,x:f.x,y:f.y,z:f.z,swing:f.swing,joints:core.legJoints(c,f).map(v=>({...v}))}))});
  }
  return {seconds:13,pointerSpeed:200,headingHeld:held,legs:stats.map((o,i)=>{
    const r={leg:i%4+1,side:i<4?'L':'R',stepsPerSecond:o.steps/13,flips:o.flips,slide:o.slide,lift:o.lift};
    for(const k of ['angle','knee','extension','swingDirection','stride','plantedSpeed','phase'])r[k]=o[k].length?[Math.min(...o[k]),Math.max(...o[k])]:null;
    return r;
  }),frames};
}
module.exports={scenario};
