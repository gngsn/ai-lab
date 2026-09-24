import { NextResponse } from 'next/server';
import sharp from 'sharp';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (Number(request.headers.get('content-length')) > 21 * 1024 * 1024)
    return NextResponse.json({ error: 'Choose a photo smaller than 20 MB.' }, { status: 413 });
  try {
    const data = await request.formData();
    const image = data.get('image');
    if (!(image instanceof File) || image.size > 20 * 1024 * 1024)
      return NextResponse.json({ error: 'Choose a photo smaller than 20 MB.' }, { status: 400 });
    const input = Buffer.from(await image.arrayBuffer());
    const output = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return new Response(new Uint8Array(output), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          'This photo format could not be decoded. On iPhone, export it as JPEG or choose Camera → Formats → Most Compatible, then take a new photo.',
      },
      { status: 422 },
    );
  }
}
