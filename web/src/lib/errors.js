const FRIENDLY = {
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
  "SHOP: this wallet has already claimed a promo":
    "This wallet has already claimed a promo. One claim per wallet, ever.",
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
