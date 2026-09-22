export async function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
export async function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('This image could not be opened. Try a JPEG or PNG photo.'));
    image.src = source;
  });
}
export async function normalizePhoto(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
  if (
    !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name) &&
    !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type)
  )
    throw new Error('Choose a JPEG, PNG, WebP, or HEIC photo.');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    const data = new FormData();
    data.set('image', file);
    const response = await fetch('/api/images/normalize', { method: 'POST', body: data });
    if (!response.ok)
      throw new Error((await response.json()).error ?? 'Convert this photo to JPEG and try again.');
    return blobDataUrl(await response.blob());
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function transformPhoto(
  source: string,
  rotation: number,
  zoom: number,
): Promise<string> {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  const swap = rotation % 180 !== 0;
  canvas.width = swap ? image.height : image.width;
  canvas.height = swap ? image.width : image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(zoom, zoom);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  return canvas.toDataURL('image/png');
}
export async function removePhotoBackground(
  source: string,
  onProgress: (message: string) => void,
): Promise<string> {
  onProgress('Cleaning up the background on your device…');
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    const worker = new Worker('/background-worker.js');
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Cleanup took too long. Try a smaller photo or keep the original.'));
    }, 20000);
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      worker.terminate();
      if (data.error) {
        reject(new Error(data.error));
        return;
      }
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(data.pixels), canvas.width, canvas.height),
        0,
        0,
      );
      resolve(canvas.toDataURL('image/png'));
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(
        new Error('Cleanup could not run on this device. Keep the original photo or try again.'),
      );
    };
    worker.postMessage(
      { pixels: imageData.data.buffer, width: canvas.width, height: canvas.height },
      [imageData.data.buffer],
    );
  });
}
export async function removePhotoBackgroundAI(source: string, token: string): Promise<string> {
  const file = await (await fetch(source)).blob();
  const form = new FormData();
  form.set('image', file, 'medal.png');
  const response = await fetch('/api/images/remove-background', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok)
    throw new Error(
      (await response.json()).error ||
        'AI cleanup is unavailable. Use quick cleanup or keep the original.',
    );
  return blobDataUrl(await response.blob());
}
