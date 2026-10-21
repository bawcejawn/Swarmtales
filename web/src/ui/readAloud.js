import { h } from "./dom.js";

/**
 * "Listen": reads a story aloud with the browser's own speech voices
 * (the Web Speech API). Free, no server, nothing leaves the device.
 * Text is spoken in short sentence-sized pieces, because some browsers stop
 * a long utterance after about 15 seconds. The part being read is
 * highlighted and kept in view.
 */

const SPEEDS = [["0.8", "Slower"], ["1", "Normal"], ["1.2", "Faster"], ["1.5", "Fastest"]];

function pieces(text) {
  const out = [];
  const sentences = String(text).replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*["”’)\]]*\s*/g) || [String(text)];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > 220 && current) {
      out.push(current.trim());
      current = "";
    }
    current += s;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function pref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function savePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice still works for this visit */
  }
}

/**
 * How natural a browser voice usually sounds. The free "Natural" / "Neural"
 * voices (Microsoft Edge), Google's online voices (Chrome), and Apple's
 * Enhanced / Premium voices are far less robotic than the basic ones.
 */
export function voiceScore(v) {
  const name = String(v.name || "");
  let score = 0;
  if (/natural|neural|wavenet|journey|studio|premium|enhanced/i.test(name)) score += 100;
  if (/siri/i.test(name)) score += 80;
  if (/google/i.test(name)) score += 60;
  if (/online/i.test(name)) score += 20;
  if (/compact|espeak|robot|novelty|whisper|zarvox|trinoids|bells|bubbles|bad news|good news|cellos|organ|jester|superstar|wobble|albert|bahh|boing|deranged|hysterical|pipe organ/i.test(name)) score -= 200;
  if (v.default) score += 5;
  return score;
}

/** items: [{ seq, text, announce }] in reading order. Returns the player bar (or null if unsupported). */
export function createReader(article, items) {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined" || !items.length) return null;

  let queue = [];
  let playing = false;
  let paused = false;
  let currentSeq = null;

  const play = h("button", { type: "button", class: "btn btn-secondary btn-small listen-play", "aria-pressed": "false" }, ["▶ Listen"]);
  const stop = h("button", { type: "button", class: "btn btn-secondary btn-small", hidden: true }, ["■ Stop"]);
  const speed = h("select", { "aria-label": "Reading speed" }, SPEEDS.map(([v, l]) => h("option", { value: v }, [l])));
  speed.value = pref("st-read-speed", "1");
  const voice = h("select", { "aria-label": "Voice", hidden: true });
  const status = h("span", { class: "meta small", "aria-live": "polite" });
  // Shown only when this browser has no natural-sounding voice.
  const tip = h("p", { class: "meta small listen-tip", hidden: true }, [
    "Voices sound robotic in this browser. For free natural voices, open SwarmTales in Microsoft Edge, or in Chrome while online. " +
      "On iPhone or Mac: Settings \u2192 Accessibility \u2192 Spoken Content \u2192 Voices, and download an \u201cEnhanced\u201d voice.",
  ]);

  const fillVoices = () => {
    const voices = synth.getVoices();
    voice.hidden = !voices.length;
    if (!voices.length) return;
    const lang = (document.documentElement.lang || "en").slice(0, 2);
    const list = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang));
    // Best-sounding voices first; the first one is the default.
    const use = (list.length ? list : voices).slice().sort((a, b) => voiceScore(b) - voiceScore(a));
    voice.replaceChildren(...use.map((v) => h("option", { value: v.name }, [
      v.name.replace(/^Microsoft\s+|\s+Online\s*\(Natural\)|\s*-\s*English.*$/gi, "").trim() +
        (voiceScore(v) >= 60 ? " \u2605" : "") + (v.lang ? " (" + v.lang + ")" : ""),
    ])));
    const saved = pref("st-read-voice", "");
    if (saved && use.some((v) => v.name === saved)) voice.value = saved;
    else if (use.length) voice.value = use[0].name;
    tip.hidden = use.some((v) => voiceScore(v) >= 60);
  };
  fillVoices();
  if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", fillVoices);

  const highlight = (seq) => {
    article.querySelectorAll(".seg.reading").forEach((el) => el.classList.remove("reading"));
    currentSeq = seq;
    if (seq == null) return;
    const el = article.querySelector('.seg[data-seq="' + seq + '"]');
    if (el) {
      const fold = el.closest("details");
      if (fold && !fold.open) fold.open = true;
      el.classList.add("reading");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const reset = () => {
    playing = false;
    paused = false;
    queue = [];
    synth.cancel();
    highlight(null);
    play.textContent = "▶ Listen";
    play.setAttribute("aria-pressed", "false");
    stop.hidden = true;
    status.textContent = "";
  };

  const speakNext = () => {
    if (!playing) return;
    const next = queue.shift();
    if (!next) {
      reset();
      status.textContent = "Finished.";
      return;
    }
    if (next.seq !== currentSeq) highlight(next.seq);
    const u = new SpeechSynthesisUtterance(next.text);
    const chosen = synth.getVoices().find((v) => v.name === voice.value);
    if (chosen) {
      u.voice = chosen;
      u.lang = chosen.lang;
    }
    u.rate = Number(speed.value) || 1;
    // A short pause after a chapter announcement.
    u.onend = next.announce ? () => setTimeout(speakNext, 600) : speakNext;
    u.onerror = (e) => {
      if (e && (e.error === "interrupted" || e.error === "canceled")) return;
      status.textContent = "Your browser stopped reading. Press Listen to try again.";
      reset();
    };
    synth.speak(u);
  };

  const start = (fromSeq) => {
    synth.cancel();
    const begin = fromSeq == null ? 0 : Math.max(0, items.findIndex((it) => it.seq === fromSeq));
    queue = [];
    items.slice(begin).forEach((item, i) => {
      // "Chapter 2." before a chapter's first part (also when starting there).
      if (item.announce && (i > 0 || fromSeq == null || item.seq === fromSeq)) queue.push({ seq: item.seq, text: item.announce, announce: true });
      for (const text of pieces(item.text)) queue.push({ seq: item.seq, text });
    });
    playing = true;
    paused = false;
    play.textContent = "❚❚ Pause";
    play.setAttribute("aria-pressed", "true");
    stop.hidden = false;
    status.textContent = "Reading aloud…";
    speakNext();
  };

  play.addEventListener("click", () => {
    if (!playing) return start(null);
    if (paused) {
      synth.resume();
      paused = false;
      play.textContent = "❚❚ Pause";
      status.textContent = "Reading aloud…";
    } else {
      synth.pause();
      paused = true;
      play.textContent = "▶ Resume";
      status.textContent = "Paused.";
    }
  });
  stop.addEventListener("click", reset);
  speed.addEventListener("change", () => {
    savePref("st-read-speed", speed.value);
    if (playing && !paused) start(currentSeq);
  });
  voice.addEventListener("change", () => {
    savePref("st-read-voice", voice.value);
    if (playing && !paused) start(currentSeq);
  });
  // Stop when the reader leaves the page.
  window.addEventListener("hashchange", reset, { once: true });

  const bar = h("div", { class: "listen-bar", role: "group", "aria-label": "Read aloud" }, [
    play,
    stop,
    h("label", { class: "listen-opt" }, [h("span", { class: "visually-hidden" }, ["Speed"]), speed]),
    h("label", { class: "listen-opt" }, [h("span", { class: "visually-hidden" }, ["Voice"]), voice]),
    status,
    tip,
  ]);
  bar.startFrom = start;
  return bar;
}
