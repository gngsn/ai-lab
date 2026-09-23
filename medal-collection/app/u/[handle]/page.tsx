import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import { Medal as MedalIcon, ArrowRight } from 'lucide-react';
import { dateLabel, distanceLabel } from '@/lib/validation';
export const dynamic = 'force-dynamic';
type PublicMedal = {
  id: string;
  race_name: string;
  race_date: string;
  distance: number;
  duration: string;
  location: string;
  image_path: string;
  color: string;
};
export default async function PublicShelf({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle)) notFound();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) notFound();
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.rpc('public_shelf', { requested_handle: handle });
  if (error) throw new Error('This shelf could not be loaded. Please try again.');
  if (!data) notFound();
  const medals = data.medals as PublicMedal[];
  return (
    <>
      <header className="site-header">
        <a href="/" className="brand">
          <span className="brand-icon">
            <MedalIcon size={25} />
          </span>
          medalshelf.
        </a>
        <a href="/" className="button primary">
          Start your shelf <ArrowRight size={16} />
        </a>
      </header>
      <main>
        <section className="public-hero">
          <div className="avatar large">{data.name.slice(0, 1).toUpperCase()}</div>
          <div className="eyebrow">EVERY FINISH HAS A STORY</div>
          <h1>{data.name}’s medal shelf.</h1>
          <p>
            {medals.length} medals ·{' '}
            {medals.reduce((sum, m) => sum + Number(m.distance), 0).toFixed(1)} km of determination
          </p>
        </section>
        <div className="medal-grid public-grid">
          {medals.map((m) => (
            <article key={m.id} className="medal-card public-card">
              <div className="medal-card-image" style={{ background: m.color }}>
                <span className="distance-pill">{distanceLabel(Number(m.distance))}</span>
                <img
                  src={`/api/public-image?handle=${encodeURIComponent(handle)}&medal=${encodeURIComponent(m.id)}`}
                  alt={`${m.race_name} finisher medal`}
                  loading="lazy"
                />
              </div>
              <div className="medal-card-info">
                <div>
                  <span className="medal-date">{dateLabel(m.race_date)}</span>
                  <h3>{m.race_name}</h3>
                  <span className="medal-location">{m.location}</span>
                </div>
                {m.duration && (
                  <span className="finish-time">
                    {m.duration}
                    <small>FINISH TIME</small>
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
        {!medals.length && (
          <div className="empty-state">The next finish is on its way. No public medals yet.</div>
        )}
        <section className="bottom-note">
          <p>Race details are shared by the runner.</p>
          <a href="/" className="button secondary">
            Make a shelf of your own <ArrowRight size={16} />
          </a>
        </section>
      </main>
    </>
  );
}
