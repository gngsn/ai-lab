// WAV helpers of the pronunciation page.

function wavHeader(view: DataView, samples: number, sampleRate: number) {
  const w = (o: number, x: number) => view.setUint32(o, x, true);
  const ws = (o: number, x: number) => view.setUint16(o, x, true);
  w(0, 0x46464952);
  w(4, 36 + samples * 2);
  w(8, 0x45564157);
  w(12, 0x20746d66);
  w(16, 16);
  ws(20, 1);
  ws(22, 1);
  w(24, sampleRate);
  w(28, sampleRate * 2);
  ws(32, 2);
  ws(34, 16);
  w(36, 0x61746164);
  w(40, samples * 2);
}

export function silenceWav(sec: number, sr = 22050): Blob {
  const n = Math.floor(sec * sr);
  const buf = new ArrayBuffer(44 + n * 2);
  wavHeader(new DataView(buf), n, sr);
  return new Blob([buf], { type: "audio/wav" });
}

/** Decode every blob and join their first channel into one 16-bit mono WAV. */
export async function mergeBlobs(blobs: Blob[]): Promise<Blob> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("AudioContext not supported");
  const ctx = new AC();
  const decoded = await Promise.all(
    blobs.map(async (b) => ctx.decodeAudioData(await b.arrayBuffer())),
  );
  ctx.close();
  const sr = decoded[0].sampleRate;
  const total = decoded.reduce((s, b) => s + b.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const b of decoded) {
    out.set(b.getChannelData(0), off);
    off += b.length;
  }
  const ab = new ArrayBuffer(44 + out.length * 2);
  const view = new DataView(ab);
  wavHeader(view, out.length, sr);
  for (let i = 0; i < out.length; i++) {
    const s = Math.max(-1, Math.min(1, out[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([ab], { type: "audio/wav" });
}
