/**
 * Admin: every admin control of Ink, Shop, Stories and the mana sponsor in
 * one place. The page never holds a key. Each action is either signed with
 * the connected wallet (when it is the admin), or written to a prepared
 * transaction file for the multisig signers, the same file the deploy tool's
 * `cosign` and `submit` take. The contracts check every permission again.
 */
import { Contract, Signer, Transaction, utils } from "koilib";
import { abis } from "../generated/abis.js";
import { contracts, DEFAULT_PAYMENT, network, pinnedToken, SITE } from "../config.js";
import { codeHashOf, encode, getProvider, read, verifyChain } from "../chain.js";
import {
  AdminInputError, INK_AMOUNT_FIELDS, REASONS, SHOP_ITEMS, fromBaseUnits, numberMismatch, planAcceptAdmin, planAny, planAsset,
  planBlock, planCampaignEnabled, planCampaignLimits, planCategory, planCategoryActive, planClearSummary, planFee, planHide,
  planInkAmounts, planLimits, planMinContribution, planModeration, planPause, planPrice, planPromo, planPromoSwitch, planSetAdmin,
  planSourceNote, planTakedown, planTakeOver, planTerms, preparedFile, promoLink, SPONSOR_DEFAULT_CAPS, sponsorCommand, strikeChoices, toBaseUnits,
  ADMIN_METHODS, canAdminister, planAddToken, preparedRcLimit, ratePrice, RATE_ITEMS,
} from "../lib/admin.js";
import { canonicalBase } from "../lib/site.js";
import { formatUtc } from "../lib/money.js";
import { append, h, replace } from "../ui/dom.js";
import { currentAddress, state } from "../app/state.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";
import { connectButton, failure, field, loadingLine, notice, setMeta, statusBox } from "../app/ui.js";

const CONTRACT_LABEL = { ink: "Ink", shop: "Shop", stories: "Stories", sponsor: "Mana sponsor" };
const admin = { mode: "wallet", payer: "", data: null, loading: false, error: "", priceToken: "" };

function ids() {
  return { ink: contracts.ink, shop: contracts.shop, stories: contracts.stories, sponsor: contracts.sponsor };
}

async function loadAdminData() {
  const safe = (p) => p.catch(() => null);
  const [inkCfg, shopCfg, storiesCfg, sponsorCfg] = await Promise.all([
    safe(read("ink", "get_config", {})),
    safe(read("shop", "get_config", {})),
    safe(read("stories", "get_config", {})),
    contracts.sponsor && contracts.sponsorKind === "sponsor" ? safe(read("sponsor", "get_config", {})) : Promise.resolve(null),
  ]);
  // Every token the Shop has a record of, the page's own token first.
  const tokenIds = [DEFAULT_PAYMENT.address];
  const listed = await safe(read("shop", "get_assets", {}));
  for (const t of (listed && listed.tokens) || []) if (!tokenIds.includes(t)) tokenIds.push(t);
  const tokens = [];
  for (const address of tokenIds) {
    const a = await safe(read("shop", "get_asset", { token: address }));
    tokens.push({ address, enabled: !!(a && a.enabled), symbol: (a && a.symbol) || (address === DEFAULT_PAYMENT.address ? DEFAULT_PAYMENT.symbol : "?"),
      decimals: a && a.symbol ? Number(a.decimals) : DEFAULT_PAYMENT.decimals, usable_from: (a && a.usable_from) || "0" });
  }
  const priceToken = tokens.find((t) => t.address === admin.priceToken) || tokens[0];
  admin.priceToken = priceToken.address;
  const prices = {};
  await Promise.all(SHOP_ITEMS.map(async (item) => {
    const r = await safe(read("shop", "get_price", { item: item.id, token: priceToken.address }));
    prices[item.id] = (r && r.value) || "0";
  }));
  const campaigns = [];
  const next = Number((shopCfg && shopCfg.next_campaign_id) || 1);
  const from = Math.max(1, next - 20);
  for (let id = next - 1; id >= from; id--) {
    const c = await safe(read("shop", "get_campaign", { campaign_id: String(id) }));
    if (c) campaigns.push({ id, ...c });
  }
  const categories = [];
  const nextCat = Number((storiesCfg && storiesCfg.next_category_id) || 1);
  for (let id = 1; id < nextCat && id <= 255; id++) {
    const c = await safe(read("stories", "get_category", { category_id: id }));
    categories.push({ id, name: (c && c.name) || "Category " + id, active: !!(c && c.active) });
  }
  // The signers of each admin that is a multisig, so its signers see the controls (L-21).
  const adminAddrs = [...new Set([inkCfg, shopCfg, storiesCfg].map((c) => c && c.admin).filter(Boolean))];
  const signers = [];
  for (const a of adminAddrs) {
    const cfg = await safe(new Contract({ id: a, abi: abis.multisig, provider: getProvider() }).functions.get_config({}).then((r) => r.result));
    if (cfg && Array.isArray(cfg.signers)) signers.push(cfg.signers);
  }
  return { inkCfg: inkCfg || {}, shopCfg: shopCfg || {}, storiesCfg: storiesCfg || {}, sponsorCfg, prices, priceToken, tokens, campaigns, categories, signers };
}

