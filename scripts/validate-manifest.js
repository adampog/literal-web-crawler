// Mirrors the checks `omarchy plugin validate` runs, so CI can catch a broken
// manifest without an Omarchy machine: valid JSON, required fields, kinds and
// entry points agree, referenced files exist, no reserved id, no symlinks.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const ENTRY_KEYS = {
  "bar-widget": "barWidget",
  bar: "bar",
  panel: "panel",
  overlay: "overlay",
  menu: "menu",
  service: "service"
};
const errors = [];

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
} catch (e) {
  console.error("manifest.json does not parse: " + e.message);
  process.exit(1);
}

if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
for (const field of ["id", "name", "version", "author", "license", "description", "kinds", "entryPoints"]) {
  if (manifest[field] === undefined) errors.push("missing " + field);
}
const id = String(manifest.id || "");
if (id.startsWith("omarchy.")) errors.push("ids starting with omarchy. are reserved");
if (!id || id.includes("/") || id.includes("..")) errors.push("id is not a valid directory name");
if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version))) errors.push("version should be semver");
if (manifest.version !== require("../package.json").version) errors.push("manifest version must match package.json");

if (!Array.isArray(manifest.kinds) || manifest.kinds.length === 0) {
  errors.push("kinds must be a non-empty array");
} else {
  for (const kind of manifest.kinds) {
    const key = ENTRY_KEYS[kind];
    if (!key) {
      errors.push("unknown kind " + kind);
      continue;
    }
    const file = manifest.entryPoints && manifest.entryPoints[key];
    if (!file) errors.push(`kind ${kind} needs entryPoints.${key}`);
    else if (!fs.existsSync(path.join(root, file))) errors.push(`entry point ${file} does not exist`);
  }
}

// QML imports of the shared engine must resolve too.
for (const qml of fs.readdirSync(root).filter((f) => f.endsWith(".qml"))) {
  const source = fs.readFileSync(path.join(root, qml), "utf8");
  for (const match of source.matchAll(/^import\s+"([^"]+)"/gm)) {
    if (!fs.existsSync(path.join(root, match[1]))) errors.push(`${qml} imports missing ${match[1]}`);
  }
}

function findSymlinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) errors.push("symlink not allowed: " + path.relative(root, full));
    else if (entry.isDirectory()) findSymlinks(full);
  }
}
findSymlinks(root);

if (errors.length) {
  for (const e of errors) console.error("✗ " + e);
  process.exit(1);
}
console.log(`✓ ${manifest.name} ${manifest.version} (${manifest.kinds.join(", ")}) looks valid`);
