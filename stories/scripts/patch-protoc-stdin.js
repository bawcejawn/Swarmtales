/**
 * The Koinos protoc plugins read all of stdin with fs.readFileSync(fd).
 * On Node.js 20 and later that file descriptor is non-blocking, so the read
 * throws EAGAIN when the request has not arrived yet and the build stops.
 *
 * This rewrites those three installed plugins to wait and retry. It is
 * idempotent: running it twice does not double-patch a file.
 */
const fs = require("fs");
const path = require("path");

const FILES = [
  "node_modules/@koinos/as-proto-gen/lib/index.js",
  "node_modules/@koinos/as-gen/lib/index.js",
  "node_modules/@koinos/abi-proto-gen/lib/index.js",
];

const HELPER = `
function __readStdinSync() {
  const __fs = require("fs");
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n = 0;
    try {
      n = __fs.readSync(process.stdin.fd, buf, 0, buf.length, null);
    } catch (err) {
      if (err && err.code === "EAGAIN") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        continue;
      }
      throw err;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}
`;

const NEEDLE = "fs.readFileSync(process.stdin.fd)";

let patched = 0;
for (const rel of FILES) {
  const file = path.join(__dirname, "..", rel);
  if (!fs.existsSync(file)) {
    console.log("skip (not installed): " + rel);
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  if (src.includes("function __readStdinSync(")) {
    console.log("already patched: " + rel);
    continue;
  }
  if (!src.includes(NEEDLE)) {
    console.log("no stdin read to patch: " + rel);
    continue;
  }
  const next = src.replace(NEEDLE, "__readStdinSync()").replace('"use strict";', '"use strict";' + HELPER);
  fs.writeFileSync(file, next);
  patched++;
  console.log("patched: " + rel);
}

if (patched === 0 && !FILES.some((rel) => fs.existsSync(path.join(__dirname, "..", rel)))) {
  console.log("Koinos protoc plugins are not installed yet.");
  process.exit(0);
}