function reload() {
  admin.loading = true;
  admin.error = "";
  loadAdminData()
    .then((d) => { admin.data = d; })
    .catch((e) => { admin.error = e && e.message ? e.message : String(e); })
    .finally(() => {
      admin.loading = false;
      if (location.hash.startsWith("#/admin")) renderPage();
    });
}

// ---------------------------------------------------------------- running an action

/**
 * Show what will happen, then sign with the wallet or write the multisig file.
 * `plans` is a list of plan objects (lib/admin.js). `before` runs first (the
 * promo link, for example) and may return false to stop.
 */
async function run(plans, status, before) {
  try {
    for (const p of plans) {
      const id = ids()[p.contract];
      if (!id) throw new AdminInputError("No " + CONTRACT_LABEL[p.contract] + " address is set up on this page.");
      p.contract_id = id;
    }
    if (before && (await before()) === false) return false;
    const ops = [];
    for (const p of plans) {
      const op = await encode(p.contract, p.method, p.args);
      // What is signed must be what was shown: decode the bytes back and
      // refuse any number that wrapped around or was cut to fit (audit M-C).
      const back = await new Contract({ id: p.contract_id, abi: abis[p.contract] }).decodeOperation(op);
      const bad = numberMismatch(p.args, back.args || {});
      if (bad) throw new AdminInputError(bad.field + " = " + bad.sent + " does not fit the contract's number type (it would be signed as " + bad.got + "). Nothing was signed.");
      ops.push(op);
    }
    if (admin.mode === "prepare") return prepare(plans, ops, status);
    if (!state.wallet) throw new AdminInputError("Connect the admin wallet first, or switch to “Prepare a file for the multisig”.");
    const ok = await send(ops, status);
    if (ok) reload();
    return ok;
  } catch (error) {
    if (error instanceof AdminInputError) replace(status, notice("warn", h("p", {}, [error.message])));
    else failure(status, error);
    return false;
  }
}

async function prepare(plans, ops, status) {
  const chainId = await verifyChain();
  const payer = String(admin.payer || "").trim();
  if (!/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(payer)) throw new AdminInputError("Type the paying address (the multisig, or a wallet that will also cosign) above.");
  // The same nonce encoding every wallet uses (koilib), which the chain takes.
  const nonce = await getProvider().getNextNonce(payer);
  const tx = { header: { chain_id: chainId, rc_limit: preparedRcLimit(ops.length), nonce, payer }, operations: ops };
  await Transaction.prepareTransaction(tx);
  let needs = null;
  try {
    const ms = new Contract({ id: payer, abi: abis.multisig, provider: getProvider() });
    const { result } = await ms.functions.get_config({});
    if (result && Number(result.threshold) > 0 && Array.isArray(result.signers)) needs = { account: payer, signers: result.signers, threshold: result.threshold };
  } catch {
    needs = null; // not a multisig
  }
  const file = preparedFile({ networkKey: network.mainnet ? "mainnet" : "testnet", chainId, tx, planned: plans, needs });
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const name = "swarmtales-" + plans[0].method.replace(/_/g, "-") + "-" + tx.id.slice(6, 14) + ".json";
  const link = h("a", { href: URL.createObjectURL(blob), download: name, class: "btn btn-primary btn-small" }, ["Download " + name]);
  const flags = network.mainnet ? " --network mainnet --i-understand-this-is-mainnet" : "";
  replace(status, notice("ok", [
    h("p", {}, ["Prepared, not signed and not sent. Transaction " + tx.id + "."]),
    h("p", {}, [link]),
    h("p", { class: "body-2" }, ["Each signer, on their own computer, in the swarmtales folder:"]),
    h("pre", { class: "mono small" }, ["node deploy/deploy.js cosign " + name + flags]),
    h("p", { class: "body-2" }, ["Then anyone, with the signed copies:"]),
    h("pre", { class: "mono small" }, ["node deploy/deploy.js submit " + name + flags]),
    h("p", { class: "meta small" }, ["cosign decodes every operation with its own copy of the contracts and refuses a changed file. The file stops working once " + payer + " sends any other transaction."]),
  ]));
  link.click();
  return true;
}

/** The Shop's other tokens, for the one-symbol-per-token check (audit I-2). */
function otherTokens(address) {
  return ((admin.data && admin.data.tokens) || []).filter((t) => t.address !== address).map((t) => ({ address: t.address, symbol: t.symbol }));
}

