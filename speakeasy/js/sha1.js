// SHA-1 hex digest of a string, used for TTS audio cache keys (not security).
//
// crypto.subtle only exists in secure contexts (HTTPS or localhost), so on a
// plain-HTTP page — e.g. the dev server opened from a phone via a LAN IP — it
// is undefined. Fall back to a small pure-JS SHA-1 that yields the same hex,
// so cache keys and stale-audio checks match across devices.
export async function sha1Hex(text) {
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-1", bytes);
    return toHex(new Uint8Array(buf));
  }
  return toHex(sha1Bytes(bytes));
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// FIPS 180-4 SHA-1 over a byte array.
function sha1Bytes(bytes) {
  const bitLen = bytes.length * 8;
  // Message + 0x80 + zero padding + 64-bit length, to a multiple of 64 bytes.
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(total - 4, bitLen >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h));
  return out;
}
