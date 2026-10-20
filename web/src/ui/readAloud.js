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

/** items: [{ seq, text }] in reading order. Returns the player bar (or null if unsupported). */
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

  const fillVoices = () => {
    const voices = synth.getVoices();
    voice.hidden = !voices.length;
    if (!voices.length) return;
    const lang = (document.documentElement.lang || "en").slice(0, 2);
    const list = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang));
    const use = list.length ? list : voices;
    voice.replaceChildren(...use.map((v) => h("option", { value: v.name }, [v.name + (v.localService ? "" : " (online)")])));
    const saved = pref("st-read-voice", "");
    if (saved && use.some((v) => v.name === saved)) voice.value = saved;
  };
  fillVoices();
  if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", fillVoices);

  const highlight = (seq) => {
    article.querySelectorAll(".seg.reading").forEach((el) => el.classList.remove("reading"));
    currentSeq = seq;
    if (seq == null) return;
    const el = article.querySelector('.seg[data-seq="' + seq + '"]');
    if (el) {
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
    u.onend = speakNext;
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
    for (const item of items.slice(begin)) for (const text of pieces(item.text)) queue.push({ seq: item.seq, text });
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
  ]);
  bar.startFrom = start;
  return bar;
}
