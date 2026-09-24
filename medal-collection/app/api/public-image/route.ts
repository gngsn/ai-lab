import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const params = new URL(request.url).searchParams;
  const handle = params.get('handle') || '';
  const medal = params.get('medal') || '';
  if (!url || !key || !/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle) || !/^[a-f0-9-]{36}$/.test(medal))
    return new Response('Not found', { status: 404 });
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.rpc('public_shelf', { requested_handle: handle });
  if (error) return new Response('Unavailable', { status: 503 });
  const asset = data?.medals?.find((m: { id: string; image_path: string }) => m.id === medal);
  if (!asset) return new Response('Not found', { status: 404 });
  const { data: photo, error: imageError } = await client.storage
    .from('medals')
    .download(asset.image_path);
  if (imageError || !photo) return new Response('Not found', { status: 404 });
  return new Response(photo, {
    headers: {
      'Content-Type': photo.type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
