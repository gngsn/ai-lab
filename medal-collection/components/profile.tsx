'use client';
import { useRef, useState } from 'react';
import {
  Check,
  Copy,
  LogIn,
  LogOut,
  LoaderCircle,
  LockKeyhole,
  Download,
  Upload,
  Trash2,
  ArrowUpRight,
} from 'lucide-react';
import Modal from './modal';
import { Profile, Medal } from '@/lib/types';
import { createBackup, parseBackup } from '@/lib/backups';
import { supabase } from '@/lib/supabase';
export default function ProfileDialog({
  profile,
  medals,
  email,
  onSave,
  onClose,
  onSignOut,
  onImport,
  onRestore,
}: {
  profile: Profile;
  medals: Medal[];
  email?: string;
  onSave: (profile: Profile) => Promise<void>;
  onClose: () => void;
  onSignOut: () => Promise<void>;
  onImport: () => Promise<number>;
  onRestore: (medals: Medal[]) => Promise<number>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const restoreInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(profile);
  const [inputEmail, setInputEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const handle = form.handle.toLowerCase().trim();
    if ((handle || form.isPublic) && !/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle)) {
      setError('Choose a handle of 3–30 letters, numbers, hyphens, or underscores.');
      return;
    }
    setBusy(true);
    try {
      await onSave({ ...form, name: form.name.trim() || 'Runner', handle });
      setMessage('Profile saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile.');
    } finally {
      setBusy(false);
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: inputEmail,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setError(error.message);
    else
      setMessage(
        'Check your inbox for a sign-in link. Your local medals will stay on this device until you import them.',
      );
    setBusy(false);
  }
  async function backup() {
    setBusy(true);
    setError('');
    try {
      const url = URL.createObjectURL(await createBackup(medals, profile));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'medal-shelf-backup.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Backup downloaded, including your photos. Keep this file somewhere safe.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function restore(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('Choose a backup smaller than 100 MB.');
      const items = parseBackup(await file.text());
      const count = await onRestore(items);
      setMessage(
        `Restored ${count} medals. Existing medals were kept, and restored medals are private.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (confirmation !== 'DELETE' || !supabase) return;
    setBusy(true);
    setError('');
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error('Please sign in again.');
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) throw new Error((await response.json()).error);
      await onSignOut();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Account deletion failed. Please retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Your corner of the running world." onClose={onClose}>
      <div className="editor-body">
        <div className="profile-banner">
          <div className="avatar large">{profile.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <h3>{profile.name}</h3>
            <p>{email || 'Your personal medal shelf'}</p>
          </div>
        </div>
        {message && (
          <p className="notice" role="status">
            <Check size={17} />
            {message}
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={save}>
          <label>
            Display name
            <input
              required
              maxLength={60}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          {email && (
            <>
              <label>
                Public handle
                <input
                  maxLength={30}
                  placeholder="your-running-name"
                  value={form.handle}
                  onChange={(e) => setForm({ ...form, handle: e.target.value })}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
                />
                <span>
                  Enable my public shelf
                  <small>Only individually public medals appear. Private notes stay private.</small>
                </span>
              </label>
              {profile.isPublic && profile.handle && (
                <div className="button-row">
                  <a
                    className="button secondary"
                    href={`/u/${profile.handle}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View public shelf <ArrowUpRight size={15} />
                  </a>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}/u/${profile.handle}`,
                        );
                        setMessage('Public shelf link copied.');
                      } catch {
                        setError('Could not copy the link.');
                      }
                    }}
                  >
                    <Copy size={15} /> Copy link
                  </button>
                </div>
              )}
            </>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Save profile
          </button>
        </form>
        <div className="profile-section">
          <h3>{email ? 'Your account' : 'Keep every finish safe.'}</h3>
          <p className="muted">
            {email
              ? 'Your medals are synced to your account.'
              : 'Without an account, medals are saved in this browser. Download a backup before clearing browser data.'}
          </p>
          {!email && supabase && (
            <form onSubmit={login}>
              <label>
                Email
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={inputEmail}
                  onChange={(e) => setInputEmail(e.target.value)}
                />
              </label>
              <button className="button secondary full" disabled={busy}>
                <LogIn size={17} /> Send sign-in link
              </button>
            </form>
          )}
          {email && (
            <>
              <button
                className="button secondary full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const count = await onImport();
                    setMessage(
                      count
                        ? `Imported ${count} medals from this device.`
                        : 'No new local medals to import.',
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Import failed.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import medals from this device
              </button>
              <button
                className="button text-button full"
                disabled={busy}
                onClick={async () => {
                  await onSignOut();
                  onClose();
                }}
              >
                <LogOut size={16} /> Sign out
              </button>
            </>
          )}
          <button className="button secondary full" disabled={busy} onClick={() => void backup()}>
            <Download size={17} /> Download collection backup
          </button>
          <input
            ref={restoreInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void restore(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            className="button secondary full"
            disabled={busy}
            onClick={() => restoreInput.current?.click()}
          >
            <Upload size={17} /> Restore a backup
          </button>
          <p className="muted small">
            <LockKeyhole size={13} />
            Your shelf is private until you choose to share it.
          </p>
          {email &&
            (deleting ? (
              <form className="delete-confirm" onSubmit={deleteAccount}>
                <b>Delete your account and synced medals?</b>
                <p>
                  Your photos and race details will be removed. Local collections and downloaded
                  backups stay on your device.
                </p>
                <label>
                  Type DELETE to confirm
                  <input
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <div className="button-row">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setDeleting(false)}
                  >
                    Keep account
                  </button>
                  <button className="button danger" disabled={busy || confirmation !== 'DELETE'}>
                    <Trash2 size={16} /> Delete account
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="button text-button full"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                Delete my account
              </button>
            ))}
        </div>
      </div>
    </Modal>
  );
}