function actionButton(text, getPlans, opts = {}) {
  const status = statusBox();
  const button = h("button", { type: "button", class: "btn " + (opts.danger ? "btn-danger" : "btn-primary") + " btn-small" }, [text]);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      let plans;
      try {
        plans = await getPlans();
      } catch (error) {
        if (error instanceof AdminInputError) {
          replace(status, notice("warn", h("p", {}, [error.message])));
          return;
        }
        throw error;
      }
      if (!plans) return;
      const list = Array.isArray(plans) ? plans : [plans];
      replace(status, notice("info", [h("p", {}, ["What will happen:"]), h("ul", {}, list.map((p) => h("li", {}, [p.summary])))]));
      await run(list, status, opts.before ? () => opts.before(list, status) : null);
    } catch (error) {
      failure(status, error);
    } finally {
      button.disabled = false;
    }
  });
  return h("div", { class: "stack-sm" }, [button, status]);
}

// ---------------------------------------------------------------- small form helpers

function input(value, attrs = {}) {
  return h("input", { type: "text", value: value == null ? "" : String(value), autocomplete: "off", ...attrs });
}
function select(options, value) {
  const s = h("select", {}, options.map((o) => h("option", { value: String(o.value) }, [o.label])));
  if (value != null) s.value = String(value);
  return s;
}
function checkbox(checked) {
  const c = h("input", { type: "checkbox" });
  c.checked = !!checked;
  return c;
}
function section(title, lead, children, open) {
  return h("details", { class: "card admin-section", open: open || null }, [
    h("summary", {}, [h("b", {}, [title])]),
    lead ? h("p", { class: "body-2" }, [lead]) : null,
    ...children,
  ]);
}
function row(...children) {
  return h("div", { class: "admin-row" }, children);
}

// ---------------------------------------------------------------- the page

export function renderAdmin(page) {
  setMeta("Admin", "SwarmTales admin controls.");
  const container = h("div", { class: "container page admin-page" });
  append(page, container);
  append(container,
    h("p", { class: "eyebrow" }, ["Admin"]),
    h("h1", { class: "title" }, ["Admin controls"]),
    h("p", { class: "lede" }, ["Every admin power of Ink, Shop, Stories and the mana sponsor. Nothing here works unless the contract's admin signs it."]));

  if (!admin.data && !admin.loading) reload();
  if (!admin.data) {
    append(container, admin.error ? notice("bad", h("p", {}, [admin.error])) : loadingLine("Reading the contracts' settings…"));
    return;
  }
  const d = admin.data;
  const me = currentAddress();
  const admins = { ink: d.inkCfg.admin, shop: d.shopCfg.admin, stories: d.storiesCfg.admin };
  const isAdmin = me && Object.values(admins).includes(me);

  // Who signs.
  const mode = select([
    { value: "wallet", label: "Sign with my connected wallet" },
    { value: "prepare", label: "Prepare a file for the multisig signers (cosign, then submit)" },
  ], admin.mode);
  const payer = input(admin.payer || admins.stories || "", { placeholder: "Paying address (the multisig, or a wallet that cosigns)" });
  mode.addEventListener("change", () => { admin.mode = mode.value; payerRow.hidden = admin.mode !== "prepare"; });
  payer.addEventListener("input", () => { admin.payer = payer.value; });
  admin.payer = payer.value;
  const payerRow = field("Paying address", payer, "Pays the mana. The multisig itself, if it holds KOIN; otherwise a wallet that also cosigns.");
  payerRow.hidden = admin.mode !== "prepare";
  append(container, h("div", { class: "card admin-who" }, [
    h("h2", { class: "h3" }, ["Who signs"]),
    h("dl", { class: "facts" }, [
      ...Object.entries(admins).map(([c, a]) => h("div", {}, [h("dt", {}, [CONTRACT_LABEL[c] + " admin"]), h("dd", { class: "mono small" }, [a || "?"])])),
      h("div", {}, [h("dt", {}, ["Your wallet"]), h("dd", { class: "mono small" }, [me || "not connected"])]),
    ]),
    me ? null : connectButton("Connect the admin wallet"),
    me && !isAdmin ? notice("warn", h("p", {}, ["Your connected wallet isn't an admin here. Use “Prepare a file for the multisig”, or connect the admin wallet."])) : null,
    field("How to sign", mode),
    payerRow,
    h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: () => { admin.data = null; reload(); } }, ["Reload settings"]),
  ]));
  // The controls only for an admin, or a signer of the admin multisig (audit L-21).
  if (!canAdminister(me, Object.values(admins), d.signers)) {
    append(container, notice("info", h("p", {}, [
      "The admin controls show once you connect an admin wallet, or a signer of the admin multisig. The contracts check every permission again either way.",
    ])));
    return;
  }

  append(container,
    emergencySection(d),
    promoSection(d, me),
    pricesSection(d),
    inkAmountsSection(d),
    moderationSection(d, me),
    storiesSettingsSection(d),
    tokensSection(d),
    sponsorSection(d),
    handoverSection(admins),
    anySection());
}

