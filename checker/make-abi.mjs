#!/usr/bin/env node
/**
 * Writes checker/stories.abi.json, the Stories ABI the copy checker uses, from
 * stories/assembly/proto/stories.proto, and prints its sha256 for
 * STORIES_ABI_SHA256 in checker/chain.mjs (audit L-12). Run after any change
 * to stories.proto, and have both changes reviewed together:
 *   node checker/make-abi.mjs
 */
import fs from "fs";
import { buildAbi } from "../web/scripts/build-abi.mjs";
import { abiHash } from "./chain.mjs";

const text = JSON.stringify(buildAbi("stories/assembly/proto/stories.proto"), null, 2) + "\n";
fs.writeFileSync(new URL("./stories.abi.json", import.meta.url), text);
console.log("Wrote checker/stories.abi.json. Its sha256 (STORIES_ABI_SHA256 in checker/chain.mjs):");
console.log(abiHash(text));
