const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("manifest validation rejects a package version mismatch", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"crawler-manifest-"));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,"scripts"));
  fs.copyFileSync(path.join(__dirname,"../scripts/validate-manifest.js"),path.join(dir,"scripts/validate-manifest.js"));
  fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify({schemaVersion:1,id:"test.crawler",name:"Crawler",version:"1.1.6",
    author:"test",license:"MIT",description:"fixture",kinds:["overlay"],entryPoints:{overlay:"Crawler.qml"}}));
  fs.writeFileSync(path.join(dir,"Crawler.qml"),"");
  for (const version of ["1.1.6","1.1.5"]) {
    fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({version}));
    const result = spawnSync(process.execPath,[path.join(dir,"scripts/validate-manifest.js")],{encoding:"utf8"});
    assert.equal(result.status,version === "1.1.6" ? 0 : 1,result.stdout + result.stderr);
    if (version !== "1.1.6") assert.match(result.stderr,/version.*package\.json/i);
  }
});