function emergencySection(d) {
  const rows = [["ink", d.inkCfg], ["shop", d.shopCfg], ["stories", d.storiesCfg]].map(([c, cfg]) => row(
    h("span", {}, [CONTRACT_LABEL[c] + ": ", h("b", {}, [cfg.paused ? "PAUSED" : "running"])]),
    actionButton(cfg.paused ? "Unpause " + CONTRACT_LABEL[c] : "Pause " + CONTRACT_LABEL[c], () => planPause(c, !cfg.paused), { danger: !cfg.paused }),
  ));
  return section("Emergency pause", "Pausing stops every user action on that contract until you unpause it. Reading keeps working.", rows, true);
}

function promoSection(d, me) {
  const ink = input("500");
  const days = input("7");
  const budget = input("50000");
  const cap = input("0");
  const site = input(canonicalBase(SITE.url));
  const create = actionButton("Create the promo link", () => {
    const key = new Signer({ privateKey: randomKeyHex() });
    createKey = key;
    return planPromo({ inkPerClaim: ink.value, days: days.value, budget: budget.value, dailyCap: cap.value, nowSec: Math.floor(Date.now() / 1000), linkSigner: key.getAddress() });
  }, {
    async before(plans, status) {
      const cfg = await read("shop", "get_config", {});
      const id = cfg && cfg.next_campaign_id && cfg.next_campaign_id !== "0" ? String(cfg.next_campaign_id) : "1";
      const link = promoLink(site.value, id, createKey.getPrivateKey("wif"));
      const box = h("div", { class: "notice notice-warn" }, [
        h("p", {}, [h("b", {}, ["Copy this link now. It is shown only once"]), " and holds the campaign's secret key. It starts working once the transaction is in a block (campaign " + id + ")."]),
        h("pre", { class: "mono small admin-link" }, [link]),
      ]);
      status.before(box);
      return true;
    },
  });
  let createKey = null;
  const switchBtn = actionButton(d.shopCfg.promo_enabled ? "Switch promos OFF for everyone" : "Switch promos ON for everyone", () => planPromoSwitch(!d.shopCfg.promo_enabled));
  const list = d.campaigns.length ? h("table", { class: "admin-table" }, [
    h("tr", {}, ["Id", "Ink each", "Given / budget", "Daily cap", "Ends", "On", ""].map((t) => h("th", {}, [t]))),
    ...d.campaigns.map((c) => h("tr", {}, [
      h("td", {}, [String(c.id)]),
      h("td", {}, [String(c.amount || 0)]),
      h("td", {}, [String(c.budget_used || 0) + " / " + String(c.budget_total || 0)]),
      h("td", {}, [String(c.daily_cap || 0)]),
      h("td", {}, [c.ends_at ? formatUtc(Number(c.ends_at)) : "?"]),
      h("td", {}, [c.enabled ? "yes" : "no"]),
      h("td", {}, [actionButton(c.enabled ? "Turn off" : "Turn on", () => planCampaignEnabled(c.id, !c.enabled))]),
    ])),
  ]) : h("p", { class: "meta" }, ["No campaigns yet."]);
  const limId = input("");
  const limBudget = input("");
  const limCap = input("0");
  const limDays = input("7");
  const limits = actionButton("Change the campaign", () => planCampaignLimits({
    campaignId: limId.value, budget: limBudget.value, dailyCap: limCap.value,
    endsAt: String(Math.floor(Date.now() / 1000) + 86400 * Number(limDays.value || 0)),
  }));
  return section("Promo links", "A promo link gives every wallet that opens it the same Ink, once each, while the link works and the budget lasts.", [
    h("p", {}, ["Promos for everyone are ", h("b", {}, [d.shopCfg.promo_enabled ? "ON" : "OFF"]), "."]),
    switchBtn,
    h("h3", { class: "h4" }, ["New promo link"]),
    row(field("Ink per claim", ink), field("Days the link works", days)),
    row(field("Total Ink budget", budget, "The most Ink this link gives out in total."), field("Daily cap (Ink)", cap, "0 = no daily cap.")),
    field("Site address for the link", site),
    create,
    h("h3", { class: "h4" }, ["Recent campaigns"]),
    list,
    h("h3", { class: "h4" }, ["Change a campaign's budget, cap or end"]),
    row(field("Campaign id", limId), field("New total budget", limBudget), field("Daily cap", limCap), field("Ends in (days from now)", limDays)),
    limits,
  ]);
}

