// Storage keys and hashing. Pure functions, no storage.
import { System, Crypto } from "@koinos/sdk-as";

export function u64Key(value: u64): Uint8Array {
  const key = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    key[i] = <u8>(v & 0xff);
    v = v >> 8;
  }
  return key;
}

export function u32Key(value: u32): Uint8Array {
  const key = new Uint8Array(4);
  key[0] = <u8>(value >> 24);
  key[1] = <u8>(value >> 16);
  key[2] = <u8>(value >> 8);
  key[3] = <u8>value;
  return key;
}

export function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const key = new Uint8Array(a.length + b.length);
  memory.copy(key.dataStart, a.dataStart, a.length);
  memory.copy(key.dataStart + a.length, b.dataStart, b.length);
  return key;
}

export function pairKey(a: u64, b: u64): Uint8Array {
  return join(u64Key(a), u64Key(b));
}

export function versionKey(storyId: u64, seq: u64, version: u32): Uint8Array {
  return join(pairKey(storyId, seq), u32Key(version));
}

export function idAddrKey(storyId: u64, account: Uint8Array): Uint8Array {
  return join(u64Key(storyId), account);
}

export function addrIdxKey(account: Uint8Array, index: u64): Uint8Array {
  return join(account, u64Key(index));
}

export function u32IdxKey(categoryId: u32, index: u64): Uint8Array {
  return join(u32Key(categoryId), u64Key(index));
}

export function u32IdKey(categoryId: u32, storyId: u64): Uint8Array {
  return join(u32Key(categoryId), u64Key(storyId));
}

export function reportKey(storyId: u64, seq: u64, account: Uint8Array): Uint8Array {
  return join(pairKey(storyId, seq), account);
}

// System.hash returns a multihash (code, length, digest). Keep the raw
// 32-byte sha256.
export function sha256(data: Uint8Array): Uint8Array {
  const wrapped = System.hash(Crypto.multicodec.sha2_256, data);
  System.require(wrapped != null, "STORIES: could not hash");
  const bytes = wrapped!;
  let i = 0;
  while (i < bytes.length) {
    const bite = bytes[i];
    i++;
    if ((bite & 0x80) == 0) break;
  }
  let size: u64 = 0;
  let shift: u8 = 0;
  while (i < bytes.length) {
    const bite = bytes[i];
    i++;
    size = size | ((<u64>(bite & 0x7f)) << shift);
    if ((bite & 0x80) == 0) break;
    shift = <u8>(shift + 7);
  }
  System.require(size == 32 && i + 32 <= bytes.length, "STORIES: unexpected hash");
  return bytes.slice(i, i + 32);
}

export function foldHash(prev: Uint8Array | null, seq: u64, mode: u8, textHash: Uint8Array): Uint8Array {
  const p = prev != null ? prev! : new Uint8Array(0);
  const buf = new Uint8Array(p.length + 8 + 1 + textHash.length);
  memory.copy(buf.dataStart, p.dataStart, p.length);
  const seqBytes = u64Key(seq);
  memory.copy(buf.dataStart + p.length, seqBytes.dataStart, 8);
  buf[p.length + 8] = mode;
  memory.copy(buf.dataStart + p.length + 9, textHash.dataStart, textHash.length);
  return sha256(buf);
}
