/**
 * Promo and invite link landing pages. Link keys are taken out of the address
 * bar before anything is drawn (audit W1-06).
 */
import { utils } from "koilib";
import { contracts, network } from "../config.js";
import { encode, read } from "../chain.js";
import { explainFailure } from "../lib/errors.js";
import { formatUtc, shortAddress } from "../lib/money.js";
import { BLOCKED_PROBLEM, assessPromo } from "../lib/rules.js";
import { captureLinkSecret, signInviteJoin, signPromoClaim } from "../lib/links.js";
import { append, h, icons, replace } from "../ui/dom.js";
import { currentAddress, state, walletName } from "../app/state.js";
import { clip, num } from "../app/format.js";
import { connectButton, failure, loadingLine, notice, problemsNotice, setMeta, statusBox, trustNote, walletNote } from "../app/ui.js";
import { firstLine, refreshAccount } from "../app/data.js";
import { send } from "../app/send.js";

function landingSteps(stepTwoTitle, stepTwoText) {
  const address = currentAddress();
  return h("ol", { class: "steps" }, [
    h("li", {}, [
      address ? h("span", { class: "step-dot done", "aria-hidden": "true" }, [icons.check()]) : h("span", { class: "step-dot", "aria-hidden": "true" }, ["1"]),
      h("div", {}, [
        h("p", {}, [h("b", {}, [address ? "Wallet connected" : "Connect your wallet"])]),
        h("p", { class: "meta" }, [address ? walletName() + " · " + shortAddress(address) : "Kondor on a computer. It's free to install."]),
      ]),
    ]),
    h("li", {}, [
      h("span", { class: "step-dot", "aria-hidden": "true" }, ["2"]),
      h("div", {}, [h("p", {}, [h("b", {}, [stepTwoTitle])]), h("p", { class: "meta" }, [stepTwoText])]),
    ]),
  ]);
}

// Link secrets read from the address bar, by route. boot() and every hash
// change take them out of the URL before anything is drawn, so they stay out
// of browser history and anything that copies the address (W1-06, AB-013).
// Re-renders read them here.
export const linkSecrets = new Map();

function takeLinkSecret() {
  return captureLinkSecret(window, linkSecrets);
}

export function renderPromo(page, campaignId) {
  setMeta("Free Ink", "Claim free Ink to start writing on SwarmTales.");
  const linkSecret = takeLinkSecret();
  const main = h("div", { class: "landing" });
  append(page, main);
  const card = h("div", { class: "card card-lg" }, [
    h("p", { class: "eyebrow" }, ["A gift of Ink"]),
    h("h1", { class: "title" }, ["Free Ink to start writing"]),
    h("p", { class: "lede" }, ["Ink is your writing allowance on SwarmTales. Claim it once with your wallet, then add a part to any open story."]),
  ]);
  const facts = h("dl", { class: "facts" });
  append(main, card, facts);

  if (!linkSecret) {
    append(card, notice("warn", h("p", {}, ["This link is missing its key, the part after the “?k=”. Open the full link exactly as it was shared."])));
    return;
  }
  if (!state.overview) {
    append(card, loadingLine(state.chainError ? "This page will work when the network answers." : "Checking the promo…"));
    return;
  }
  const cfg = state.overview.shopCfg;
  read("shop", "get_campaign", { campaign_id: String(campaignId) }).then((campaign) => {
    if (!campaign) return;
    append(facts, 
      h("div", {}, [h("dt", {}, ["You receive"]), h("dd", {}, [num(campaign.amount) + " Ink"])]),
      formatUtc(campaign.ends_at) ? h("div", {}, [h("dt", {}, ["Offer ends"]), h("dd", {}, [formatUtc(campaign.ends_at)])]) : null,
      h("div", {}, [h("dt", {}, ["Limit"]), h("dd", {}, ["One claim per wallet for this promo"])])
    );
    if (!campaign.enabled) append(card, notice("warn", h("p", {}, ["This promo has been switched off."])));
  }).catch(() => {});

  const address = currentAddress();
  append(card, landingSteps("Claim with one confirmation", "Your wallet asks you to approve. Claiming is free."));
  const status = statusBox();
  const actions = h("div", { class: "actions" });
  append(card, actions, status);
  if (!address) {
    append(actions, connectButton());
  } else if (!state.account) {
    append(actions, loadingLine("Reading your wallet…"));
  } else {
    append(actions, loadingLine("Checking this wallet…"));
    read("shop", "get_campaign_claimed", { campaign_id: String(campaignId), account: address })
      .then((res) => showClaim(!!(res && res.value)), () => showClaim(false));
  }
  // Each wallet may claim each promo campaign once.
  function showClaim(claimedThis) {
    replace(actions);
    if (claimedThis) {
      append(actions, notice("info", h("p", {}, ["This wallet has already claimed this promo. Each wallet can claim each promo once."])), h("a", { class: "btn btn-secondary", href: "#/stories" }, ["Find a story to write in"]));
      return;
    }
    const button = h("button", { type: "button", class: "btn btn-primary" }, ["Claim free Ink"]);
    append(actions, button, h("a", { class: "btn btn-secondary", href: "#/stories" }, ["Read first"]));
    append(card, walletNote());
    button.addEventListener("click", async () => {
      status.replaceChildren();
      button.disabled = true;
      try {
        const plan = assessPromo({
          campaignId,
          hasLinkKey: !!linkSecret,
          alreadyClaimed: false, // checked just above for this campaign
          paused: !!cfg.paused,
          promoEnabled: !!cfg.promo_enabled,
        });
        if (!plan.ok) {
          append(status, problemsNotice(plan.problems));
          return;
        }
        status.textContent = "Preparing a claim that only your wallet can use…";
        const signature = await signPromoClaim(linkSecret, contracts.shop, campaignId, address);
        const op = await encode("shop", "claim_promo", {
          account: address,
          campaign_id: String(campaignId).trim(),
          signer: "",
          // koilib takes bytes fields as base64url text.
          signature: utils.encodeBase64url(signature),
        });
        const sent = await send([op], status);
        if (sent) {
          await refreshAccount();
          append(status, notice("ok", h("p", {}, ["Your Ink has arrived. ", h("a", { href: "#/stories" }, ["Find a story to write in"]), "."])));
        }
      } catch (error) {
        failure(status, error);
      } finally {
        button.disabled = false;
      }
    });
  }
  append(card, trustNote("This link works only for the wallet that uses it. Nothing secret is sent to a server, and a copy of your confirmation can't be reused by anyone else."));
}

