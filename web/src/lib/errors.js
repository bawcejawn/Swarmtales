const FRIENDLY = {
  "STORIES: a hidden part can't be edited while it is checked; you can remove it instead":
    "This part is hidden while it's checked, so it can't be edited now. You can still remove it.",
  "STORIES: edit your own part with edit_segment; revise_part is for someone else's part":
    "This is your own part: use “Edit” on it instead (rewording is free).",
  "STORIES: the text is unchanged":
    "Nothing has changed yet.",
  "STORIES: this part has too many versions to change it again":
    "This part has been changed so many times that it can't be changed again.",
  "STORIES: only the opener, an editor or a current writer of this story may update its summary":
    "Only the opener, an editor or someone who still writes in this story can update its summary.",
  "STORIES: the summary can't change once the story is finalized or archived":
    "The summary can't change once the story is finished or archived.",
  "STORIES: confirm that you wrote this text or have the right to use it":
    "Tick “I wrote this myself, or I have the right to use it” before you add a part.",
  "STORIES: the Terms of Use have changed; reload the page and accept the current version":
    "The Terms of Use were updated. Reload the page, read what changed, and confirm again.",
  "STORIES: this exact text is already in this story":
    "That exact text is already in this story. Each part has to be new.",
  "STORIES: this wallet can no longer write on SwarmTales (repeated takedowns)":
    "This wallet can no longer write on SwarmTales, after repeated takedowns of copied text.",
  "STORIES: you cannot report your own part":
    "You can't report your own part.",
  "STORIES: you already reported this part":
    "You've already reported this part. Thank you.",
  "STORIES: this part is already hidden while it is checked":
    "This part is already hidden while it's checked.",
  "STORIES: some parts are hidden while they are checked; unhide or remove them first":
    "Some parts are hidden while they're checked. The story can be finished once they're cleared or removed.",
  "STORIES: a hidden part can only be removed in the final edit (or unhidden first)":
    "A hidden part can only be removed in the final edit, unless it's cleared first.",
  "STORIES: an active Writer membership is required":
    "You need an active Writer month to write in someone else's story, unless you have claimed a promo and still have trial characters left. The person who opened the story can write without a Writer month.",
  "STORIES: text is over the per-submission cap":
    "That text is longer than the per-submission cap.",
  "STORIES: not enough space left in this story":
    "This story does not have room for that much text.",
  "STORIES: story is not open for writing":
    "This story is not open for new text.",
  "STORIES: this story is private":
    "This story is private. Only the opener, an editor, or an invited wallet can write.",
  "STORIES: trial writing limit reached":
    "This wallet has used its trial writing allowance.",
  "STORIES: Ink cost does not match expected_ink":
    "The Ink count on this page did not match the contract. Nothing was charged. Reload and try again.",
  "STORIES: you already have the maximum number of open projects":
    "This wallet already has the maximum number of open projects.",
  "STORIES: open fee payment failed":
    "The Shop refused the open fee. Check that you approved the Shop for the price and that you hold enough of the payment token.",
  "SHOP: this wallet has already claimed this promo":
    "This wallet has already claimed this promo. Each wallet can claim each promo once.",
  "SHOP: promo code rejected":
    "That promo code was rejected.",
  "SHOP: promo is off":
    "Promo claims are turned off.",
  "SHOP: campaign has ended":
    "That promo campaign has ended.",
  "SHOP: campaign has not started":
    "That promo campaign has not started.",
  "SHOP: unknown campaign":
    "That campaign id does not exist.",
  "SHOP: promo budget exhausted":
    "That promo campaign has no Ink left.",
  "SHOP: promo daily cap reached":
    "That promo campaign has hit its daily cap.",
  "INK: insufficient balance":
    "The Ink balance is too low.",
  "INK: not enough Ink":
    "You don't have enough Ink for that. Get more from a promo link or a Writer month.",
  "STORIES: text is shorter than the minimum (only the piece that fills the story may be shorter)":
    "A part needs at least 20 characters. Only the very last piece that fills the story can be shorter.",
  "STORIES: opening text is shorter than the minimum":
    "The opening needs at least 20 characters.",
  "STORIES: invite link rejected":
    "This invite link didn't work for this wallet. Open the full link you were given, and join with your own wallet.",
  "STORIES: invite has expired":
    "This invite link has expired. Ask the story's opener for a new one.",
  "STORIES: invite has no uses left":
    "This invite link has been used up. Ask the story's opener for a new one.",
  "STORIES: invite was revoked":
    "The opener turned this invite link off.",
  "STORIES: already on the allow-list":
    "You're already invited to this story. You can write in it now.",
  "STORIES: call SwarmTales directly from your wallet, not through another contract":
    "SwarmTales only accepts requests sent straight from your own wallet.",
  "SHOP: promo link rejected":
    "This promo link didn't work for this wallet. Open the full link you were given, and claim with your own wallet.",
  "SHOP: promo link already used":
    "This one-time promo link has already been used.",
  "SHOP: stablecoin payment did not arrive":
    "The payment didn't arrive, so nothing was bought. Check your balance and try again.",
  "SHOP: call SwarmTales directly from your wallet, not through another contract":
    "SwarmTales only accepts requests sent straight from your own wallet.",
};

export function chainMessage(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const match = raw.match(/(?:STORIES|SHOP|INK): [^"\n\\]+/);
  return match ? match[0].trim() : "";
}

export function explainFailure(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/Could not reach|Failed to fetch|NetworkError|ECONN|ETIMEDOUT|Load failed/i.test(raw)) {
    return "The network did not answer. Check your internet and try again.";
  }
  if (/user rejected|rejected the request|rejected by user|request rejected|declined|closed the prompt|cancelled by user|canceled by user/i.test(raw)) {
    return "The wallet did not sign. Nothing was sent.";
  }
  const contract = chainMessage(error);
  if (contract && FRIENDLY[contract]) return FRIENDLY[contract] + " The contract said: " + contract;
  if (contract) return contract;
  if (!raw) return "Something went wrong.";
  return raw.length > 500 ? raw.slice(0, 500) + "…" : raw;
}
