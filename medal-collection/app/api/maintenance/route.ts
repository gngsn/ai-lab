import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (
    !secret ||
    Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  )
    return new Response('Unauthorized', { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return new Response('Not configured', { status: 503 });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: jobs, error } = await admin
    .from('image_jobs')
    .select('*')
    .lt('created_at', new Date(Date.now() - 24 * 3600000).toISOString())
    .limit(100);
  if (error) return new Response('Could not load cleanup jobs', { status: 500 });
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  let removed = 0;
  for (const job of jobs ?? []) {
    try {
      if (job.provider_cleanup_pending)
        await cloudinary.uploader.destroy(`medalshelf-temporary/${job.id}`, {
          type: 'authenticated',
          invalidate: true,
        });
      if (job.result_path) {
        const { error } = await admin.storage.from('medals').remove([job.result_path]);
        if (error) continue;
      }
      const { error } = await admin.from('image_jobs').delete().eq('id', job.id);
      if (!error) removed++;
    } catch {
      /* Retain the job to retry on the next scheduled run. */
    }
  }
  let orphaned = 0;
  const { data: candidates, error: orphanError } = await admin.rpc('orphan_medal_assets');
  if (orphanError) return new Response('Could not scan orphan uploads', { status: 500 });
  if (candidates?.length) {
    const { error } = await admin.storage
      .from('medals')
      .remove(candidates.map((row: { path: string }) => row.path));
    if (!error) orphaned = candidates.length;
  }
  return Response.json({ removed, orphaned }, { headers: { 'Cache-Control': 'no-store' } });
}
