// Audit Bot local-chain test (Swarmtales, branch audit-fixes-2 @ 00eec36), playbook §15.
// AB-047 follow-up: can the admin always take down a part with the most kept versions the code
// allows, in ONE transaction, within the node's resource limits?
//
// Real Stories and Shop release builds (sha256 printed). Ink is a TEST build of the repo's Ink with
// burn's balance checks removed (built by the audit, never deployed anywhere else), because the 59
// doubling paid changes cost about 1.15e19 Ink in total: no wallet could hold that. The takedown
// itself never calls Ink, so the measured cost is the real Stories code's.
//
// Parts are built with the per-submission cap at its maximum (10,000 letters), so every kept
// version holds 10,000 letters: the worst case for the versions a takedown reads and deletes.
//   A. live part: original + 98 writer edits + 59 x (paid change + writer edit) + final edit = 218
//      (the 60th paid change can't happen: story.total_burned would overflow u64)
//   B. removed part: the same up to 217 versions, then the writer removes it
//   C. writer-only part: original + 98 edits = 99 versions (takedown's versionByOther reads them all)
// Each takedown variant is measured with a dry run (broadcast=false) before the real takedown.
// Asserts SAFE behaviour: every takedown variant succeeds and stays within the block limits.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const crypto = require("crypto");
const { LocalChain } = require("/audit/chain/chain.js");

function koilibAbi(file) {
  const g = JSON.parse(fs.readFileSync(file, "utf8"));
  const methods = {};
  for (const [name, m] of Object.entries(g.methods)) {
    const raw = m["entry-point"];
    methods[name] = { entry_point: typeof raw === "number" ? raw : parseInt(String(raw), 16), argument: m.argument,
      return: m.return, read_only: !!m["read-only"], description: m.description };
  }
  return { methods, types: g.types };
}
const BUILD = {
  ink: { wasm: "/app/inktest/contract.wasm", abi: koilibAbi("/app/abi/ink.abi") },
  shop: { wasm: "/app/shop/build/release/contract.wasm", abi: koilibAbi("/app/shop/abi/shop.abi") },
  stories: { wasm: "/app/stories/build/release/contract.wasm", abi: koilibAbi("/app/stories/abi/stories.abi") },
};
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").toUpperCase();

let chain, ink, shop, stories, alice, bob, cara, treasury, founder, terms, limits;
const out = [];
const log = (s) => { out.push(s); console.log(s); };
// Mana: every local account shows 1,000,000,000 rc and the mempool holds each pending limit for a
// few minutes, so writer/changer calls get a 15M limit (an edit uses ~6.7M) paid by rotating spare
// accounts; takedowns and their dry runs get a dedicated payer and a 900M limit (90% of its mana).
const STEP_RC = "15000000";
const BIG_RC = "900000000";
let payers = [], bigPayer, turn = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (c, m, a, o = {}) => {
  if (!o.signer) return chain.call(c, m, a, o);           // setup by contract keys: harness defaults
  for (let tries = 0; ; tries++) {
    const payer = payers[turn++ % payers.length];
    try { return await chain.call(c, m, a, { rcLimit: STEP_RC, payer, ...o }); }
    catch (e) {
      if (!/insufficient pending account resources/.test(e.message) || tries > 40) throw new Error(e.message + " for " + m);
      chain._nonces.clear();
      await pause(5000);
    }
  }
};
const must = (r, what) => { assert.ok(r.ok, what + " failed: " + (r.error || "") + " " + JSON.stringify(r.logs || [])); return r; };
const LEN = 10000;
let L = LEN;   // text length of the part being built (A-C: 10,000; D: 4,000, the testnet cap)
let BASE = "a";   // F uses a 3-byte UTF-8 character (one UTF-16 unit = one Ink)
const variant = (i, c) => { const a = BASE.repeat(L).split(""); a[i % L] = c; return a.join(""); };

async function dryRun(contract, method, args, signer) {
  const { operation } = await contract.functions[method](args, { onlyOperation: true });
  const tx = await chain._prepare({ operations: [operation], signer, payer: bigPayer, rcLimit: BIG_RC });
  chain._nonces.clear();
  try {
    const res = await chain.provider.sendTransaction(tx, false);
    return res.receipt || res;
  } catch (e) {
    return { reverted: true, logs: ["dry run rejected: " + String((e && e.message) || e)] };
  }
}
function usage(r) {
  return { compute: BigInt(r.compute_bandwidth_used || "0"), disk: BigInt(r.disk_storage_used || "0"),
    network: BigInt(r.network_bandwidth_used || "0"), rc: BigInt(r.rc_used || "0"), reverted: !!r.reverted, logs: r.logs || [] };
}
function report(label, r) {
  const u = usage(r);
  const pct = (a, b) => (b > 0n ? (Number((a * 10000n) / b) / 100).toFixed(2) + "%" : "n/a");
  log(`${label}: reverted=${u.reverted} compute=${u.compute} (${pct(u.compute, limits.compute)} of block) disk=${u.disk} ` +
    `network=${u.network} (${pct(u.network, limits.network)}) rc=${u.rc}` + (u.logs.length ? " logs=" + JSON.stringify(u.logs) : ""));
  return u;
}

