/**
 * Build koilib ABI objects from the contract proto files.
 * Run: node scripts/build-abi.mjs
 *
 * Entry point = first 4 bytes of SHA-256(method name), as an unsigned integer.
 * That is the same rule deploy/deploy.js relies on after the contract build.
 * koilib reads addresses from the (koinos.btype) = ADDRESS option, which
 * protobufjs keeps when it parses the proto.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import protobuf from "protobufjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repo = path.resolve(webDir, "..");

export function entryPoint(name) {
  return crypto.createHash("sha256").update(name).digest().readUInt32BE(0);
}

export function parseMethods(protoText, packageName) {
  const methods = {};
  let description = "";
  let readOnly = false;
  let result = "";
  let sawAnnotation = false;
  for (const line of protoText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const desc = trimmed.match(/^\/\/\s*@description\s+(.*)$/);
    if (desc) {
      description = desc[1].trim();
      sawAnnotation = true;
      continue;
    }
    const ro = trimmed.match(/^\/\/\s*@read-only\s+(true|false)\b/);
    if (ro) {
      readOnly = ro[1] === "true";
      sawAnnotation = true;
      continue;
    }
    const res = trimmed.match(/^\/\/\s*@result\s+(\w+)/);
    if (res) {
      result = res[1];
      sawAnnotation = true;
      continue;
    }
    if (trimmed.startsWith("//")) continue;
    const msg = trimmed.match(/^message\s+(\w+)_arguments\b/);
    if (msg && sawAnnotation) {
      const name = msg[1];
      const method = {
        entry_point: entryPoint(name),
        argument: packageName + "." + name + "_arguments",
        return: result ? packageName + "." + result : "",
        read_only: readOnly,
        description,
      };
      if (result === "uint64") method.default_output = { value: "0" };
      if (result === "uint32") method.default_output = { value: 0 };
      if (result === "boole") method.default_output = { value: false };
      if (result === "str") method.default_output = { value: "" };
      methods[name] = method;
    }
    description = "";
    readOnly = false;
    result = "";
    sawAnnotation = false;
  }
  return methods;
}

function repoPath(rel) {
  return path.join(repo, rel);
}

function loadRoot(rel) {
  const root = new protobuf.Root();
  root.resolvePath = (origin, target) => {
    // An absolute path is already resolved. Joining it again doubles the prefix.
    if (path.isAbsolute(target)) return target;
    if (target.startsWith("google/") || target.startsWith("koinos/")) return repoPath(target);
    if (origin) return path.join(path.dirname(origin), target);
    return repoPath(target);
  };
  root.loadSync(repoPath(rel), { keepCase: true });
  return root;
}

export function buildAbi(rel) {
  const text = fs.readFileSync(path.join(repo, rel), "utf8");
  const packageMatch = text.match(/^\s*package\s+(\w+)\s*;/m);
  if (!packageMatch) throw new Error("No package in " + rel);
  const packageName = packageMatch[1];
  const root = loadRoot(rel);
  const json = root.toJSON();
  const pkg = json.nested && json.nested[packageName];
  if (!pkg) throw new Error("protobufjs did not load package " + packageName);
  const methods = parseMethods(text, packageName);
  if (!Object.keys(methods).length) throw new Error("No methods in " + rel);
  return {
    methods,
    koilib_types: { nested: { [packageName]: pkg } },
  };
}

const SOURCES = {
  ink: "assembly/proto/ink.proto",
  shop: "shop/assembly/proto/shop.proto",
  stories: "stories/assembly/proto/stories.proto",
  sponsor: "sponsor/assembly/proto/sponsor.proto",
  multisig: "multisig/assembly/proto/multisig.proto",
  editions: "editions/assembly/proto/editions.proto",
};

export function buildAll() {
  const abis = {};
  for (const name of Object.keys(SOURCES)) abis[name] = buildAbi(SOURCES[name]);
  return abis;
}

function isMain() {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const abis = buildAll();
  const outDir = path.join(webDir, "src", "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "abis.js");
  const body = "/* Generated from the contract proto files. Do not edit. */\nexport const abis = " +
    JSON.stringify(abis) + ";\n";
  fs.writeFileSync(out, body);
  const bytes = Buffer.byteLength(body);
  console.log("Wrote " + path.relative(repo, out) + " (" + bytes + " bytes)");
  console.log("stories.contribute entry " + abis.stories.methods.contribute.entry_point);
  console.log("ink.balance_of entry " + abis.ink.methods.balance_of.entry_point);
}
