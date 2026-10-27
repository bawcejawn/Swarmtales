// =====================================================================
// SwarmTales Editions — tests
//
// The mock VM doesn't run other contracts: each call to Stories, Shop or a
// token takes the next preset answer, in order. The helpers below build
// those answers the way Stories, Shop and a KCS-4 token reply.
// =====================================================================

import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Editions, idKey, idFromKey, shareOf, jsonText } from "../Editions";
import { editions } from "../proto/editions";

const EDITIONS = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const ADMIN = Base58.decode("1HJgvngE2GMMy5Lw4YtzomfMCgrkuJsq91");
const OPENER = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");
const WRITER = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");
const READER = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");
const TREASURY = Base58.decode("1N3NuxjKStJwaNXs7im3hkn2f1R2URvcnu");
const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const SHOP = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const OTHER = Base58.decode("1Jykozr6Y5nZbwWvqSpnJPE1qoPn8PDBnn");
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");

const START: u64 = 1700000000;
const STORY: u64 = 7;
const FINALIZED: u32 = 4;
const PRICE: u64 = 3000000; // $3.00 in a 6-decimal token

// ---------- setup ----------

function setTime(at: u64): void {
  MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0));
}

function signAs(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}

function nobody(): void {
  MockVM.setAuthorities([]);
}

function reset(): void {
  MockVM.reset();
  MockVM.setContractId(EDITIONS);
  MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
  setTime(START);
}

// Admin = the contract until set_admin; the tests sign as it for setup.
function setup(): void {
  reset();
  signAs(EDITIONS);
  const c = new Editions();
  c.set_addresses(new editions.set_addresses_arguments(STORIES, SHOP, TREASURY));
  c.set_payment_token(new editions.set_payment_token_arguments(USDT, new editions.token_settings(true, PRICE, 1000000, 20000000)));
  c.set_site(new editions.set_site_arguments("https://swarmtales.example"));
  MockVM.commitTransaction();
  nobody();
}

function result(bytes: Uint8Array): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(bytes));
}

function ok(): system_calls.exit_arguments {
  return result(new Uint8Array(0));
}

function story(status: u32, min: u64, sum: u64, needsPdf: bool = false, title: string = "The \"Hive\" Book"): system_calls.exit_arguments {
  const st = new editions.stories_story(OPENER, title, status, min, needsPdf, sum);
  return result(Protobuf.encode(st, editions.stories_story.encode));
}

function surviving(value: u64): system_calls.exit_arguments {
  return result(Protobuf.encode(new editions.uint64(value), editions.uint64.encode));
}

function asset(enabled: bool, usableFrom: u64): system_calls.exit_arguments {
  return result(Protobuf.encode(new editions.shop_asset(enabled, usableFrom), editions.shop_asset.encode));
}

function bal(value: u64): system_calls.exit_arguments {
  return result(Protobuf.encode(new editions.token_balance_answer(value), editions.token_balance_answer.encode));
}

function err(): system_calls.exit_arguments {
  return new system_calls.exit_arguments(-1, new chain.result(null, new chain.error_data("rejected")));
}

// The answers one honest sale gets, in order: story, Shop asset,
// treasury and pool balances, two transfers, both balances again.
function saleAnswers(price: u64, pool: u64, sum: u64 = 400): system_calls.exit_arguments[] {
  const toTreasury = price * 2000 / 10000;
  const toWriters = price - toTreasury;
  return [story(FINALIZED, 50, sum), asset(true, 0), bal(0), bal(pool), ok(), ok(), bal(toTreasury), bal(pool + toWriters)];
}

function buy(price: u64 = PRICE, pool: u64 = 0, sum: u64 = 400): void {
  MockVM.setCallContractResults(saleAnswers(price, pool, sum));
  signAs(READER);
  new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, price));
  MockVM.commitTransaction();
  nobody();
}

function tokenId(n: u64): Uint8Array {
  return idKey(n);
}

function fails(fn: () => void, message: string): void {
  expect(fn).toThrow();
  expect(MockVM.getErrorMessage()).toBe(message);
  MockVM.rollbackTransaction();
}