function randomKeyHex() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function pricesSection(d) {
  const t = d.priceToken;
  const dec = t.decimals;
  const sym = t.symbol;
  const pick = select(d.tokens.map((x) => ({ value: x.address, label: x.symbol + (x.enabled ? "" : " (off)") + " · " + x.address })), t.address);
  pick.addEventListener("change", () => { admin.priceToken = pick.value; admin.data = null; reload(); });
  const inputs = {};
  const rows = SHOP_ITEMS.map((item) => {
    inputs[item.id] = input(fromBaseUnits(d.prices[item.id], dec));
    return h("tr", {}, [
      h("td", {}, [item.name]),
      h("td", {}, [d.prices[item.id] === "0" ? "not for sale" : fromBaseUnits(d.prices[item.id], dec) + " " + sym]),
      h("td", {}, [inputs[item.id]]),
    ]);
  });
  const save = actionButton("Save changed prices", () => {
    const plans = [];
    for (const item of SHOP_ITEMS) {
      const base = toBaseUnits(inputs[item.id].value, dec, item.name + " price");
      if (base !== String(d.prices[item.id] || "0")) plans.push(planPrice(item.id, t.address, inputs[item.id].value, dec, sym));
    }
    if (!plans.length) throw new AdminInputError("No price changed.");
    return plans;
  });
  return section("Prices", "Prices of every item, per payment token. 0 takes an item off sale for that token. One confirmation saves every changed price.", [
    field("Token", pick),
    h("table", { class: "admin-table" }, [h("tr", {}, ["Item", "Now", "New price (" + sym + ")"].map((x) => h("th", {}, [x]))), ...rows]),
    save,
  ]);
}

function inkAmountsSection(d) {
  const inputs = {};
  const fields = INK_AMOUNT_FIELDS.map((f) => {
    inputs[f.key] = input(d.shopCfg[f.cfg] || "0");
    return field(f.name + " (Ink)", inputs[f.key]);
  });
  const save = actionButton("Save Ink amounts", () => {
    const v = {};
    for (const f of INK_AMOUNT_FIELDS) v[f.key] = inputs[f.key].value;
    return planInkAmounts(v);
  });
  const fee = input(String(d.shopCfg.fee_bps || 0));
  return section("Ink amounts and founder fee", "How much Ink a Writer month, each pack and each kind of story opening brings. Buyers are protected: if the Ink drops below what their page showed, their purchase fails and nothing is charged.", [
    h("div", { class: "admin-grid" }, fields),
    save,
    row(field("Founder fee (basis points, 100 = 1%, at most 500)", fee)),
    actionButton("Save the fee", () => planFee(fee.value)),
  ]);
}

function moderationSection(d, me) {
  // Look up a part, then hide / take down.
  const storyId = input("");
  const seq = input("");
  const view = h("div", { class: "admin-part" });
  let loaded = null;
  let changers = [];
  const look = h("button", { type: "button", class: "btn btn-secondary btn-small" }, ["Look up the part"]);
  look.addEventListener("click", async () => {
    replace(view, loadingLine("Reading…"));
    try {
      loaded = await read("stories", "get_segment", { story_id: storyId.value.trim(), seq: seq.value.trim() });
      const ch = await read("stories", "get_changers", { story_id: storyId.value.trim(), seq: seq.value.trim() }).catch(() => null);
      changers = (ch && ch.values) || [];
      if (!loaded || !loaded.author) {
        replace(view, notice("warn", h("p", {}, ["There is no such part."])));
        return;
      }
      const choices = strikeChoices(loaded, changers);
      strikeSel.replaceChildren(...choices.candidates.map((a) => h("option", { value: a }, [(a === choices.writer ? "Writer: " : "Changed it: ") + a])),
        h("option", { value: "" }, ["No strike"]));
      replace(view, [
        h("p", { class: "meta" }, ["Writer " + loaded.author + (loaded.hidden ? " · HIDDEN" : "") + (loaded.taken_down ? " · TAKEN DOWN" : "") +
          (choices.changed ? " · changed by someone else" : "") + " · " + (loaded.version_count || 0) + " kept versions"]),
        h("blockquote", { class: "admin-text" }, [String(loaded.text || "(no text)")]),
      ]);
    } catch (error) {
      failure(view, error);
    }
  });
  const reason = select(REASONS.map((r) => ({ value: r.id, label: r.name })), 1);
  const note = input("", { maxlength: "200", placeholder: "What it matched, or a notice reference" });
  const strikeSel = h("select", {}, [h("option", { value: "" }, ["Look up the part first"])]);
  const hide = actionButton("Hide the part", () => planHide({ actor: me || d.storiesCfg.admin, storyId: storyId.value, seq: seq.value, hidden: true, reason: reason.value, noteText: note.value }));
  const unhide = actionButton("Unhide the part", () => planHide({ actor: me || d.storiesCfg.admin, storyId: storyId.value, seq: seq.value, hidden: false, reason: 0, noteText: note.value }));
  const takedown = actionButton("TAKE DOWN for good", () => {
    if (!loaded) throw new AdminInputError("Look up the part first, and read it.");
    return planTakedown({ seg: loaded, storyId: storyId.value, seq: seq.value, reason: reason.value, noteText: note.value,
      strikeMode: strikeSel.value ? "wallet" : "none", strike: strikeSel.value, changers });
  }, { danger: true });
  const sourceNote = actionButton("Set or clear the source note", () => planSourceNote({ actor: me || d.storiesCfg.admin, storyId: storyId.value, seq: seq.value, noteText: note.value }));

  const who = input("", { placeholder: "Wallet address" });
  const blockNote = input("", { maxlength: "200" });
  const statusView = h("div", {});
  const check = h("button", { type: "button", class: "btn btn-secondary btn-small" }, ["Check the wallet"]);
  check.addEventListener("click", async () => {
    try {
      const s = await read("stories", "get_account_status", { account: who.value.trim() });
      replace(statusView, h("p", { class: "meta" }, ["Strikes: " + ((s && s.strikes) || 0) + " of " + (d.storiesCfg.strike_limit || 5) + " · " + (s && s.blocked ? "BLOCKED" : "not blocked")]));
    } catch (error) {
      failure(statusView, error);
    }
  });
  const sid = input("");
  return section("Moderation: hide, take down, strikes, blocks", "A hide is reversible. A takedown clears the text for good (no Ink refund) and gives one strike; enough strikes block the wallet. It is bound to the text you read: if the part changes first, nothing happens.", [
    row(field("Story id", storyId), field("Part number", seq)),
    look,
    view,
    row(field("Reason", reason), field("Note (up to 200 characters)", note)),
    row(hide, unhide, sourceNote),
    field("Strike", strikeSel, "The writer, or a wallet that changed the part. Choose No strike to take it down without one."),
    takedown,
    h("h3", { class: "h4" }, ["Block or unblock a wallet"]),
    row(field("Wallet", who), field("Note", blockNote)),
    row(check, statusView),
    row(actionButton("Block", () => planBlock({ account: who.value, blocked: true, noteText: blockNote.value }), { danger: true }),
      actionButton("Unblock", () => planBlock({ account: who.value, blocked: false, noteText: blockNote.value }))),
    h("h3", { class: "h4" }, ["A story"]),
    row(field("Story id", sid)),
    row(actionButton("Clear its summary", () => planClearSummary({ actor: me || d.storiesCfg.admin, storyId: sid.value })),
      actionButton("Take over its final edit", () => planTakeOver(sid.value))),
    h("p", { class: "meta small" }, ["Publishing a new book link after a takedown in a finished book: use node deploy/deploy.js replace-pdf, which recomputes the book's text hash from the chain."]),
  ]);
}