async function editsInBlocks(storyId, seq, from, to, tag) {
  // Writer edits of the same length (free), one per block (the payer's mana covers one pending limit).
  for (let j = from; j <= to; j++) {
    const r = must(await call(chain.as(stories, alice), "edit_segment", { editor: alice.address, story_id: storyId, seq,
      new_text: variant(j, tag), expected_cost: String(L), max_ink: "0" }, { signer: alice }), `writer edit ${j}`);
    if (j === from || j === to) report(`writer edit ${j} (alice rc ${await chain.provider.getAccountRc(alice.address)})`, r.receipt);
  }
}
async function paidRounds(storyId, seq, rounds, withEdits) {
  for (let k = 0; k < rounds; k++) {
    const seg = await chain.read(stories, "get_segment", { story_id: storyId, seq });
    const text = seg.text.slice(0, L - 1) + (seg.text[L - 1] === "y" ? "z" : "y");   // one letter: 10 units
    const price = 10n * (1n << BigInt(k + 1));
    must(await call(chain.as(stories, bob), "revise_part", { writer: bob.address, story_id: storyId, seq, text,
      expected_ink: price.toString(), rights_confirmed: true, terms_version: terms, citation: "", ai_assisted: false }, { signer: bob }),
      `paid change ${k + 1}`);
    if (withEdits) {
      const r = must(await call(chain.as(stories, alice), "edit_segment", { editor: alice.address, story_id: storyId, seq,
        new_text: variant(5000 + k, "w"), expected_cost: String(L), max_ink: "0" }, { signer: alice }), `writer edit after change ${k + 1}`);
    }
  }
}
let nextStory = 0;
async function openStory(opening) {
  must(await call(chain.as(stories, alice), "open_story", { opener: alice.address, kind: 2, title: "Versions " + (nextStory + 1),
    max_chars: String(2 * LEN), category_1: 1, category_2: 0, visibility: 1, free_chapters: 0, contributor_edition_min: "0",
    opening_text: opening, ai_assisted: false, expected_ink: String(opening.length), token: chain.koin.getId(), rights_confirmed: true,
    terms_version: terms, fund: "0", citation: "", max_price: "1000000000" }, { signer: alice }), "open_story");
  nextStory += 1;
  const id = String(nextStory);
  must(await call(chain.as(stories, alice), "set_editor", { opener: alice.address, story_id: id, account: bob.address, allowed: true }, { signer: alice }), "set_editor");
  return id;
}
async function versionCount(id, seq) { return Number((await chain.read(stories, "get_segment", { story_id: id, seq })).version_count || 0); }

test.before(async () => {
  log("Stories release sha256 " + sha(BUILD.stories.wasm));
  log("Shop release sha256    " + sha(BUILD.shop.wasm));
  chain = await LocalChain.start();
  [alice, bob, cara, treasury, founder] = chain.accounts;
  payers = chain.accounts.slice(5, 9);
  bigPayer = chain.accounts[9];
  ink = await chain.deploy({ ...BUILD.ink, name: "inktest" });
  shop = await chain.deploy({ ...BUILD.shop, name: "shop" });
  stories = await chain.deploy({ ...BUILD.stories, name: "stories" });
  const koin = chain.koin.getId();
  must(await call(ink, "set_minter", { account: shop.getId(), reasons_mask: 30 }), "ink.set_minter(shop)");
  must(await call(ink, "set_minter", { account: stories.getId(), reasons_mask: 32 }), "ink.set_minter(stories)");
  must(await call(ink, "set_burner", { account: stories.getId(), allowed: true }), "ink.set_burner(stories)");
  must(await call(shop, "set_addresses", { treasury: treasury.address, founder: founder.address, ink: ink.getId(), stories: stories.getId() }), "shop.set_addresses");
  must(await call(shop, "set_ink_amounts", { writer_month: "15000", pack_s: "5000", pack_m: "15000", pack_l: "45000", starter_book: "20000", starter_short: "10000" }), "shop.set_ink_amounts");
  must(await call(shop, "set_asset", { token: koin, enabled: true, decimals: 8, symbol: "KOIN" }), "shop.set_asset");
  must(await call(shop, "set_price", { item: 7, token: koin, amount: "100000000" }), "price open short");
  must(await call(stories, "set_addresses", { ink: ink.getId(), shop: shop.getId() }), "stories.set_addresses");
  must(await call(stories, "set_limits", { contribution_cap: LEN, trial_limit: 1000, open_limit: 3, archive_days: 60, inactivity_days: 30 }), "stories.set_limits (cap 10,000)");
  must(await call(stories, "set_min_contribution", { min_contribution: 1 }), "min contribution");
  must(await call(stories, "add_category", { name: "Fantasy" }), "add_category");
  terms = (await chain.read(stories, "get_config", {})).terms_version || 0;
  const rl = await chain.provider.call("chain.get_resource_limits", {});
  const d = rl.resource_limit_data || rl;
  limits = { compute: BigInt(d.compute_bandwidth_limit || "0"), network: BigInt(d.network_bandwidth_limit || "0"), disk: BigInt(d.disk_storage_limit || "0") };
  log("node resource limits (chain.get_resource_limits): " + JSON.stringify(d));
});