function events(name: string): Uint8Array[] {
  System.setSystemBufferSize(65536);
  const all = MockVM.getEvents();
  const out: Uint8Array[] = [];
  for (let i = 0; i < all.length; i++) if (all[i].name == name) out.push(all[i].data!);
  return out;
}

// ---------- tests ----------

describe("helpers", () => {
  it("token ids are 8 bytes big-endian", () => {
    const k = idKey(258);
    expect(k.length).toBe(8);
    expect(k[6]).toBe(1);
    expect(k[7]).toBe(2);
    expect(idFromKey(k)).toBe(258);
    expect(idFromKey(idKey(u64.MAX_VALUE))).toBe(u64.MAX_VALUE);
  });

  it("shareOf is floor(a*b/c) without overflow", () => {
    expect(shareOf(800, 300, 400)).toBe(600);
    expect(shareOf(800, 100, 400)).toBe(200);
    expect(shareOf(10, 1, 3)).toBe(3);
    expect(shareOf(u64.MAX_VALUE, 1, 2)).toBe(u64.MAX_VALUE / 2);
    expect(shareOf(u64.MAX_VALUE, 999999, 1000000)).toBe(u64.MAX_VALUE / 1000000 * 999999 + (u64.MAX_VALUE % 1000000) * 999999 / 1000000);
    expect(shareOf(500, 0, 0)).toBe(0);
  });

  it("jsonText escapes quotes, backslashes and control characters", () => {
    expect(jsonText("a\"b\\c\nd")).toBe("a\\\"b\\\\c\\u000ad");
  });
});

describe("settings", () => {
  beforeEach(() => { setup(); });

  it("starts with a 20% platform share and the contract as admin", () => {
    const cfg = new Editions().get_config(new editions.get_config_arguments());
    expect(cfg.platform_bps).toBe(2000);
    expect(Base58.encode(cfg.admin!)).toBe(Base58.encode(EDITIONS));
    expect(cfg.payment_tokens.length).toBe(1);
  });

  it("sets Stories and Shop once", () => {
    signAs(EDITIONS);
    fails(() => { new Editions().set_addresses(new editions.set_addresses_arguments(OTHER, SHOP, TREASURY)); }, "EDITIONS: the Stories address is already set");
    fails(() => { new Editions().set_addresses(new editions.set_addresses_arguments(STORIES, OTHER, TREASURY)); }, "EDITIONS: the Shop address is already set");
    new Editions().set_addresses(new editions.set_addresses_arguments(STORIES, SHOP, OTHER));
    expect(Base58.encode(new Editions().get_config(new editions.get_config_arguments()).treasury!)).toBe(Base58.encode(OTHER));
  });

  it("refuses settings without the admin", () => {
    signAs(MALLORY);
    fails(() => { new Editions().set_platform_bps(new editions.set_platform_bps_arguments(0)); }, "EDITIONS: admin authority required");
    fails(() => { new Editions().set_paused(new editions.set_paused_arguments(true)); }, "EDITIONS: admin authority required");
  });

  it("caps the platform share at 30%", () => {
    signAs(EDITIONS);
    fails(() => { new Editions().set_platform_bps(new editions.set_platform_bps_arguments(3001)); }, "EDITIONS: the platform share can't be above 30%");
    new Editions().set_platform_bps(new editions.set_platform_bps_arguments(3000));
  });

  it("checks token price ranges and allows at most 4 tokens", () => {
    signAs(EDITIONS);
    fails(() => {
      new Editions().set_payment_token(new editions.set_payment_token_arguments(OTHER, new editions.token_settings(true, 5, 10, 20)));
    }, "EDITIONS: prices must satisfy 0 < min <= default <= max");
    fails(() => {
      new Editions().set_payment_token(new editions.set_payment_token_arguments(STORIES, new editions.token_settings(true, 5, 1, 20)));
    }, "EDITIONS: a payment token can't be a SwarmTales contract");
    const tokens = [OTHER, MALLORY, READER];
    for (let i = 0; i < tokens.length; i++) {
      new Editions().set_payment_token(new editions.set_payment_token_arguments(tokens[i], new editions.token_settings(true, 5, 1, 20)));
    }
    fails(() => {
      new Editions().set_payment_token(new editions.set_payment_token_arguments(WRITER, new editions.token_settings(true, 5, 1, 20)));
    }, "EDITIONS: at most 4 payment tokens");
  });

  it("refuses an https-less site", () => {
    signAs(EDITIONS);
    fails(() => { new Editions().set_site(new editions.set_site_arguments("javascript:alert(1)")); }, "EDITIONS: the site address must start with https://");
  });

  it("hands the admin over in two steps", () => {
    signAs(EDITIONS);
    new Editions().set_admin(new editions.set_admin_arguments(ADMIN));
    MockVM.commitTransaction();
    signAs(MALLORY);
    fails(() => { new Editions().accept_admin(new editions.accept_admin_arguments()); }, "EDITIONS: only the proposed admin can accept");
    signAs(ADMIN);
    new Editions().accept_admin(new editions.accept_admin_arguments());
    expect(Base58.encode(new Editions().owner(new editions.owner_arguments()).value!)).toBe(Base58.encode(ADMIN));
  });

  it("must be called straight from the transaction", () => {
    MockVM.setCaller(new chain.caller_data(OTHER, chain.privilege.user_mode));
    signAs(READER);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); },
      "EDITIONS: call SwarmTales directly from your wallet, not through another contract");
  });
});

