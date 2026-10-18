/** Tiny synthesized SFX — no asset files needed. */
let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.15, slideTo?: number): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

export const sfx = {
  tick: () => tone(660, 0.18, 'sine', 0.18),
  go: () => tone(990, 0.4, 'sine', 0.2),
  coin: () => {
    tone(988, 0.08, 'square', 0.05);
    setTimeout(() => tone(1319, 0.16, 'square', 0.05), 60);
  },
  gel: () => {
    [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.12), i * 55));
  },
  turbo: () => tone(300, 0.45, 'sawtooth', 0.06, 1200),
  bump: () => tone(140, 0.2, 'triangle', 0.2, 70),
  finish: () => {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sine', 0.16), i * 110));
  },
  over: () => {
    [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.16), i * 160));
  },
};