test.after(async () => {
  try { fs.writeFileSync("/app/ab047-measurements.txt", out.join("\n") + "\n"); } catch (e) { /* read-only: stdout has it */ }
  if (chain && chain.stop) await chain.stop();
});

test("A: a live part with the most reachable versions (218, 10,000 letters each) is taken down in one transaction", { timeout: 3600000 }, async () => {
  const id = await openStory(variant(0, "o"));
  await editsInBlocks(id, "1", 1, 98, "e");
  assert.strictEqual(await versionCount(id, "1"), 99);
  await paidRounds(id, "1", 59, true);
  assert.strictEqual(await versionCount(id, "1"), 217);
  // The 60th paid change: refused because story.total_burned would pass u64 (so 220 is unreachable).
  const seg = await chain.read(stories, "get_segment", { story_id: id, seq: "1" });
  const sixtieth = await call(chain.as(stories, bob), "revise_part", { writer: bob.address, story_id: id, seq: "1",
    text: seg.text.slice(0, LEN - 1) + "q", expected_ink: (10n * (1n << 60n)).toString(), rights_confirmed: true, terms_version: terms, citation: "", ai_assisted: false }, { signer: bob });
  log("60th paid change: ok=" + sixtieth.ok + " " + (sixtieth.error || ""));
  // Fill the story so it locks, close it, final-edit the part (version 218).
  must(await call(chain.as(stories, alice), "contribute", { author: alice.address, story_id: id, text: "f".repeat(LEN), starts_chapter: false,
    ai_assisted: false, expected_ink: String(LEN), rights_confirmed: true, terms_version: terms, insert_after: "0", after_my_last: false, citation: "" }, { signer: alice }), "fill");
  must(await call(chain.as(stories, alice), "close_story", { opener: alice.address, story_id: id, token: chain.koin.getId() }, { signer: alice }), "close");
  must(await call(chain.as(stories, alice), "submit_final_batch", { finalizer: alice.address, story_id: id, items: [
    { seq: "1", mode: 2, text: variant(7777, "F"), expected_cost: String(LEN) }, { seq: "2", mode: 1, text: "", expected_cost: "0" }] }, { signer: alice }), "final edit");
  const n = await versionCount(id, "1");
  log("A: version_count = " + n);
  assert.strictEqual(n, 218);
  const args = (extra) => ({ story_id: id, seq: "1", reason: 1, note: "notice AB-047", ...extra });
  report("A dry: strike the writer (reads every version)", await dryRun(stories, "takedown_segment", args({ strike: alice.address }), stories.signer));
  report("A dry: no strike", await dryRun(stories, "takedown_segment", args({ no_strike: true }), stories.signer));
  report("A dry: strike the changer", await dryRun(stories, "takedown_segment", args({ strike: bob.address }), stories.signer));
  try {
    const hist = await chain.read(stories, "get_versions", { story_id: id, seq: "1" });
    log("A: get_versions read returned " + (((hist && hist.values) || []).length) + " versions");
  } catch (e) { log("A: get_versions read FAILED: " + String((e && e.message) || e).slice(0, 300)); }
  try {
    const ch = await chain.read(stories, "get_changers", { story_id: id, seq: "1" });
    log("A: get_changers returned " + (((ch && ch.values) || []).length) + " changers");
  } catch (e) { log("A: get_changers read FAILED: " + String((e && e.message) || e).slice(0, 300)); }
  const strikeWriter = await chain.call(stories, "takedown_segment", args({ strike: alice.address }), { payer: bigPayer, rcLimit: BIG_RC });
  log("A real: strike the writer: ok=" + strikeWriter.ok + " " + (strikeWriter.error || ""));
  const real = must(await chain.call(stories, "takedown_segment", args({ no_strike: true }), { payer: bigPayer, rcLimit: BIG_RC }), "real takedown A (no strike)");
  const u = report("A real: no strike", real.receipt);
  assert.ok(strikeWriter.ok, "AB-047: the admin can't strike the writer of a 218-version part (takedown exceeds the block's compute)");
  const kept = await chain.read(stories, "get_versions", { story_id: id, seq: "1" });
  assert.strictEqual(((kept && kept.values) || []).length, 0, "every version wiped");
});

