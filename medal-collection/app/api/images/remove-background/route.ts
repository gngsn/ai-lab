import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const maxDuration = 60;
const failure = (error: string, status: number) => NextResponse.json({ error }, { status });
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!url || !anon || !service || !cloudName || !apiKey || !apiSecret)
    return failure(
      'AI cleanup is not enabled yet. Use quick background cleanup or keep your original photo.',
      503,
    );
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return failure('Sign in to use AI cleanup.', 401);
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(authorization.slice(7));
  if (authError || !user) return failure('Please sign in again.', 401);
  if (Number(request.headers.get('content-length')) > 10 * 1024 * 1024)
    return failure('This photo is too large. Choose a smaller photo.', 413);
  let normalized: Buffer;
  try {
    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File) || image.size > 10 * 1024 * 1024)
      return failure('Choose a photo smaller than 10 MB.', 400);
    normalized = await sharp(Buffer.from(await image.arrayBuffer()), {
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return failure('This photo could not be decoded. Try a JPEG or PNG image.', 422);
  }
  const { data: job, error: claimError } = await userClient.rpc('claim_image_job', {
    photo_hash: createHash('sha256').update(normalized).digest('hex'),
  });
  if (claimError)
    return failure(
      'AI cleanup limit reached or processing is unavailable. Try quick cleanup, or come back later.',
      429,
    );
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!job.claimed) {
    if (job.status === 'complete' && job.result_path) {
      const { data, error } = await admin.storage.from('medals').download(job.result_path);
      if (!error && data)
        return new Response(data, {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
        });
      await admin
        .from('image_jobs')
        .update({ status: 'failed' })
        .eq('id', job.id)
        .eq('owner_id', user.id);
      return failure('The previous preview expired. Please retry.', 409);
    }
    return failure('This photo is already being processed. Please wait a moment and retry.', 409);
  }
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  const deadline = Date.now() + 40000;
  const publicId = `medalshelf-temporary/${job.id}`;
  await admin.from('image_jobs').update({ provider_cleanup_pending: true }).eq('id', job.id);
  try {
    await cloudinary.uploader.upload(`data:image/png;base64,${normalized.toString('base64')}`, {
      public_id: publicId,
      type: 'authenticated',
      overwrite: false,
      resource_type: 'image',
      timeout: 20000,
    });
    const transformed = cloudinary.url(publicId, {
      type: 'authenticated',
      sign_url: true,
      format: 'png',
      transformation: [{ effect: 'background_removal' }],
    });
    let output: Response | undefined;
    for (let attempt = 0; attempt < 8 && Date.now() < deadline; attempt++) {
      output = await fetch(transformed, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (output.ok) break;
      if (![420, 423].includes(output.status)) throw new Error('Provider could not process image');
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
    if (!output?.ok) throw new Error('Processing timed out');
    const result = await sharp(Buffer.from(await output.arrayBuffer()), {
      limitInputPixels: 4_000_000,
    })
      .png()
      .toBuffer();
    const resultPath = `${user.id}/processing/${job.id}.png`;
    const { error: storeError } = await admin.storage
      .from('medals')
      .upload(resultPath, result, { contentType: 'image/png', upsert: true });
    if (storeError) throw storeError;
    const { error: finishError } = await admin
      .from('image_jobs')
      .update({ status: 'complete', result_path: resultPath })
      .eq('id', job.id)
      .eq('owner_id', user.id);
    if (finishError) {
      await admin.storage.from('medals').remove([resultPath]);
      throw finishError;
    }
    return new Response(new Uint8Array(result), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch {
    await admin
      .from('image_jobs')
      .update({ status: 'failed' })
      .eq('id', job.id)
      .eq('owner_id', user.id);
    return failure(
      'AI cleanup could not finish. Your original photo is safe. Try quick cleanup or retry later.',
      502,
    );
  } finally {
    try {
      await cloudinary.uploader.destroy(publicId, { type: 'authenticated', invalidate: true });
      await admin.from('image_jobs').update({ provider_cleanup_pending: false }).eq('id', job.id);
    } catch {
      /* The cleanup endpoint retries IDs recorded in image_jobs. */
    }
  }
}
