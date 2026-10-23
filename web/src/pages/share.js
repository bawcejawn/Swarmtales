/**
 * Share & invite panel: reading links, invite links, the writers' pool and
 * editors.
 */
import { SITE } from "../config.js";
import { encode, read } from "../chain.js";
import { explainFailure } from "../lib/errors.js";
import { buildInviteLink, findInviteId, generateLinkKey } from "../lib/links.js";
import { append, h, replace } from "../ui/dom.js";
import { siteLink } from "../lib/site.js";
import { siteBase, state } from "../app/state.js";
import { num, plural } from "../app/format.js";
import { copyButton, failure, field, notice, statusBox } from "../app/ui.js";
import { refreshAccount } from "../app/data.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";
import { giftSection } from "./membership.js";

/** Share & invite: shown to the opener (and, partly, to editors). */
export function sharePanel(id, story, me, flags) {
  const isOpener = !!me && story.opener === me;
  const isEditor = !!me && !!(flags && flags.editor);
  const vis = Number(story.visibility);
  const link = siteLink(SITE.url, "stories/" + id);
  const isPrivate = vis !== 1;
  const canManage = (isOpener || isEditor) && Number(story.status) < 4;
  const panel = h("section", { class: "card share-panel", "aria-labelledby": "share-title" }, [
    h("h2", { class: "aside-title", id: "share-title" }, [isOpener ? "Share & invite" : "Share"]),
    h("p", { class: "body-2 small" }, [isPrivate
      ? "Private: only people you invite can write. Anyone with the reading link can read."
      : "Public: listed in Discover. Anyone can read, and anyone with a Writer month can write."]),
  ]);
  if (/[?&]new=1/.test(location.hash) && isOpener) {
    panel.prepend(notice("ok", h("p", {}, ["Your story is open. It's saved under ", h("a", { href: "#/mine" }, ["My stories"]), "."])));
  }
  // One tidy block per job. The first one the opener needs is open.
  const tool = (title, what, body, open) => h("details", { class: "share-tool", open: open ? true : null }, [
    h("summary", {}, [h("b", {}, [title]), h("span", { class: "meta small" }, [what])]),
    h("div", { class: "share-tool-body" }, body),
  ]);
  const readingTool = tool(
    isPrivate ? "Share for reading" : "Share the story",
    isPrivate ? "A link to read the story. It does not let anyone write." : "Anyone with this link can read it, and write with a Writer month.",
    [
      h("p", { class: "mono small share-link" }, [link]),
      h("div", { class: "row" }, [copyButton(link, isPrivate ? "Copy reading link" : "Copy link")]),
    ],
    !(isPrivate && isOpener && canManage)
  );
  if (!canManage) {
    append(panel, readingTool);
    return panel;
  }

  if (isPrivate && isOpener) {
    const uses = h("input", { type: "number", min: "1", max: "1000", value: "5", inputmode: "numeric" });
    const days = h("input", { type: "number", min: "1", max: "365", value: "14", inputmode: "numeric" });
    const out = h("div");
    const status = statusBox();
    const make = h("button", { type: "submit", class: "btn btn-primary btn-small" }, ["Create invite link"]);
    append(panel, tool("Invite writers", "A link that lets people join and write. Send it privately.", [h("form", { class: "invite-form", onSubmit: async (event) => {
      event.preventDefault();
      make.disabled = true;
      replace(out);
      try {
        const n = Number(uses.value);
        const d = Number(days.value);
        if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error("People per link must be 1 to 1,000.");
        if (!Number.isInteger(d) || d < 1 || d > 365) throw new Error("Days must be 1 to 365.");
        const key = generateLinkKey();
        const expires = String(Math.floor(Date.now() / 1000) + d * 86400);
        const op = await encode("stories", "create_invite", {
          opener: me, story_id: String(id), link_signer: key.address, max_uses: n, expires_at: expires,
        });
        const before = Number((await read("stories", "get_story", { story_id: String(id) })).next_invite_id || 1);
        const sent = await send([op], status);
        // Read the invite back and use the id that holds this link's key
        // (AB-008): never a link for an invite that isn't on the record.
        const showLink = async () => {
          const inviteId = await findInviteId({
            before,
            linkSigner: key.address,
            readNextId: async () => Number((await read("stories", "get_story", { story_id: String(id) })).next_invite_id || 0),
            readInvite: (n) => read("stories", "get_invite", { story_id: String(id), invite_id: String(n) }),
          });
          if (!inviteId) return false;
          const invite = buildInviteLink(siteBase(), id, inviteId, key.secret);
          replace(out,
            notice("ok", [
              h("p", {}, ["Your invite link is ready. It works for " + plural(n, "person", "people") + " for " + plural(d, "day") + "."]),
              h("p", { class: "mono small share-link" }, [invite]),
            ]),
            h("div", { class: "row" }, [copyButton(invite, "Copy invite link")]),
            h("p", { class: "meta small" }, ["Copy it now: this page can't show it again. Anyone who has it can join, so send it privately."])
          );
          return true;
        };
        if (sent && await showLink()) return;
        // Not confirmed yet, or not found: this page still holds the link's
        // key, so the opener can look again instead of losing the link.
        const stillMissing = h("p", { class: "meta small" });
        const again = h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: async () => {
          again.disabled = true;
          stillMissing.textContent = "";
          try {
            if (!(await showLink())) stillMissing.textContent = "It isn't on the record yet. Try again in a minute.";
          } catch (error) {
            stillMissing.textContent = explainFailure(error);
          } finally {
            again.disabled = false;
          }
        } }, ["Look for the invite again"]);
        replace(out,
          notice("warn", h("p", {}, [
            sent ? "The invite was sent, but we couldn't find it on the record yet." : "This invite isn't confirmed, so there's no link to share yet.",
            " Keep this page open and look again in a minute. If it never appears, create a new invite: this one's link can't be used.",
          ])),
          h("div", { class: "row" }, [again]),
          stillMissing
        );
      } catch (error) {
        failure(status, error);
      } finally {
        make.disabled = false;
      }
    } }, [
      h("p", { class: "meta small" }, ["Each person who opens the link joins with one confirmation. Their parts are paid from the writers' pool while it has enough Ink. They also need a Writer month (see below)."]),
      h("p", { class: "meta small" }, ["When you remove a writer, revoke the invite link they used and send a new one to everyone else."]),
      h("div", { class: "form-grid" }, [field("People", uses), field("Days it works", days)]),
      h("div", { class: "actions" }, [make]),
      status,
      out,
    ])], true));
  }
  append(panel, readingTool);
  if (isPrivate && isOpener) {
    append(panel,
      tool("Writers' pool", num(story.fund || 0) + " Ink left. Pays for your writers' parts.", [poolSection(id, story, me)]),
      tool("Pay for a Writer month", "Invited writers need one. You can pay for theirs.", [giftSection(me)]));
  }

  if (isOpener) {
    const who = h("input", { type: "text", placeholder: "Wallet address (starts with 1)", autocomplete: "off", spellcheck: "false" });
    const status = statusBox();
    const act = (allowed) => async () => {
      try {
        const account = who.value.trim();
        if (!/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(account)) throw new Error("That doesn't look like a wallet address.");
        const op = await encode("stories", "set_editor", { opener: me, story_id: String(id), account, allowed });
        if (await send([op], status)) who.value = "";
      } catch (error) {
        failure(status, error);
      }
    };
    append(panel, tool("Editors", "People who can fix and remove parts, like you.", [h("div", { class: "editor-form" }, [
      h("p", { class: "meta small" }, [vis === 1
        ? "Editors can remove parts that writer reports hid, like you can, and write without a Writer month. They use their own Ink, and pay for changes to other writers' parts like anyone. Up to 10."
        : "Editors can remove parts that writer reports hid, like you can. In this story they write like invited writers: new parts from the pool, with a Writer month; changes to other writers' parts with their own Ink. Up to 10."]),
      field("Editor's wallet", who),
      h("div", { class: "row" }, [
        h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: act(true) }, ["Add editor"]),
        h("button", { type: "button", class: "text-button", onClick: act(false) }, ["Remove editor"]),
      ]),
      status,
    ])]));
  }
  return panel;
}

