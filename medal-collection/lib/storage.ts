import { get, set } from 'idb-keyval';
import { supabase } from './supabase';
import { Medal, Profile, defaultProfile } from './types';
export async function hasLocalShelf(): Promise<boolean> {
  return (await get('medalshelf:medals')) !== undefined;
}
export async function localMedals(): Promise<Medal[]> {
  return (await get('medalshelf:medals')) ?? [];
}
export async function saveLocalMedals(medals: Medal[]) {
  await set('medalshelf:medals', medals);
}
export async function localProfile(): Promise<Profile> {
  return (await get('medalshelf:profile')) ?? defaultProfile;
}
export async function saveLocalProfile(profile: Profile) {
  await set('medalshelf:profile', profile);
}
export async function cloudMedals(): Promise<Medal[]> {
  if (!supabase) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('medals')
    .select('*')
    .eq('owner_id', user.id)
    .order('race_date', { ascending: false });
  if (error) throw error;
  async function signed(path: string): Promise<string> {
    const { data, error } = await supabase!.storage.from('medals').createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }
  return Promise.all(
    (data ?? []).map(
      async (row) =>
        ({
          id: row.id,
          raceName: row.race_name,
          date: row.race_date,
          distance: Number(row.distance),
          duration: row.duration ?? '',
          location: row.location ?? '',
          note: row.note ?? '',
          image: await signed(row.image_path),
          originalImage: await signed(row.original_path || row.image_path),
          color: row.color,
          visibility: row.visibility,
          createdAt: row.created_at,
        }) as Medal,
    ),
  );
}
export async function saveCloudMedal(medal: Medal, imageChanged: boolean) {
  if (!supabase) throw new Error('Account storage is not configured.');
  const client = supabase;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error('Please sign in again.');
  const { data: existing, error: readError } = await client
    .from('medals')
    .select('image_path,original_path')
    .eq('id', medal.id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (readError) throw readError;
  const uploaded: string[] = [];
  async function upload(source: string) {
    const response = await fetch(source);
    if (!response.ok) throw new Error('Could not read the medal photo. Please reopen the editor.');
    const blob = await response.blob();
    const form = new FormData();
    form.set('image', blob, 'medal.png');
    // Decode and re-encode before storage, even if a client skipped local normalization.
    const normalized = await fetch('/api/images/normalize', { method: 'POST', body: form });
    if (!normalized.ok)
      throw new Error('Could not prepare the image for storage. Try a smaller photo.');
    const path = `${user!.id}/${medal.id}/${crypto.randomUUID()}.png`;
    const { error } = await client.storage
      .from('medals')
      .upload(path, await normalized.blob(), { contentType: 'image/png', upsert: false });
    if (error) throw error;
    uploaded.push(path);
    return path;
  }
  let path = existing?.image_path;
  let originalPath = existing?.original_path || path;
  try {
    if (imageChanged || !existing) {
      path = await upload(medal.image);
      originalPath =
        medal.originalImage && medal.originalImage !== medal.image
          ? await upload(medal.originalImage)
          : path;
    }
    const { error } = await client.from('medals').upsert({
      id: medal.id,
      owner_id: user.id,
      race_name: medal.raceName,
      race_date: medal.date,
      distance: medal.distance,
      duration: medal.duration,
      location: medal.location,
      note: medal.note,
      image_path: path,
      original_path: originalPath,
      color: medal.color,
      visibility: medal.visibility,
    });
    if (error) throw error;
  } catch (error) {
    if (uploaded.length) await client.storage.from('medals').remove(uploaded);
    throw error;
  }
  const obsolete = [...new Set([existing?.image_path, existing?.original_path])].filter(
    (value): value is string => !!value && value !== path && value !== originalPath,
  );
  if (obsolete.length) await client.storage.from('medals').remove(obsolete);
}
export async function deleteCloudMedal(id: string) {
  if (!supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in again.');
  const { data: row, error: readError } = await supabase
    .from('medals')
    .select('image_path,original_path')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single();
  if (readError) throw readError;
  // First revoke visibility so no new public request can read the image during deletion.
  const { error: privateError } = await supabase
    .from('medals')
    .update({ visibility: 'private' })
    .eq('id', id)
    .eq('owner_id', user.id);
  if (privateError) throw privateError;
  const paths = [...new Set([row.image_path, row.original_path].filter(Boolean))] as string[];
  const { error: imageError } = await supabase.storage.from('medals').remove(paths);
  if (imageError) throw imageError;
  const { error } = await supabase.from('medals').delete().eq('id', id).eq('owner_id', user.id);
  if (error) throw error;
}