describe("collector's editions", () => {
  beforeEach(() => { setup(); });

  it("sells a numbered edition and splits the price 80/20", () => {
    buy();
    const sales = events("editions.sale_event");
    expect(sales.length).toBe(1);
    const sale = Protobuf.decode<editions.sale_event>(sales[0], editions.sale_event.decode);
    expect(sale.price).toBe(PRICE);
    expect(sale.to_treasury).toBe(600000);
    expect(sale.to_writers).toBe(2400000);
    expect(sale.number).toBe(1);
    const c = new Editions();
    const ed = c.get_edition(new editions.get_edition_arguments(1));
    expect(Base58.encode(ed.owner!)).toBe(Base58.encode(READER));
    expect(ed.kind).toBe(editions.edition_kind.EDITION_COLLECTOR);
    expect(c.balance_of(new editions.balance_of_arguments(READER)).value).toBe(1);
    expect(c.total_supply(new editions.total_supply_arguments()).value).toBe(1);
    const pot = c.get_pot(new editions.get_pot_arguments(STORY, USDT));
    expect(pot.received).toBe(2400000);
    expect(pot.sales).toBe(1);
    expect(events("collections.mint_event").length).toBe(1);
  });

  it("sends the right transfers", () => {
    buy();
    // The mock records no call payloads, so check the outcome checks instead:
    // a treasury balance that doesn't rise by its share is refused.
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), asset(true, 0), bal(0), bal(0), ok(), ok(), bal(1), bal(2400000)]);
    signAs(READER);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); }, "EDITIONS: payment did not arrive");
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), asset(true, 0), bal(0), bal(0), ok(), ok(), bal(600000), bal(1)]);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); }, "EDITIONS: payment did not arrive");
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), asset(true, 0), bal(0), bal(0), err()]);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); }, "rejected");
  });

  it("numbers editions of a book in order", () => {
    buy();
    buy(PRICE, 2400000);
    const ed = new Editions().get_edition(new editions.get_edition_arguments(2));
    expect(ed.number).toBe(2);
    expect(new Editions().get_book_editions(new editions.get_book_editions_arguments(STORY)).collector_count).toBe(2);
  });

  it("writes on-chain metadata with the title escaped", () => {
    buy();
    const meta = new Editions().metadata_of(new editions.metadata_of_arguments(tokenId(1))).value!;
    expect(meta.includes("\"name\":\"The \\\"Hive\\\" Book: Collector's Edition No. 1\"")).toBe(true);
    expect(meta.includes("\"transferable\":true")).toBe(true);
    expect(meta.includes("\"external_url\":\"https://swarmtales.example/#/stories/7\"")).toBe(true);
    expect(meta.includes("not an investment")).toBe(true);
  });

  it("refuses unfinished books, books being republished and empty books", () => {
    signAs(READER);
    MockVM.setCallContractResults([story(1, 50, 400)]);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); }, "EDITIONS: editions are made only of finished books");
    MockVM.setCallContractResults([story(FINALIZED, 50, 400, true)]);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); },
      "EDITIONS: this book is being updated after a takedown; editions are on sale again once it's republished");
    MockVM.setCallContractResults([story(FINALIZED, 50, 0)]);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); }, "EDITIONS: this book has no surviving text to share");
  });

  it("needs the buyer's signature and their price limit", () => {
    signAs(MALLORY);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); }, "EDITIONS: the buyer must sign");
    signAs(READER);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), asset(true, 0)]);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE - 1)); },
      "EDITIONS: the price is 3000000, more than the most you agreed to pay. Nothing was charged.");
  });

  it("uses only tokens the Shop accepts and that have waited", () => {
    signAs(READER);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), asset(false, 0)]);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); }, "EDITIONS: that token isn't accepted by the Shop");
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), asset(true, START + 10)]);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); }, "EDITIONS: this token was enabled recently and can't be used yet");
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), asset(true, 0)]);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, OTHER, PRICE)); }, "EDITIONS: this book isn't on sale in that token");
  });

  it("stops sales while paused", () => {
    signAs(EDITIONS);
    new Editions().set_paused(new editions.set_paused_arguments(true));
    signAs(READER);
    fails(() => { new Editions().buy_edition(new editions.buy_edition_arguments(READER, STORY, USDT, PRICE)); }, "EDITIONS: editions are paused");
  });

  it("lets the holder give it away, and nobody else", () => {
    buy();
    signAs(MALLORY);
    fails(() => { new Editions().transfer(new editions.transfer_arguments(READER, MALLORY, tokenId(1), "")); }, "EDITIONS: the holder must sign");
    fails(() => { new Editions().transfer(new editions.transfer_arguments(MALLORY, OTHER, tokenId(1), "")); }, "EDITIONS: that wallet doesn't hold this edition");
    signAs(READER);
    new Editions().transfer(new editions.transfer_arguments(READER, OTHER, tokenId(1), "a gift"));
    const c = new Editions();
    expect(Base58.encode(c.owner_of(new editions.owner_of_arguments(tokenId(1))).value!)).toBe(Base58.encode(OTHER));
    expect(c.balance_of(new editions.balance_of_arguments(READER)).value).toBe(0);
    expect(c.balance_of(new editions.balance_of_arguments(OTHER)).value).toBe(1);
    expect(c.get_tokens_by_owner(new editions.get_tokens_by_owner_arguments(READER, null, 10, false)).values.length).toBe(0);
    expect(c.get_tokens_by_owner(new editions.get_tokens_by_owner_arguments(OTHER, null, 10, false)).values.length).toBe(1);
  });

  it("refuses approvals", () => {
    buy();
    signAs(READER);
    fails(() => { new Editions().approve(new editions.approve_arguments(READER, OTHER, tokenId(1), "", true)); },
      "EDITIONS: approvals aren't offered; the holder sends editions directly");
    fails(() => { new Editions().set_approval_for_all(new editions.set_approval_for_all_arguments(READER, OTHER, true, "")); },
      "EDITIONS: approvals aren't offered; the holder sends editions directly");
    expect(new Editions().is_approved_for_all(new editions.is_approved_for_all_arguments(READER, OTHER)).value).toBe(false);
  });

  it("lets the holder burn it", () => {
    buy();
    signAs(MALLORY);
    fails(() => { new Editions().burn(new editions.burn_arguments(tokenId(1), "")); }, "EDITIONS: the holder must sign");
    signAs(READER);
    new Editions().burn(new editions.burn_arguments(tokenId(1), ""));
    const c = new Editions();
    expect(c.total_supply(new editions.total_supply_arguments()).value).toBe(0);
    expect(c.owner_of(new editions.owner_of_arguments(tokenId(1))).value!.length).toBe(0);
    expect(c.balance_of(new editions.balance_of_arguments(READER)).value).toBe(0);
  });

  it("lists editions in both directions", () => {
    buy();
    buy(PRICE, 2400000);
    buy(PRICE, 4800000);
    const c = new Editions();
    const up = c.get_tokens(new editions.get_tokens_arguments(null, 2, false)).values;
    expect(up.length).toBe(2);
    expect(idFromKey(up[0])).toBe(1);
    const next = c.get_tokens(new editions.get_tokens_arguments(up[1], 10, false)).values;
    expect(next.length).toBe(1);
    expect(idFromKey(next[0])).toBe(3);
    const down = c.get_tokens(new editions.get_tokens_arguments(null, 10, true)).values;
    expect(idFromKey(down[0])).toBe(3);
    const mineDown = c.get_tokens_by_owner(new editions.get_tokens_by_owner_arguments(READER, null, 2, true)).values;
    expect(mineDown.length).toBe(2);
    expect(idFromKey(mineDown[0])).toBe(3);
    expect(idFromKey(mineDown[1])).toBe(2);
  });
});