test("B: a removed part with the most reachable versions (217) is taken down in one transaction", { timeout: 3600000 }, async () => {
  const id = await openStory(variant(1, "p"));
  await editsInBlocks(id, "1", 1, 98, "g");
  await paidRounds(id, "1", 59, true);
  assert.strictEqual(await versionCount(id, "1"), 217);
  must(await call(chain.as(stories, alice), "remove_segment", { editor: alice.address, story_id: id, seq: "1" }, { signer: alice }), "writer removes");
  log("B: version_count after removal = " + await versionCount(id, "1"));
  const args = (extra) => ({ story_id: id, seq: "1", reason: 1, note: "notice AB-047", ...extra });
  report("B dry: strike the writer", await dryRun(stories, "takedown_segment", args({ strike: alice.address }), stories.signer));
  report("B dry: no strike", await dryRun(stories, "takedown_segment", args({ no_strike: true }), stories.signer));
  const strikeWriter = await chain.call(stories, "takedown_segment", args({ strike: alice.address }), { payer: bigPayer, rcLimit: BIG_RC });
  log("B real: strike the writer: ok=" + strikeWriter.ok + " " + (strikeWriter.error || ""));
  const real = must(await chain.call(stories, "takedown_segment", args({ no_strike: true }), { payer: bigPayer, rcLimit: BIG_RC }), "real takedown B (no strike)");
  report("B real: no strike", real.receipt);
  assert.ok(strikeWriter.ok, "AB-047: the admin can't strike the writer of a 217-version removed part");
});

test("C: a writer-only part with 99 versions (default takedown reads every version)", { timeout: 3600000 }, async () => {
  const id = await openStory(variant(2, "r"));
  await editsInBlocks(id, "1", 1, 98, "h");
  assert.strictEqual(await versionCount(id, "1"), 99);
  const args = (extra) => ({ story_id: id, seq: "1", reason: 1, note: "notice AB-047", ...extra });
  report("C dry: naming a wallet that never changed it (refused, reads all)", await dryRun(stories, "takedown_segment", args({ strike: cara.address }), stories.signer));
  const real = must(await chain.call(stories, "takedown_segment", args({}), { payer: bigPayer, rcLimit: BIG_RC }), "real default takedown C");
  const u = report("C real: default (automatic strike of the writer)", real.receipt);
  assert.ok(limits.compute === 0n || u.compute < limits.compute);
});

test("D: the same 218-version part at the testnet cap (4,000 letters per version): strike the writer", { timeout: 3600000 }, async () => {
  L = 4000;
  const id = await openStory(variant(3, "s"));
  await editsInBlocks(id, "1", 1, 98, "k");
  await paidRounds(id, "1", 59, true);
  for (const [n, c] of [[LEN, "f"], [LEN - L, "g"]]) {
    must(await call(chain.as(stories, alice), "contribute", { author: alice.address, story_id: id, text: c.repeat(n), starts_chapter: false,
      ai_assisted: false, expected_ink: String(n), rights_confirmed: true, terms_version: terms, insert_after: "0", after_my_last: false, citation: "" }, { signer: alice }), "fill D " + n);
  }
  must(await call(chain.as(stories, alice), "close_story", { opener: alice.address, story_id: id, token: chain.koin.getId() }, { signer: alice }), "close D");
  must(await call(chain.as(stories, alice), "submit_final_batch", { finalizer: alice.address, story_id: id, items: [
    { seq: "1", mode: 2, text: variant(1777, "F"), expected_cost: String(L) }, { seq: "2", mode: 1, text: "", expected_cost: "0" },
    { seq: "3", mode: 1, text: "", expected_cost: "0" }] }, { signer: alice }), "final edit D");
  assert.strictEqual(await versionCount(id, "1"), 218);
  try {
    const hist = await chain.read(stories, "get_versions", { story_id: id, seq: "1" });
    log("D: get_versions read returned " + (((hist && hist.values) || []).length) + " versions");
  } catch (e) { log("D: get_versions read FAILED: " + String((e && e.message) || e).slice(0, 300)); }
  const args = (extra) => ({ story_id: id, seq: "1", reason: 1, note: "notice AB-047", ...extra });
  const r = await chain.call(stories, "takedown_segment", args({ strike: alice.address }), { payer: bigPayer, rcLimit: BIG_RC });
  if (r.ok) report("D real: strike the writer", r.receipt); else log("D real: strike the writer: ok=false " + r.error);
  assert.ok(r.ok, "AB-047: at 4,000 letters the writer of a 218-version part can't be struck");
});