function storiesSettingsSection(d) {
  const c = d.storiesCfg;
  const v = {
    contribution_cap: input(c.contribution_cap || 6000), trial_limit: input(c.trial_limit || 0), open_limit: input(c.open_limit || 10),
    archive_days: input(c.archive_days || 60), inactivity_days: input(c.inactivity_days || 30),
    full_price_projects: input(c.full_price_projects || 3), max_price_multiplier: input(c.max_price_multiplier || 4),
  };
  const labels = {
    contribution_cap: "Longest part (100 to 6,000)", trial_limit: "Promo trial characters (0 to 5,000)", open_limit: "Open projects per wallet (1 to 10)",
    archive_days: "Archive quiet stories after (30 to 365 days)", inactivity_days: "Admin may finalize after (30 to 365 days)",
    full_price_projects: "Projects at the normal price (1 to 10)", max_price_multiplier: "Price ceiling (1 to 1,024 times)",
  };
  const minC = input(c.min_contribution || 20);
  const mod = input(c.moderator || "", { placeholder: "Moderator address, or off" });
  const threshold = input(c.report_threshold || 3);
  const strikes = input(c.strike_limit || 5);
  const termsV = input(String(Number(c.terms_version || 0) + 1));
  const termsUri = input(canonicalBase(SITE.url) + SITE.termsPath);
  const termsText = h("textarea", { rows: "6", placeholder: "Paste the exact Terms of Use text (its fingerprint goes on chain)" });
  const catName = input("");
  return section("Stories settings", "Limits, the copy checker (moderator), Terms of Use and categories.", [
    h("div", { class: "admin-grid" }, Object.keys(v).map((k) => field(labels[k], v[k]))),
    actionButton("Save limits", () => {
      const out = {};
      for (const k of Object.keys(v)) out[k] = v[k].value;
      return planLimits(out);
    }),
    row(field("Shortest new text (1 to 200 characters)", minC)),
    actionButton("Save shortest text", () => planMinContribution(minC.value)),
    h("h3", { class: "h4" }, ["Copy checker and strikes"]),
    row(field("Moderator", mod), field("Reports that hide a part (1 to 20)", threshold), field("Takedowns before a block (1 to 20)", strikes)),
    actionButton("Save moderation", () => planModeration({ moderator: mod.value, threshold: threshold.value, strikes: strikes.value })),
    h("h3", { class: "h4" }, ["Terms of Use (now version " + (c.terms_version || 0) + ")"]),
    row(field("New version", termsV), field("Link", termsUri)),
    termsText,
    actionButton("Publish the Terms", async () => {
      const text = termsText.value;
      if (!text.trim()) throw new AdminInputError("Paste the Terms text first.");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
      return planTerms({ version: termsV.value, hashB64: utils.encodeBase64url(digest), uri: termsUri.value, current: c.terms_version || 0 });
    }),
    h("h3", { class: "h4" }, ["Categories"]),
    h("ul", { class: "admin-list" }, d.categories.map((cat) => h("li", {}, [
      cat.id + ". " + cat.name + (cat.active ? "" : " (hidden)") + " ",
      actionButton(cat.active ? "Hide" : "Show", () => planCategoryActive(cat.id, !cat.active)),
    ]))),
    row(field("New category", catName)),
    actionButton("Add the category", () => planCategory(catName.value)),
  ]);
}

