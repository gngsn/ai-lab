'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Flag,
  Footprints,
  Grid2X2,
  Heart,
  LayoutGrid,
  List,
  Medal as MedalIcon,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trophy,
  UserRound,
  X,
  LoaderCircle,
} from 'lucide-react';
import { Medal, Profile, demoMedals, defaultProfile } from '@/lib/types';
import { dateLabel, distanceLabel, durationSeconds } from '@/lib/validation';
import {
  localMedals,
  hasLocalShelf,
  saveLocalMedals,
  localProfile,
  saveLocalProfile,
  cloudMedals,
  saveCloudMedal,
  deleteCloudMedal,
} from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import MedalEditor from './medal-editor';
import MedalDetail from './medal-detail';
import ShareStudio from './share-studio';
import ProfileDialog from './profile';
import Modal from './modal';
export default function MedalApp() {
  const [medals, setMedals] = useState<Medal[]>([]);
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string>();
  const [demo, setDemo] = useState(true);
  const [editor, setEditor] = useState<Medal | 'new' | null>(null);
  const [detail, setDetail] = useState<Medal | null>(null);
  const [sharing, setSharing] = useState<Medal[] | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [filter, setFilter] = useState('all');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState('newest');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('grid');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const user = supabase ? (await supabase.auth.getUser()).data.user : null;
      setEmail(user?.email);
      const items = user ? await cloudMedals() : await localMedals();
      setMedals(items);
      setDemo(!user && !items.length && !(await hasLocalShelf()));
      if (user && supabase) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();
        if (error) throw error;
        setProfile(
          data
            ? { name: data.display_name, handle: data.handle || '', isPublic: data.is_public }
            : defaultProfile,
        );
      } else setProfile(await localProfile());
      setError('');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not load your shelf. Please refresh to retry.',
      );
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    void reload();
    const auth = supabase?.auth.onAuthStateChange(() => {
      setTimeout(() => void reload(), 0);
    });
    const refresh = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', refresh);
    return () => {
      auth?.data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const example = demo && medals.length === 0;
  const items = example ? demoMedals : medals;
  const years = [...new Set(items.map((m) => m.date.slice(0, 4)))].sort().reverse();
  const shown = useMemo(
    () =>
      items
        .filter(
          (m) =>
            (year === 'all' || m.date.startsWith(year)) &&
            (filter === 'all' ||
              (filter === 'marathon' && Math.abs(m.distance - 42.195) < 0.001) ||
              (filter === 'half' && Math.abs(m.distance - 21.0975) < 0.001) ||
              (filter === 'other' &&
                Math.abs(m.distance - 42.195) >= 0.001 &&
                Math.abs(m.distance - 21.0975) >= 0.001)) &&
            `${m.raceName} ${m.location}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === 'oldest'
            ? a.date.localeCompare(b.date)
            : sort === 'distance'
              ? b.distance - a.distance
              : b.date.localeCompare(a.date),
        ),
    [items, year, filter, query, sort],
  );
  const total = items.reduce((sum, medal) => sum + medal.distance, 0);
  const best = [...items]
    .filter((m) => Math.abs(m.distance - 42.195) < 0.001 && m.duration)
    .sort((a, b) => durationSeconds(a.duration) - durationSeconds(b.duration))[0];
  async function save(medal: Medal, imageChanged: boolean) {
    if (email) {
      await saveCloudMedal(medal, imageChanged);
      await reload();
    } else {
      const next = [...medals.filter((m) => m.id !== medal.id), medal];
      await saveLocalMedals(next);
      setMedals(next);
    }
    setDemo(false);
    setToast('A finish to remember. Medal saved.');
  }
  async function remove(id: string) {
    if (email) {
      await deleteCloudMedal(id);
      await reload();
    } else {
      const next = medals.filter((m) => m.id !== id);
      await saveLocalMedals(next);
      setMedals(next);
    }
    setToast('Medal removed from your shelf.');
  }
  async function saveProfile(next: Profile) {
    if (email && supabase) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in again.');
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        display_name: next.name,
        handle: next.handle || null,
        is_public: next.isPublic,
      });
      if (error)
        throw new Error(
          error.code === '23505' ? 'This handle is taken. Try another one.' : error.message,
        );
    } else await saveLocalProfile(next);
    setProfile(next);
  }
  return (
    <>
      <header className="site-header">
        <a href="/" className="brand" aria-label="Medal Shelf home">
          <span className="brand-icon">
            <MedalIcon size={25} strokeWidth={1.8} />
          </span>
          medalshelf<span className="brand-dot">.</span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button
            className="nav-link active"
            onClick={() =>
              document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            My collection
          </button>
          <button className="nav-link" onClick={() => setShowHow(true)}>
            How it works <ArrowUpRight size={13} />
          </button>
        </nav>
        <div className="header-actions">
          <span className="header-tag">FOR THE LOVE OF THE FINISH.</span>
          <button className="avatar" aria-label="Open profile" onClick={() => setShowProfile(true)}>
            {profile.name === 'Runner' ? (
              <UserRound size={19} />
            ) : (
              profile.name.charAt(0).toUpperCase()
            )}
          </button>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow hero-eyebrow">
              <span className="tiny-line" /> YOUR PERSONAL FINISH LINE
            </div>
            <h1>
              Every finish.
              <br />
              <span>A story worth keeping.</span>
            </h1>
            <p>
              The early mornings. The extra mile. That finish-line feeling.
              <br className="desktop-break" /> Give your hard-earned medals a place to shine.
            </p>
            <button className="button primary hero-button" onClick={() => setEditor('new')}>
              <Plus size={18} /> Add a medal <ArrowRight size={17} />
            </button>
            <div className="hero-caption">
              <LockIcon /> Your collection. Your pace. Always yours.
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="hero-spark spark-one">✳</div>
            <div className="hero-spark spark-two">✧</div>
            <div className="hero-medal-card back-card">
              <img src="/medals/jeju.svg" alt="" />
              <span>ONE MILE AT A TIME.</span>
            </div>
            <div className="hero-medal-card front-card">
              <span className="card-edition">THE FINISHER’S COLLECTION</span>
              <img src="/medals/seoul.svg" alt="" />
              <div className="hero-card-bottom">
                <span>
                  Made of miles.
                  <br />
                  <b>And a little determination.</b>
                </span>
                <MedalIcon size={22} />
              </div>
            </div>
            <div className="hero-sticker">
              <Check size={15} /> Every medal earned.
            </div>
            <span className="art-caption">MORE THAN METAL. A MILESTONE.</span>
          </div>
        </section>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button className="button text-button" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        )}
        <section
          className="stats"
          aria-label={example ? 'Example collection statistics' : 'Collection statistics'}
        >
          <div className="stat">
            <span className="stat-icon">
              <MedalIcon size={23} />
            </span>
            <div>
              <span className="stat-label">Medals collected</span>
              <div className="stat-value">
                {items.length.toString().padStart(2, '0')}
                <span>finishes to be proud of</span>
              </div>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon">
              <Footprints size={23} />
            </span>
            <div>
              <span className="stat-label">Distance celebrated</span>
              <div className="stat-value">
                {total.toFixed(1)}
                <span>km of determination</span>
              </div>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon">
              <Trophy size={23} />
            </span>
            <div>
              <span className="stat-label">Marathon personal best</span>
              <div className="stat-value">
                {best ? best.duration : '—'}
                <span>{best ? best.raceName : 'Your next chapter awaits'}</span>
              </div>
            </div>
          </div>
        </section>
        <section id="collection" className="collection">
          <div className="collection-heading">
            <div>
              <div className="eyebrow">A LITTLE PROOF OF A LOT OF HEART</div>
              <h2>
                {example ? 'Imagine your medal shelf.' : 'Your medal shelf.'}
                <span className="count-badge">{items.length}</span>
              </h2>
              <p>Every one has a story. This is where you keep them.</p>
            </div>
            <button
              className="button secondary share-collection"
              disabled={!items.length}
              onClick={() => setSharing(items)}
            >
              <Share2 size={16} /> Share collection
            </button>
          </div>
          {example && (
            <div className="demo-banner">
              <span>
                <Sparkles size={15} />
                <b>A little inspiration.</b> You’re exploring an example collection.
              </span>
              <button
                onClick={() => {
                  setDemo(false);
                  void saveLocalMedals([]).catch(() =>
                    setError(
                      'Could not save on this device. Check that browser storage is enabled.',
                    ),
                  );
                  setFilter('all');
                  setYear('all');
                }}
              >
                Start my shelf <ArrowRight size={15} />
              </button>
            </div>
          )}
          <div className="collection-toolbar">
            <div className="filter-tabs" aria-label="Filter by distance">
              {[
                ['all', 'All medals'],
                ['marathon', 'Marathon'],
                ['half', 'Half marathon'],
                ['other', 'Other distances'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? 'active' : ''}
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="collection-tools">
              <label className="select-tool">
                <span className="sr-only">Filter by year</span>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="all">All years</option>
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
              <label className="select-tool sort-tool">
                <ArrowDownUp size={14} />
                <span className="sr-only">Sort medals</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="distance">Longest distance</option>
                </select>
              </label>
              <div className="view-toggle">
                <button
                  aria-label="Grid view"
                  aria-pressed={view === 'grid'}
                  className={view === 'grid' ? 'active' : ''}
                  onClick={() => setView('grid')}
                >
                  <Grid2X2 size={16} />
                </button>
                <button
                  aria-label="List view"
                  aria-pressed={view === 'list'}
                  className={view === 'list' ? 'active' : ''}
                  onClick={() => setView('list')}
                >
                  <List size={18} />
                </button>
              </div>
            </div>
          </div>
          {!example && items.length > 0 && (
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="Search medals"
                placeholder="Find a race or a place…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery('')}>
                  <X size={16} />
                </button>
              )}
            </label>
          )}
          {!ready ? (
            <div className="empty-state" role="status">
              <LoaderCircle className="spin" />
              <p>Opening your shelf…</p>
            </div>
          ) : (
            <div className={`medal-grid ${view === 'list' ? 'list-view' : ''}`}>
              {shown.map((medal) => (
                <button className="medal-card" key={medal.id} onClick={() => setDetail(medal)}>
                  <div className="medal-card-image" style={{ background: medal.color }}>
                    <span className="distance-pill">{distanceLabel(medal.distance)}</span>
                    <img src={medal.image} alt={`${medal.raceName} medal`} loading="lazy" />
                    <span className="medal-open">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                  <div className="medal-card-info">
                    <div>
                      <span className="medal-date">{dateLabel(medal.date)}</span>
                      <h3>{medal.raceName}</h3>
                      <span className="medal-location">
                        {medal.location || 'A finish to remember'}
                      </span>
                    </div>
                    {medal.duration && (
                      <span className="finish-time">
                        {medal.duration}
                        <small>FINISH TIME</small>
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {((filter === 'all' && year === 'all' && !query) || !items.length) && (
                <button className="add-card" onClick={() => setEditor('new')}>
                  <span className="add-card-icon">
                    <Plus size={25} strokeWidth={1.5} />
                  </span>
                  <h3>Your next story goes here.</h3>
                  <p>
                    Big race or first 5K.
                    <br />
                    Every finish deserves a place.
                  </p>
                  <span className="add-card-link">
                    Add a medal <ArrowRight size={16} />
                  </span>
                </button>
              )}
            </div>
          )}
          {ready && !shown.length && items.length > 0 && (
            <div className="empty-state">
              <Search size={26} />
              <h3>No medals on this part of the shelf yet.</h3>
              <p>Try another distance, year, or race name.</p>
              <button
                className="button secondary"
                onClick={() => {
                  setFilter('all');
                  setYear('all');
                  setQuery('');
                }}
              >
                Show all medals
              </button>
            </div>
          )}
          {!email && !example && medals.length > 0 && (
            <p className="local-note">
              Saved on this device.{' '}
              <button onClick={() => setShowProfile(true)}>
                Manage your collection & backups <ArrowUpRight size={13} />
              </button>
            </p>
          )}
        </section>
        <section className="bottom-note">
          <div>
            <Heart size={18} />
            <p>
              Not just a collection. <b>A reminder of what you can do.</b>
            </p>
          </div>
          <span>KEEP SHOWING UP.</span>
        </section>
      </main>
      <footer className="site-footer">
        <a className="brand footer-brand" href="/">
          <MedalIcon size={19} /> medalshelf.
        </a>
        <p>Made for the miles. And the memories.</p>
        <span>
          Your story is still running. <ArrowUpRight size={14} />
        </span>
      </footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button
          className="active"
          onClick={() =>
            document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' })
          }
        >
          <LayoutGrid size={20} />
          <span>My shelf</span>
        </button>
        <button className="mobile-add" onClick={() => setEditor('new')}>
          <span>
            <Plus size={24} />
          </span>
          <b>Add medal</b>
        </button>
        <button onClick={() => setShowProfile(true)}>
          <UserRound size={20} />
          <span>Profile</span>
        </button>
      </nav>
      {editor && (
        <MedalEditor
          medal={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
          onSave={save}
          canPublish={!!email}
        />
      )}
      {detail && (
        <MedalDetail
          medal={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditor(detail);
            setDetail(null);
          }}
          onShare={() => {
            setSharing([detail]);
            setDetail(null);
          }}
          onDelete={() => remove(detail.id)}
        />
      )}
      {sharing && (
        <ShareStudio
          medals={sharing}
          profile={example ? { ...profile, name: 'Your name here' } : profile}
          onClose={() => setSharing(null)}
        />
      )}
      {showProfile && (
        <ProfileDialog
          profile={profile}
          medals={medals}
          email={email}
          onSave={saveProfile}
          onClose={() => setShowProfile(false)}
          onSignOut={async () => {
            await supabase?.auth.signOut();
            await reload();
          }}
          onRestore={async (restored) => {
            const current = email ? await cloudMedals() : medals;
            const incoming = restored.filter(
              (m) => !current.some((existing) => existing.id === m.id),
            );
            if (email) {
              try {
                for (const medal of incoming) await saveCloudMedal(medal, true);
              } finally {
                await reload();
              }
            } else {
              const next = [...current, ...incoming];
              await saveLocalMedals(next);
              setMedals(next);
              setDemo(false);
            }
            return incoming.length;
          }}
          onImport={async () => {
            const local = await localMedals();
            let count = 0;
            const remote = await cloudMedals();
            for (const medal of local) {
              if (!remote.some((m) => m.id === medal.id)) {
                await saveCloudMedal(medal, true);
                count++;
              }
            }
            await reload();
            return count;
          }}
        />
      )}
      {showHow && (
        <Modal title="A home for your hard-earned miles." onClose={() => setShowHow(false)}>
          <div className="editor-body how-steps">
            {[
              [
                <MedalIcon key="1" />,
                '01',
                'Snap your medal.',
                'Take a photo or choose one from your gallery. Remove the background, rotate, and make it yours.',
              ],
              [
                <Flag key="2" />,
                '02',
                'Keep the story.',
                'Add the race, your finish time, and the little details you never want to forget.',
              ],
              [
                <Share2 key="3" />,
                '03',
                'Share the feeling.',
                'Create a Story or square image, download it, and celebrate your finish wherever you like.',
              ],
            ].map(([icon, n, title, text]) => (
              <div key={String(n)}>
                <span className="how-icon">{icon}</span>
                <div>
                  <span className="eyebrow">STEP {n}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
            <button
              className="button primary full"
              onClick={() => {
                setShowHow(false);
                setEditor('new');
              }}
            >
              Add my first medal <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </>
  );
}
function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="2" />
      <path d="M5 7V4a3 3 0 0 1 6 0v3" />
    </svg>
  );
}