/** The opener's writers' pool: balance and top-up. */
function poolSection(id, story, me) {
  const amount = h("input", { type: "number", min: "1", value: "5000", step: "1", inputmode: "numeric" });
  const status = statusBox();
  const add = h("button", { type: "submit", class: "btn btn-secondary btn-small" }, ["Add to the pool"]);
  const open = Number(story.status) === 1;
  return h("form", { class: "pool-form", onSubmit: async (event) => {
    event.preventDefault();
    add.disabled = true;
    try {
      const n = amount.value.trim();
      if (!/^[1-9][0-9]*$/.test(n)) throw new Error("Enter a whole number of Ink, 1 or more.");
      if (BigInt(n) > BigInt(state.account && state.account.ink ? state.account.ink : "0")) {
        throw new Error("You have " + num(state.account ? state.account.ink : 0) + " Ink. Buy an Ink pack on the Membership page first.");
      }
      const op = await encode("stories", "top_up_fund", { opener: me, story_id: String(id), amount: n });
      if (await send([op], status)) {
        await refreshAccount();
        renderPage();
      }
    } catch (error) {
      failure(status, error);
    } finally {
      add.disabled = false;
    }
  } }, [
    h("p", { class: "body-2" }, [h("b", {}, [num(story.fund || 0) + " Ink left"]), " of " + num(story.fund_added || 0) + " you've put in."]),
    h("p", { class: "meta small" }, [
      "New parts in this story are paid from the pool while it has enough Ink for them; after that, writers pay with their own Ink. " +
        "The pool never pays for changes: a change to someone's part, or letters a writer adds to their own part, is paid by whoever makes it. " +
        "When a pool-paid part is shortened or removed, its Ink goes back to the pool. Whatever is left returns to you when the story is finished or archived.",
    ]),
    open ? h("div", { class: "form-grid" }, [field("Ink to add", amount, "You have " + num(state.account ? state.account.ink : 0) + " Ink")]) : null,
    open ? h("div", { class: "actions" }, [add, h("a", { href: "#/membership", class: "meta" }, ["Buy an Ink pack"])]) : null,
    status,
  ]);
}