describe("opener's price", () => {
  beforeEach(() => { setup(); });

  it("lets only the opener choose, inside the range", () => {
    MockVM.setCallContractResults([story(FINALIZED, 50, 400)]);
    signAs(MALLORY);
    fails(() => { new Editions().set_book_price(new editions.set_book_price_arguments(MALLORY, STORY, USDT, 5000000)); },
      "EDITIONS: only the story's opener sets its price");
    signAs(OPENER);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400)]);
    fails(() => { new Editions().set_book_price(new editions.set_book_price_arguments(OPENER, STORY, USDT, 99)); },
      "EDITIONS: choose a price from 1000000 to 20000000");
    MockVM.setCallContractResults([story(FINALIZED, 50, 400)]);
    new Editions().set_book_price(new editions.set_book_price_arguments(OPENER, STORY, USDT, 5000000));
    expect(new Editions().get_price(new editions.get_price_arguments(STORY, USDT)).value).toBe(5000000);
  });

  it("keeps a chosen price inside a later range", () => {
    signAs(OPENER);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400)]);
    new Editions().set_book_price(new editions.set_book_price_arguments(OPENER, STORY, USDT, 15000000));
    signAs(EDITIONS);
    new Editions().set_payment_token(new editions.set_payment_token_arguments(USDT, new editions.token_settings(true, PRICE, 1000000, 10000000)));
    expect(new Editions().get_price(new editions.get_price_arguments(STORY, USDT)).value).toBe(10000000);
    new Editions().set_payment_token(new editions.set_payment_token_arguments(USDT, new editions.token_settings(false, 0, 0, 0)));
    expect(new Editions().get_price(new editions.get_price_arguments(STORY, USDT)).value).toBe(0);
  });
});