// E: free writer edits alone (mana only, no Ink) against the history read the takedown tool needs first.
for (const len of [10000, 4000, 2000]) {
  test(`E${len}: get_versions on a writer-only part as its free edits pile up (${len} letters)`, { timeout: 3600000 }, async () => {
    L = len;
    const id = await openStory(variant(4, "t") + (len < LEN ? "" : ""));
    let firstFail = 0;
    for (let j = 1; j <= 98; j++) {
      must(await call(chain.as(stories, alice), "edit_segment", { editor: alice.address, story_id: id, seq: "1",
        new_text: variant(j, "u"), expected_cost: String(L), max_ink: "0" }, { signer: alice }), "edit " + j);
      if (!firstFail && (j % 5 === 0 || j === 98)) {
        try { await chain.read(stories, "get_versions", { story_id: id, seq: "1" }); }
        catch (e) { firstFail = j + 1; log(`E${len}: get_versions FAILS at ${j + 1} versions: ` + String((e && e.message) || e).slice(0, 120)); }
      }
    }
    if (!firstFail) log(`E${len}: get_versions still works at 99 versions`);
    assert.strictEqual(firstFail, 0, `AB-047: with ${len}-letter versions, get_versions stops working at ${firstFail} versions (the takedown tool reads it first)`);
  });
}

// F (verifier lead): a writer-only part, 99 versions of 10,000 CJK characters (3 bytes each in UTF-8, one
// Ink each). The takedown computes `changed` with versionByOther before looking at strike/no_strike.
test("F: a writer-only part with 99 versions of 10,000 three-byte characters can still be taken down", { timeout: 3600000 }, async () => {
  L = LEN; BASE = "中";
  const id = await openStory(variant(5, "文"));
  await editsInBlocks(id, "1", 1, 98, "字");
  assert.strictEqual(await versionCount(id, "1"), 99);
  const args = (extra) => ({ story_id: id, seq: "1", reason: 1, note: "notice AB-047", ...extra });
  report("F dry: no strike", await dryRun(stories, "takedown_segment", args({ no_strike: true }), stories.signer));
  report("F dry: strike the writer", await dryRun(stories, "takedown_segment", args({ strike: alice.address }), stories.signer));
  const r = await chain.call(stories, "takedown_segment", args({}), { payer: bigPayer, rcLimit: BIG_RC });
  if (r.ok) report("F real: default", r.receipt); else log("F real: default: ok=false " + r.error);
  let ok = r.ok;
  if (!ok) {
    const r2 = await chain.call(stories, "takedown_segment", args({ no_strike: true }), { payer: bigPayer, rcLimit: BIG_RC });
    if (r2.ok) report("F real: no strike", r2.receipt); else log("F real: no strike: ok=false " + r2.error);
    ok = r2.ok;
  }
  assert.ok(ok, "AB-047/AB-059: the admin can't take this part down in any way: every takedown exceeds the block's compute");
});

for (const len of [4000, 7000]) {
  test(`G${len}: writer-only, 99 versions of ${len} three-byte characters: no-strike takedown`, { timeout: 3600000 }, async () => {
    L = len; BASE = "中";
    const id = await openStory(variant(6, "文"));
    await editsInBlocks(id, "1", 1, 98, "字");
    const args = (extra) => ({ story_id: id, seq: "1", reason: 1, note: "notice AB-047", ...extra });
    const r = await chain.call(stories, "takedown_segment", args({ no_strike: true }), { payer: bigPayer, rcLimit: BIG_RC });
    if (r.ok) report(`G${len} real: no strike`, r.receipt); else log(`G${len} real: no strike: ok=false ` + r.error);
    assert.ok(r.ok, `AB-059: at ${len} three-byte characters per version the part can't be taken down`);
  });
}
