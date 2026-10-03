// Loads the core/ scripts the way a browser or QML would: as plain scripts
// sharing one global scope. Returns that scope.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCore(...files) {
  const context = vm.createContext({ Math, Float32Array, Uint8Array, Infinity, JSON });
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, "..", "core", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

module.exports = { loadCore };