describe("writers' editions", () => {
  beforeEach(() => { setup(); });

  it("gives the opener a First Edition", () => {
    signAs(OPENER);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400)]);
    new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(OPENER, STORY));
    const c = new Editions();
    const n = c.get_writer_edition(new editions.get_writer_edition_arguments(STORY, OPENER)).value;
    expect(n).toBe(1);
    expect(c.get_edition(new editions.get_edition_arguments(n)).kind).toBe(editions.edition_kind.EDITION_FIRST);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400)]);
    fails(() => { new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(OPENER, STORY)); },
      "EDITIONS: you already claimed your edition of this book");
  });

  it("gives a writer at the minimum a Contributor Edition, and not one below it", () => {
    signAs(WRITER);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), surviving(49)]);
    fails(() => { new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(WRITER, STORY)); },
      "EDITIONS: your text in the finished book is 49 characters; a Contributor Edition needs 50");
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), surviving(50)]);
    new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(WRITER, STORY));
    const ed = new Editions().get_edition(new editions.get_edition_arguments(1));
    expect(ed.kind).toBe(editions.edition_kind.EDITION_CONTRIBUTOR);
    expect(new Editions().metadata_of(new editions.metadata_of_arguments(tokenId(1))).value!.includes("\"transferable\":false")).toBe(true);
  });

  it("needs at least one surviving character when the story's minimum is 0", () => {
    signAs(READER);
    MockVM.setCallContractResults([story(FINALIZED, 0, 400), surviving(0)]);
    fails(() => { new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(READER, STORY)); },
      "EDITIONS: your text in the finished book is 0 characters; a Contributor Edition needs 1");
  });

  it("needs a finished book and the writer's signature", () => {
    signAs(MALLORY);
    fails(() => { new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(WRITER, STORY)); }, "EDITIONS: the writer must sign");
    signAs(WRITER);
    MockVM.setCallContractResults([story(3, 50, 400)]);
    fails(() => { new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(WRITER, STORY)); }, "EDITIONS: editions are made only of finished books");
  });

  it("can't be moved", () => {
    signAs(OPENER);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400)]);
    new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(OPENER, STORY));
    fails(() => { new Editions().transfer(new editions.transfer_arguments(OPENER, OTHER, tokenId(1), "")); },
      "EDITIONS: First and Contributor Editions stay with their writer");
  });

  it("stays claimed after it is burned", () => {
    signAs(OPENER);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400)]);
    new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(OPENER, STORY));
    new Editions().burn(new editions.burn_arguments(tokenId(1), ""));
    MockVM.setCallContractResults([story(FINALIZED, 50, 400)]);
    fails(() => { new Editions().claim_writer_edition(new editions.claim_writer_edition_arguments(OPENER, STORY)); },
      "EDITIONS: you already claimed your edition of this book");
  });
});

