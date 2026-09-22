import { Medal, Profile } from './types';
import { loadImage } from './images';
import { distanceLabel, dateLabel } from './validation';
export type ShareOptions = {
  format: 'story' | 'square';
  template: 'finish' | 'collection' | 'year';
  showName: boolean;
  showTime: boolean;
  year: string;
};
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  weight = 700,
) {
  let size = fontSize;
  do {
    ctx.font = `${weight} ${size}px 'Manrope Variable', Arial, sans-serif`;
    size -= 2;
  } while (ctx.measureText(text).width > maxWidth && size > 16);
  ctx.fillText(text, x, y, maxWidth);
}
export async function renderShare(
  medals: Medal[],
  profile: Profile,
  options: ShareOptions,
): Promise<Blob> {
  await document.fonts.ready;
  await document.fonts.load('700 48px "Manrope Variable"');
  const list =
    options.template === 'year'
      ? medals.filter((m) => m.date.startsWith(options.year))
      : options.template === 'finish'
        ? medals.slice(0, 1)
        : medals;
  if (!list.length) throw new Error('There are no medals to include.');
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = options.format === 'story' ? 1920 : 1080;
  const ctx = canvas.getContext('2d')!;
  const height = canvas.height;
  const story = options.format === 'story';
  ctx.fillStyle = '#f6f3eb';
  ctx.fillRect(0, 0, 1080, height);
  ctx.strokeStyle = '#e8e3d8';
  ctx.lineWidth = 1;
  for (let x = -height; x < 1200; x += 85) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height, height);
    ctx.stroke();
  }
  ctx.fillStyle = '#c84c38';
  ctx.textAlign = 'center';
  ctx.font = '700 24px "DM Sans Variable"';
  ctx.fillText('E V E R Y  F I N I S H  H A S  A  S T O R Y', 540, story ? 230 : 100);
  ctx.fillStyle = '#292e28';
  fitText(
    ctx,
    options.template === 'year'
      ? `${options.year}. What a run.`
      : options.template === 'collection'
        ? 'Miles made memories.'
        : 'Earned. Never given.',
    540,
    story ? 325 : 177,
    930,
    64,
  );
  const imageTop = story ? 400 : 220;
  const imageHeight = story ? 900 : 530;
  const shown = list.slice(0, 9);
  const columns = shown.length === 1 ? 1 : shown.length <= 4 ? 2 : 3;
  const rows = Math.ceil(shown.length / columns);
  const cellW = 880 / columns;
  const cellH = imageHeight / rows;
  const images = await Promise.all(shown.map((m) => loadImage(m.image)));
  images.forEach((image, i) => {
    const x = 100 + (i % columns) * cellW;
    const y = imageTop + Math.floor(i / columns) * cellH;
    const inset = shown.length === 1 ? 25 : 20;
    const ratio = Math.min(
      (cellW - inset * 2) / image.width,
      (cellH - (shown.length > 1 ? 55 : 0)) / image.height,
    );
    const w = image.width * ratio;
    const h = image.height * ratio;
    ctx.drawImage(
      image,
      x + (cellW - w) / 2,
      y + (cellH - h - (shown.length > 1 ? 40 : 0)) / 2,
      w,
      h,
    );
    if (shown.length > 1) {
      ctx.fillStyle = '#333a32';
      fitText(ctx, shown[i].raceName, x + cellW / 2, y + cellH - 12, cellW - 24, 22);
    }
  });
  const textY = story ? 1400 : 820;
  ctx.fillStyle = '#2d332d';
  if (options.template === 'finish') {
    fitText(ctx, list[0].raceName, 540, textY, 930, 45);
    ctx.fillStyle = '#73776e';
    ctx.font = '25px "DM Sans Variable"';
    ctx.fillText(
      `${dateLabel(list[0].date)}  ·  ${distanceLabel(list[0].distance)}`,
      540,
      textY + 48,
    );
    if (options.showTime && list[0].duration) {
      ctx.fillStyle = '#c84c38';
      ctx.font = '700 39px "DM Sans Variable"';
      ctx.fillText(list[0].duration, 540, textY + 112);
    }
  } else {
    const km = list.reduce((sum, medal) => sum + medal.distance, 0);
    fitText(
      ctx,
      `${list.length} medals  ·  ${km.toFixed(1)} km  ·  Countless memories`,
      540,
      textY,
      940,
      31,
    );
    if (list.length > shown.length) {
      ctx.fillStyle = '#73776e';
      ctx.font = '24px "DM Sans Variable"';
      ctx.fillText(`Featuring ${shown.length} of ${list.length} finishes`, 540, textY + 44);
    }
  }
  if (options.showName) {
    ctx.fillStyle = '#73776e';
    fitText(ctx, profile.name, 540, story ? 1655 : 998, 900, 27, 400);
  }
  ctx.fillStyle = '#c84c38';
  ctx.font = '700 25px "DM Sans Variable"';
  ctx.fillText('medalshelf.', 540, story ? 1740 : 1045);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not create your image.'))),
      'image/png',
    ),
  );
}