function tokensSection(d) {
  const list = h("table", { class: "admin-table" }, [
    h("tr", {}, ["Token", "Symbol", "Decimals", "Status", ""].map((x) => h("th", {}, [x]))),
    ...d.tokens.map((t) => h("tr", {}, [
      h("td", { class: "mono small" }, [t.address]),
      h("td", {}, [t.symbol]),
      h("td", {}, [String(t.decimals)]),
      h("td", {}, [t.enabled ? (Number(t.usable_from) * 1000 > Date.now() ? "on from " + formatUtc(Number(t.usable_from)) : "on") : "off"]),
      h("td", {}, [t.enabled
        ? actionButton("Turn off", () => planAsset({ token: t.address, enabled: false, decimals: t.decimals, symbol: t.symbol }), { danger: true })
        : actionButton("Turn on", async () => planAsset({ token: t.address, enabled: true, decimals: t.decimals, symbol: t.symbol,
          pin: pinnedToken(t.address), codeHash: await codeHashOf(t.address), others: otherTokens(t.address) }))]),
    ])),
  ]);

  // Add a token: read its decimals and symbol from its own contract, then
  // price the Writer month and the packs from an Ink rate.
  const addr = input("", { placeholder: "Token contract address" });
  const symbol = input("");
  const decimals = input("");
  const rate = input("", { placeholder: "e.g. 100" });
  const prices = {};
  const priceInputs = SHOP_ITEMS.map((item) => {
    prices[item.id] = input("", { placeholder: "not for sale" });
    return field(item.name, prices[item.id]);
  });
  const readStatus = h("p", { class: "meta small" }, []);
  const readBtn = h("button", { type: "button", class: "btn btn-secondary btn-small" }, ["Read the token"]);
  readBtn.addEventListener("click", async () => {
    readStatus.textContent = "Reading…";
    try {
      const c = new Contract({ id: addr.value.trim(), abi: utils.tokenAbi, provider: getProvider() });
      const [dRes, sRes] = await Promise.all([c.functions.decimals({}), c.functions.symbol({})]);
      decimals.value = String(dRes.result ? dRes.result.value : 0);
      symbol.value = String(sRes.result ? sRes.result.value : "");
      readStatus.textContent = "Read from the token contract: " + symbol.value + ", " + decimals.value + " decimals.";
      fillFromRate();
    } catch (error) {
      readStatus.textContent = "Couldn't read that token: " + (error && error.message ? error.message : String(error));
    }
  });
  const rateNote = h("p", { class: "meta small" }, []);
  function fillFromRate() {
    if (!rate.value.trim() || decimals.value === "") return;
    try {
      const shown = [];
      for (const r of RATE_ITEMS) {
        const base = ratePrice(d.shopCfg[r.cfg] || "0", rate.value, Number(decimals.value));
        prices[r.id].value = fromBaseUnits(base, Number(decimals.value));
        shown.push(SHOP_ITEMS.find((i) => i.id === r.id).name + " " + prices[r.id].value);
      }
      rateNote.textContent = "From the rate: " + shown.join(", ") + " " + symbol.value + ". You can change any of them.";
    } catch (error) {
      rateNote.textContent = error.message;
    }
  }
  rate.addEventListener("input", fillFromRate);
  const add = actionButton("Add the token and its prices", async () => {
    const p = {};
    for (const item of SHOP_ITEMS) p[item.id] = prices[item.id].value;
    const token = addr.value.trim();
    return planAddToken({ token, symbol: symbol.value, decimals: decimals.value, prices: p,
      pin: pinnedToken(token), codeHash: await codeHashOf(token), others: otherTokens(token) });
  });
  return section("Payment tokens", "Tokens buyers can pay with. Buyers pick one on the Membership and Open pages. After the Shop's first sale, a newly added token can be used only 7 days later (everyone can see it coming). Turning one off works at once.", [
    list,
    h("h3", { class: "h4" }, ["Add a payment token"]),
    row(field("Token address", addr), readBtn),
    readStatus,
    row(field("Symbol", symbol), field("Decimals", decimals), field("Ink for 1 token", rate, "Prices the Writer month and the packs from the Ink they bring (rounded up).")),
    rateNote,
    h("div", { class: "admin-grid" }, priceInputs),
    add,
    h("p", { class: "meta small" }, ["If the mana sponsor should pay for buyers using the new token, add it to the sponsor's payment tokens below too."]),
  ]);
}

