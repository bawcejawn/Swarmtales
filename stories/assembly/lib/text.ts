// Text and address rules. Pure functions, no storage.
import { System } from "@koinos/sdk-as";
import { ADDRESS_LENGTH, MAX_TITLE, MAX_NEWLINE_RUN, MAX_NOTE } from "./constants";

export function str(value: string | null): string {
  return value != null ? value! : "";
}

export function utf8(value: string | null): i32 {
  return value != null ? String.UTF8.byteLength(value!) : 0;
}

export function isLowSurrogate(c: i32): bool {
  return c >= 0xdc00 && c <= 0xdfff;
}

// ===================================================================
// Text rules
// ===================================================================
// Returns the Ink cost (UTF-16 code units) or stops with the reason.
export function requireText(text: string, allowNewline: bool): i32 {
  const n = text.length;
  System.require(n > 0, "STORIES: text is empty");
  let visible = false;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c == 0x0a) {
      System.require(allowNewline, "STORIES: line breaks are not allowed here");
      run++;
      System.require(run <= MAX_NEWLINE_RUN, "STORIES: too many line breaks in a row (max 3)");
      continue;
    }
    run = 0;
    System.require(c >= 0x20 && !(c >= 0x7f && c <= 0x9f), "STORIES: control characters are not allowed");
    if (c >= 0xd800 && c <= 0xdbff) {
      System.require(i + 1 < n, "STORIES: broken character in text");
      const d = text.charCodeAt(i + 1);
      System.require(d >= 0xdc00 && d <= 0xdfff, "STORIES: broken character in text");
      i++;
      visible = true;
      continue;
    }
    System.require(!(c >= 0xdc00 && c <= 0xdfff) && c != 0xfffd, "STORIES: broken character in text");
    System.require(
      !(c == 0x200b || c == 0xfeff || c == 0x2028 || c == 0x2029 ||
        (c >= 0x2060 && c <= 0x2064) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)),
      "STORIES: invisible or direction-control characters are not allowed"
    );
    if (!(c == 0x20 || c == 0xa0 || c == 0x3000 || (c >= 0x2000 && c <= 0x200a) ||
          c == 0x200c || c == 0x200d || c == 0xfe0e || c == 0xfe0f)) {
      visible = true;
    }
  }
  System.require(visible, "STORIES: text has no visible characters");
  return n;
}

export function requireTextIn(text: string, max: i32, message: string): void {
  System.require(text.length >= 1 && text.length <= max, message);
  requireText(text, false);
}

export function requireTitle(value: string | null): string {
  const title = str(value);
  requireTextIn(title, MAX_TITLE, "STORIES: title must be 1 to 100 characters");
  return title;
}

export function isPlainAscii(value: string): bool {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

export function isAddress(account: Uint8Array | null): bool {
  return account != null && account.length == ADDRESS_LENGTH;
}

export function requireAddress(account: Uint8Array | null, message: string): Uint8Array {
  System.require(account != null && account.length == ADDRESS_LENGTH, message);
  return account!;
}

export function requireCitation(value: string | null): string {
  const citation = str(value);
  System.require(citation.length <= MAX_NOTE, "STORIES: a citation must be at most 200 characters");
  if (citation.length > 0) requireText(citation, false);
  return citation;
}

export function requireNote(value: string | null): string {
  const note = str(value);
  System.require(note.length <= MAX_NOTE, "STORIES: note must be at most 200 characters");
  if (note.length > 0) requireText(note, false);
  return note;
}