export function renderJoin(page, storyId, inviteId) {
  setMeta("You're invited to write", "An invitation to write in a private SwarmTales story.");
  const linkSecret = takeLinkSecret();
  const main = h("div", { class: "landing" });
  append(page, main);
  const card = h("div", { class: "card card-lg" }, [loadingLine("Opening your invitation…")]);
  const facts = h("dl", { class: "facts" });
  append(main, card, facts);

  if (!linkSecret) {
    replace(card, 
      h("h1", { class: "title" }, ["This invite link is incomplete"]),
      notice("warn", h("p", {}, ["The link is missing its key, the part after the “?k=”. Open the full link exactly as it was shared, or ask for a new one."]))
    );
    return;
  }

  Promise.all([
    read("stories", "get_story", { story_id: String(storyId) }),
    read("stories", "get_invite", { story_id: String(storyId), invite_id: String(inviteId) }).catch(() => null),
    firstLine(Number(storyId)),
  ]).then(([story, invite, opening]) => {
    if (!story || !Number(story.status || 0)) {
      replace(card, h("h1", { class: "title" }, ["We couldn't find this story"]), h("p", { class: "body-2" }, ["The invite points to a story that doesn't exist on " + network.name + "."]));
      return;
    }
    const address = currentAddress();
    replace(card, 
      h("p", { class: "eyebrow" }, ["You're invited to write in"]),
      h("h1", { class: "title" }, [story.title || "Untitled"]),
      h("p", { class: "lede" }, [shortAddress(story.opener) + " invited you to this " + "private story. Only invited writers can add to it."]),
      opening ? h("blockquote", { class: "excerpt" }, ["“" + clip(opening, 220) + "”"]) : null,
      landingSteps("Join with one confirmation", "Your wallet asks you to approve. Joining is free.")
    );
    if (invite) {
      const left = Math.max(0, Number(invite.max_uses || 0) - Number(invite.uses || 0));
      append(facts, 
        h("div", {}, [h("dt", {}, ["Invites left"]), h("dd", {}, [num(left) + " of " + num(invite.max_uses)])]),
        h("div", {}, [h("dt", {}, ["Link expires"]), h("dd", {}, [formatUtc(invite.expires_at) || "Never"])]),
        h("div", {}, [h("dt", {}, ["Writing needs"]), h("dd", {}, ["An active Writer month (the opener may pay for it). Your parts are paid from the opener's writers' pool (" + num(story.fund || 0) + " Ink left) while it lasts."])])
      );
      if (invite.revoked) append(card, notice("warn", h("p", {}, ["The opener has switched this invite off. Ask them for a new link."])));
    }
    const status = statusBox();
    const actions = h("div", { class: "actions" });
    append(card, actions, status);
    if (!address) {
      append(actions, connectButton(), h("a", { class: "btn btn-secondary", href: "#/stories/" + storyId }, ["Read it first"]));
    } else if (state.account && state.account.blocked) {
      // join_with_invite refuses a blocked wallet (F-09): don't offer a signature that fails.
      append(actions, notice("warn", h("p", {}, [BLOCKED_PROBLEM + " It can't join stories."])),
        h("a", { class: "btn btn-secondary", href: "#/stories/" + storyId }, ["Read it"]));
    } else {
      const button = h("button", { type: "button", class: "btn btn-primary" }, ["Join this story"]);
      append(actions, button, h("a", { class: "btn btn-secondary", href: "#/stories/" + storyId }, ["Read it first"]));
      append(card, walletNote());
      button.addEventListener("click", async () => {
        status.replaceChildren();
        button.disabled = true;
        try {
          status.textContent = "Preparing a request that only your wallet can use…";
          const signature = await signInviteJoin(linkSecret, contracts.stories, storyId, inviteId, address);
          const op = await encode("stories", "join_with_invite", {
            account: address,
            story_id: String(storyId),
            invite_id: String(inviteId),
            signature: utils.encodeBase64url(signature),
          });
          const sent = await send([op], status);
          if (sent) {
            await refreshAccount();
            append(status, notice("ok", h("p", {}, ["You've joined. Taking you to the story… ", h("a", { href: "#/stories/" + storyId + "?joined=1" }, ["Go now"])])));
            setTimeout(() => { location.hash = "#/stories/" + storyId + "?joined=1"; }, 1500);
          }
        } catch (error) {
          failure(status, error);
        } finally {
          button.disabled = false;
        }
      });
    }
    append(card, trustNote("This link works only for the wallet that uses it. Nothing secret is sent to a server, and a copy of your confirmation can't be reused by anyone else."));
  }).catch((error) => {
    replace(card, notice("bad", h("p", {}, [explainFailure(error)])));
  });
}
