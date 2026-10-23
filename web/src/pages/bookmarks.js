/**
 * Bookmarks in the wallet: copied in when newer, written out only when the
 * reader asks, in one batched confirmation (audit W1-10).
 */
import { contracts } from "../config.js";
import { encode, read } from "../chain.js";
import { append, h } from "../ui/dom.js";
import * as reading from "../lib/bookmarks.js";
import { isPaused } from "../lib/activity.js";
import { currentAddress, state } from "../app/state.js";
import { plural } from "../app/format.js";
import { failure, statusBox } from "../app/ui.js";
import { send } from "../app/send.js";

/** Copy the wallet's bookmark for a story into this browser when it is newer than the browser's own. */
export async function adoptWalletPlace(me, id, title) {
  const chain = await read("stories", "get_reading_place", { reader: me, story_id: String(id) }).catch(() => null);
  const at = chain ? Number(chain.at || 0) * 1000 : 0;
  if (chain && Number(chain.seq || 0) > 0 && at > reading.markChangedAt(reading.load(contracts.stories, id))) {
    reading.setMark(contracts.stories, id, { seq: Number(chain.seq), chapter: chain.chapter, percent: chain.percent, title }, undefined, at, { fromWallet: true });
  }
}

// KOIN Vault takes at most 6 calls in one request.
const PLACES_PER_CONFIRMATION = 6;

/**
 * "Save to my wallet" for bookmarks kept only in this browser: one
 * confirmation writes up to six of them (set_reading_place), and only when
 * the reader presses it (W1-10). Not offered while Stories is paused (the
 * contract refuses set_reading_place then).
 */
export function walletPlacesControl(pending, lead) {
  const me = currentAddress();
  const box = h("div", { class: "wallet-places" });
  const cfg = state.overview && state.overview.storiesCfg;
  if (isPaused(cfg)) {
    append(box, h("p", {}, [lead + " SwarmTales is paused for maintenance, so it can't go to your wallet right now. It stays saved in this browser."]));
    return box;
  }
  const status = statusBox();
  const batch = pending.slice(0, PLACES_PER_CONFIRMATION);
  const button = h("button", { type: "button", class: "btn btn-secondary btn-small" }, [batch.length === 1 ? "Save to my wallet" : "Save " + batch.length + " to my wallet"]);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const ops = [];
      for (const p of batch) {
        ops.push(await encode("stories", "set_reading_place", {
          reader: me, story_id: String(p.id), seq: String(p.seq), chapter: Number(p.chapter || 0), percent: Math.round(Number(p.percent || 0)),
        }));
      }
      if (await send(ops, status)) {
        reading.markInWallet(contracts.stories, batch);
        button.remove();
        const left = pending.length - batch.length;
        append(status, h("p", { class: "meta small" }, [
          "In your wallet now: it's there on any device you connect." + (left > 0 ? " " + plural(left, "more bookmark") + " waiting: reload this page to save " + (left === 1 ? "it" : "them") + " too." : ""),
        ]));
      }
    } catch (error) {
      failure(status, error);
    } finally {
      button.disabled = false;
    }
  });
  append(box,
    h("p", {}, [lead + " Saving to your wallet keeps your place on every device you connect: one confirmation, a little mana."]),
    button,
    status);
  return box;
}