function sponsorSection(d) {
  if (!contracts.sponsor) {
    return section("Mana sponsor", "No mana payer is set in config.js (MANA_PAYER).", []);
  }
  if (contracts.sponsorKind !== "sponsor") {
    return section("Mana sponsor", "The mana payer " + contracts.sponsor + " is not a SwarmTales sponsor contract, so it has its own settings.", []);
  }
  const s = d.sponsorCfg || {};
  const mana = (v, dflt) => (v ? fromBaseUnits(v, 8) : dflt);
  const enabled = checkbox(s.enabled);
  const tokens = input((s.tokens || [contracts.paymentToken]).join(","));
  const perTx = input(mana(s.max_mana_per_tx, SPONSOR_DEFAULT_CAPS.perTx));
  const perAccount = input(mana(s.max_mana_per_account_day, SPONSOR_DEFAULT_CAPS.perAccount));
  const perDay = input(mana(s.max_mana_per_day, SPONSOR_DEFAULT_CAPS.perDay));
  const out = h("div", {}, []);
  const make = h("button", { type: "button", class: "btn btn-secondary btn-small" }, ["Show the command"]);
  make.addEventListener("click", () => {
    try {
      const c = sponsorCommand({
        sponsor: contracts.sponsor, enabled: enabled.checked, ink: contracts.ink, shop: contracts.shop, stories: contracts.stories,
        tokens: tokens.value, perTx: perTx.value, perAccount: perAccount.value, perDay: perDay.value, mainnet: network.mainnet,
      });
      replace(out, notice("ok", [h("p", {}, [c.summary + ". Run this on the computer that holds the sponsor key:"]), h("pre", { class: "mono small" }, [c.command])]));
    } catch (error) {
      replace(out, notice("warn", h("p", {}, [error.message])));
    }
  });
  // The sponsor key stays offline (audit L-17): this page only reads the
  // settings and shows the deploy-tool command that changes them.
  return section("Mana sponsor", "Pays users' mana for the SwarmTales actions new users need, and nothing else. Its settings are changed only with the deploy tool's sponsor-config, on the computer that holds the SPONSOR wallet's key (" + contracts.sponsor + "); this page never asks for that key.", [
    h("p", {}, ["Now: ", h("b", {}, [s.enabled ? "ON" : d.sponsorCfg ? "OFF" : "not set up yet"]),
      d.sponsorCfg ? " · " + mana(s.max_mana_per_tx, "0") + " / " + mana(s.max_mana_per_account_day, "0") + " / " + mana(s.max_mana_per_day, "0") +
        " mana (per transaction / per wallet per day / everyone per day) · " + ((s.calls && s.calls.length) || 0) + " sponsored calls" : ""]),
    h("label", { class: "check" }, [enabled, " Switched on"]),
    field("Payment tokens (comma separated)", tokens),
    row(field("Mana per transaction", perTx), field("Per wallet per day", perAccount), field("Everyone per day", perDay)),
    make,
    out,
  ]);
}

function handoverSection(admins) {
  const which = select([{ value: "ink", label: "Ink" }, { value: "shop", label: "Shop" }, { value: "stories", label: "Stories" }], "stories");
  const to = input("", { placeholder: "New admin address (e.g. the multisig)" });
  return section("Hand over the admin role", "Two steps: the current admin proposes, then the new admin accepts (signed by the new admin; for a multisig, prepare the accept and have the signers cosign).", [
    row(field("Contract", which), field("New admin", to)),
    row(actionButton("1. Propose", () => planSetAdmin(which.value, to.value)),
      actionButton("2. Accept (as the new admin)", () => planAcceptAdmin(which.value))),
  ]);
}

function anySection() {
  const writeMethods = [];
  // Only the admin-gated methods (audit L-21).
  for (const c of Object.keys(ADMIN_METHODS)) {
    if (!ids()[c]) continue;
    for (const m of ADMIN_METHODS[c]) if (abis[c].methods[m]) writeMethods.push({ value: c + "." + m, label: c + "." + m });
  }
  const method = select(writeMethods, "stories.set_paused");
  const json = h("textarea", { rows: "4", placeholder: '{"paused": true}' });
  const desc = h("p", { class: "meta small" }, []);
  const describe = () => {
    const [c, m] = method.value.split(".");
    desc.textContent = (abis[c].methods[m].description || "") + " Arguments: " + argNames(c, m);
  };
  method.addEventListener("change", describe);
  describe();
  return section("Any other admin call", "For anything without its own form above. Arguments are JSON; addresses as text, amounts as text in base units.", [
    field("Method", method),
    desc,
    json,
    actionButton("Run it", () => {
      const [c, m] = method.value.split(".");
      return planAny(abis, c, m, json.value);
    }),
  ]);
}

function argNames(c, m) {
  const type = abis[c].methods[m].argument.split(".")[1];
  const t = abis[c].koilib_types.nested[c].nested[type];
  return Object.keys((t && t.fields) || {}).join(", ") || "(none)";
}