// Opener 300 surviving, writer 100: 3:1.
function earnings(who: Uint8Array, mine: u64, sum: u64 = 400): editions.earnings {
  MockVM.setCallContractResults([story(FINALIZED, 50, sum), surviving(mine)]);
  return new Editions().get_earnings(new editions.get_earnings_arguments(STORY, USDT, who));
}

function claim(who: Uint8Array, mine: u64, owed: u64, pool: u64, sum: u64 = 400): void {
  MockVM.setCallContractResults([story(FINALIZED, 50, sum), surviving(mine), bal(0), bal(pool), ok(), bal(owed), bal(pool - owed)]);
  new Editions().claim_earnings(new editions.claim_earnings_arguments(who, STORY, USDT));
  MockVM.commitTransaction();
}

describe("writers' earnings", () => {
  beforeEach(() => { setup(); });

  it("shares the writers' part by surviving text", () => {
    buy();
    expect(earnings(OPENER, 300).owed).toBe(1800000);
    expect(earnings(WRITER, 100).owed).toBe(600000);
    expect(earnings(READER, 0).owed).toBe(0);
  });

  it("pays a writer once per sale, and anyone may trigger it", () => {
    buy();
    signAs(MALLORY);
    claim(WRITER, 100, 600000, 2400000);
    expect(earnings(WRITER, 100).owed).toBe(0);
    expect(earnings(WRITER, 100).paid).toBe(600000);
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), surviving(100)]);
    fails(() => { new Editions().claim_earnings(new editions.claim_earnings_arguments(WRITER, STORY, USDT)); }, "EDITIONS: nothing to claim yet");
    buy(PRICE, 1800000);
    expect(earnings(WRITER, 100).owed).toBe(600000);
    const pot = new Editions().get_pot(new editions.get_pot_arguments(STORY, USDT));
    expect(pot.paid).toBe(600000);
    expect(pot.received).toBe(4800000);
  });

  it("refuses a payout that doesn't arrive", () => {
    buy();
    MockVM.setCallContractResults([story(FINALIZED, 50, 400), surviving(100), bal(0), bal(2400000), ok(), bal(1), bal(1800000)]);
    fails(() => { new Editions().claim_earnings(new editions.claim_earnings_arguments(WRITER, STORY, USDT)); }, "EDITIONS: payout did not arrive");
  });

  it("never pays a book out beyond what it received when shares change", () => {
    buy();
    // The opener (300 of 400) is paid 1,800,000 ...
    claim(OPENER, 300, 1800000, 2400000);
    // ... then a takedown removes the writer's 100: the opener is the whole
    // book now and is owed only what's left in the pot (600,000), not more.
    expect(earnings(OPENER, 300, 300).owed).toBe(600000);
    claim(OPENER, 300, 600000, 600000, 300);
    const pot = new Editions().get_pot(new editions.get_pot_arguments(STORY, USDT));
    expect(pot.paid).toBe(pot.received);
    expect(earnings(WRITER, 0, 300).owed).toBe(0);
  });

  it("works while paused", () => {
    buy();
    signAs(EDITIONS);
    new Editions().set_paused(new editions.set_paused_arguments(true));
    claim(WRITER, 100, 600000, 2400000);
  });

  it("keeps a writer's share inside the whole even if Stories disagrees", () => {
    buy();
    expect(earnings(WRITER, 900, 400).owed).toBe(2400000);
  });
});
