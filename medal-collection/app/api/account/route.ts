import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function DELETE(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = request.headers.get('authorization');
  if (!url || !anon || !service)
    return Response.json(
      { error: 'Account deletion is not configured. Contact the service owner.' },
      { status: 503 },
    );
  if (!authorization?.startsWith('Bearer '))
    return Response.json({ error: 'Please sign in again.' }, { status: 401 });
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const {
    data: { user },
    error,
  } = await client.auth.getUser(authorization.slice(7));
  if (error || !user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  try {
    const { error: profileError } = await admin
      .from('profiles')
      .update({ is_public: false })
      .eq('id', user.id);
    if (profileError) throw profileError;
    const { data: jobs, error: jobsError } = await admin
      .from('image_jobs')
      .select('id')
      .eq('owner_id', user.id)
      .eq('provider_cleanup_pending', true);
    if (jobsError) throw jobsError;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    for (const job of jobs ?? []) {
      await cloudinary.uploader.destroy(`medalshelf-temporary/${job.id}`, {
        type: 'authenticated',
        invalidate: true,
      });
      await admin.from('image_jobs').update({ provider_cleanup_pending: false }).eq('id', job.id);
    }
    async function removeFolder(prefix: string) {
      while (true) {
        const { data, error } = await admin.storage.from('medals').list(prefix, { limit: 100 });
        if (error) throw error;
        if (!data?.length) break;
        const files: string[] = [];
        for (const entry of data) {
          const path = `${prefix}/${entry.name}`;
          if (!entry.id) await removeFolder(path);
          else files.push(path);
        }
        if (files.length) {
          const { error } = await admin.storage.from('medals').remove(files);
          if (error) throw error;
        }
      }
    }
    await removeFolder(user.id);
    const { error: deletionError } = await admin.auth.admin.deleteUser(user.id);
    if (deletionError) throw deletionError;
    return Response.json({ deleted: true });
  } catch {
    return Response.json(
      {
        error:
          'Deletion could not finish. Your public shelf has been disabled. Please retry to finish removing your account.',
      },
      { status: 502 },
    );
  }
}
