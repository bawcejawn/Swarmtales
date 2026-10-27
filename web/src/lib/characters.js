/**
 * A free, automatic character list: names that appear in the story text.
 * Heuristic (no AI): capitalized words or pairs ("Captain Reyes") that are
 * not at the start of a sentence, are not common words, and appear at least
 * twice. Returns [{ name, count, firstChapter }], most mentioned first.
 */

const COMMON = new Set((
  "I I'm I'd I'll I've A An The And But Or Nor So Yet For If Then When While Where Why How What Who Whom Whose Which " +
  "This That These Those It It's Its He She They We You Me Him Her Them Us My Your Our Their His Hers Theirs Ours Yours " +
  "Mr Mrs Ms Dr Sir Madam Lady Lord Miss Oh Ah Yes No Not Maybe Perhaps Still Just Even Only Now Later Soon Never Always " +
  "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September " +
  "October November December Chapter Part God Christmas Easter English French Spanish German American British " +
  "Somewhere Someone Something Nothing Everyone Everything Anyone Anything Nobody Somebody Everybody Here There " +
  "Okay OK Hello Hi Hey Well Please Thanks Thank Sorry Good Bad After Before Again Once Twice Inside Outside Above Below " +
  "Across Along Around Behind Beside Between Beyond During Into Through Toward Towards Under Until Upon With Within Without " +
  "One Two Three Four Five Six Seven Eight Nine Ten Every Each Some All Both Most Many Much More Less Few Other Another " +
  "Let Don't Didn't Can't Won't Wasn't Isn't Aren't Couldn't Wouldn't Shouldn't Do Does Did Is Are Was Were Be Been Being " +
  "Have Has Had Go Went Come Came See Saw Look Looked Said Says Tell Told Ask Asked Mother Father Mom Dad Grandma Grandpa " +
  "Sentence Line Part Testnet SwarmTales Ink " +
  // Words that often start a sentence but are never names.
  "On In At Of To From By As Off Out Up Down Over Near Far Since Though Although Because Unless Whether Whatever " +
  "Whenever Wherever However Meanwhile Instead Also Too Very Really Than Last Next First Second Third Finally Today " +
  "Tomorrow Yesterday Tonight Morning Evening Night Day Suddenly Slowly Quickly Soon Afterwards Together Alone Like " +
  "Such Same Whole Half Hours Minutes Years Days Weeks Months Moments Seconds Nobody Everywhere Anywhere Nowhere Why"
).split(" ").map((w) => w.toLowerCase()));

const TITLES = new Set(["mr", "mrs", "ms", "dr", "captain", "sir", "lady", "lord", "miss", "professor", "doctor", "king", "queen", "prince", "princess", "uncle", "aunt", "father", "mother", "sister", "brother", "detective", "officer", "general", "colonel", "sergeant"]);

function isCap(word) {
  return /^[A-Z][a-z'’]+[a-z]$|^[A-Z][a-z]$/.test(word);
}

/** chapters: [{ number, text }] */
export function findCharacters(chapters, limit = 12) {
  const counts = new Map();
  const first = new Map();
  const add = (name, chapter) => {
    counts.set(name, (counts.get(name) || 0) + 1);
    if (!first.has(name)) first.set(name, chapter);
  };
  for (const { number, text } of chapters) {
    const sentences = String(text || "").split(/(?<=[.!?…]["”’)]?)\s+|\n+/);
    for (const sentence of sentences) {
      const words = sentence.split(/\s+/).map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, "").replace(/['’]s$/, ""));
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!w || !isCap(w) || COMMON.has(w.toLowerCase())) continue;
        const next = i + 1 < words.length ? words[i + 1] : "";
        if (TITLES.has(w.toLowerCase()) && next && isCap(next)) continue; // the title is counted with the name
        const prev = i > 0 ? words[i - 1] : "";
        // "Captain Reyes", "Dr Malik": keep the title with the name.
        if (prev && TITLES.has(prev.toLowerCase()) && isCap(prev)) {
          add(prev + " " + w, number);
          continue;
        }
        // Sentence starts are capitalized anyway: count them only if the
        // word is also seen mid-sentence somewhere (checked below).
        add(i === 0 ? "\u0000" + w : w, number);
      }
    }
  }
  const out = [];
  for (const [key, count] of counts) {
    if (key.startsWith("\u0000")) {
      // Only ever seen starting a sentence: a name if it's repeated and doesn't
      // look like an ordinary word ("Suddenly", "Walking", "Tired").
      const word = key.slice(1);
      if (!counts.has(word) && count >= 2 && !/(ly|ing|ed)$/.test(word)) out.push({ name: word, count, firstChapter: first.get(key) });
      continue;
    }
    const startCount = counts.get("\u0000" + key) || 0;
    const total = count + startCount;
    if (total >= 2) out.push({ name: key, count: total, firstChapter: Math.min(first.get(key), first.get("\u0000" + key) || Infinity) });
  }
  // A single name that is part of a titled name ("Reyes" in "Captain Reyes") folds into it.
  const titled = out.filter((c) => c.name.includes(" "));
  const result = out.filter((c) => !titled.some((t) => t.name.endsWith(" " + c.name) && t.count >= c.count / 2));
  return result.sort((a, b) => b.count - a.count || a.firstChapter - b.firstChapter).slice(0, limit);
}

/** A plain first draft of "the story so far": each chapter's opening sentence. */
export function openingLines(chapters, maxChars = 1400) {
  const lines = [];
  for (const { number, text } of chapters) {
    const firstSentence = String(text || "").trim().split(/(?<=[.!?…])\s+/)[0] || "";
    if (firstSentence) lines.push("Chapter " + number + ": " + firstSentence);
  }
  let out = lines.join(" ");
  if (out.length > maxChars) out = out.slice(0, maxChars - 1).replace(/\s+\S*$/, "") + "…";
  return out;
}
