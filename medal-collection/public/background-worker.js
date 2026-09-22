/* Background cleanup for a contrasting, plain backdrop. No image leaves the device. */
self.onmessage = ({ data }) => {
  const { pixels, width, height } = data;
  const count = width * height;
  const bytes = new Uint8ClampedArray(pixels);
  const samples = [];
  const margin = Math.max(1, Math.round(Math.min(width, height) * 0.015));
  for (let i = 0; i < 24; i++) {
    const x = Math.min(width - 1, Math.floor((i * width) / 24));
    const y = Math.min(height - 1, Math.floor((i * height) / 24));
    for (const index of [
      margin * width + x,
      (height - margin - 1) * width + x,
      y * width + margin,
      y * width + width - margin - 1,
    ]) {
      if (bytes[index * 4 + 3] > 240)
        samples.push([bytes[index * 4], bytes[index * 4 + 1], bytes[index * 4 + 2]]);
    }
  }
  if (samples.length < 8) {
    self.postMessage({
      error:
        'This photo already has transparent edges. Keep the original or use a photo with a plain background.',
    });
    return;
  }
  const difference = (a, b) =>
    Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  let cluster = [];
  for (const sample of samples) {
    const nearby = samples.filter((other) => difference(sample, other) < 45);
    if (nearby.length > cluster.length) cluster = nearby;
  }
  if (cluster.length < samples.length * 0.55) {
    self.postMessage({
      error:
        'This background has too much detail for quick cleanup. Try a plain, contrasting surface, use AI cleanup with your account, or keep the original.',
    });
    return;
  }
  const background = [0, 1, 2].map(
    (channel) => cluster.reduce((sum, pixel) => sum + pixel[channel], 0) / cluster.length,
  );
  const threshold = 58;
  const seen = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let tail = 0;
  let head = 0;
  let removed = 0;
  const enqueue = (index) => {
    if (seen[index]) return;
    seen[index] = 1;
    const offset = index * 4;
    const delta = Math.sqrt(
      (bytes[offset] - background[0]) ** 2 +
        (bytes[offset + 1] - background[1]) ** 2 +
        (bytes[offset + 2] - background[2]) ** 2,
    );
    if (bytes[offset + 3] < 20 || delta < threshold) {
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    bytes[index * 4 + 3] = 0;
    removed++;
    if (index % width) enqueue(index - 1);
    if (index % width < width - 1) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index < count - width) enqueue(index + width);
  }
  if (removed > count * 0.96 || removed < count * 0.01) {
    self.postMessage({
      error:
        'The medal and background are too similar. Try a contrasting background or keep the original photo.',
    });
    return;
  }
  self.postMessage({ pixels: bytes.buffer }, [bytes.buffer]);
};
