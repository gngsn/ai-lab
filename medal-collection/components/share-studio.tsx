'use client';
import { useEffect, useState } from 'react';
import {
  Download,
  Share2,
  LoaderCircle,
  Check,
  Smartphone,
  Square,
  ArrowUpRight,
} from 'lucide-react';
import Modal from './modal';
import { Medal, Profile } from '@/lib/types';
import { renderShare, ShareOptions } from '@/lib/share';
export default function ShareStudio({
  medals,
  profile,
  onClose,
}: {
  medals: Medal[];
  profile: Profile;
  onClose: () => void;
}) {
  const years = [...new Set(medals.map((m) => m.date.slice(0, 4)))].sort().reverse();
  const [options, setOptions] = useState<ShareOptions>({
    format: 'story',
    template: medals.length === 1 ? 'finish' : 'collection',
    showName: true,
    showTime: true,
    year: years[0] || String(new Date().getFullYear()),
  });
  const [image, setImage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let url = '';
    setBusy(true);
    setError('');
    setFile(null);
    setMessage('');
    renderShare(medals, profile, options)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImage(url);
        const nextFile = new File([blob], 'my-medal-shelf.png', { type: 'image/png' });
        setFile(nextFile);
        setCanShare(!!navigator.canShare?.({ files: [nextFile] }));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [medals, profile, options]);
  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file] });
      setMessage('Image shared.');
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError')
        setError('Sharing is unavailable. Download your image and share it from your gallery.');
    }
  }
  return (
    <Modal title="A finish worth sharing." onClose={onClose} wide>
      <div className="share-layout">
        <div className="share-preview-space">
          {image && (
            <img
              className={`share-preview ${options.format}`}
              src={image}
              alt="Your share image preview"
            />
          )}
          {busy && (
            <div className="preview-loading" role="status">
              <LoaderCircle className="spin" />
              Creating your image…
            </div>
          )}
        </div>
        <div className="share-controls">
          <span className="eyebrow">MAKE IT YOURS</span>
          <h3>Your miles. Your moment.</h3>
          <p className="muted">A little reminder of what you’re capable of.</p>
          <label>Layout</label>
          <div className="segmented">
            <button
              className={options.format === 'story' ? 'selected' : ''}
              onClick={() => setOptions({ ...options, format: 'story' })}
            >
              <Smartphone size={16} /> Story
            </button>
            <button
              className={options.format === 'square' ? 'selected' : ''}
              onClick={() => setOptions({ ...options, format: 'square' })}
            >
              <Square size={15} /> Square
            </button>
          </div>
          <label>
            Template
            <select
              value={options.template}
              onChange={(e) =>
                setOptions({ ...options, template: e.target.value as ShareOptions['template'] })
              }
            >
              <option value="finish">Finish-line moment</option>
              <option value="collection">My medal collection</option>
              <option value="year">Year in medals</option>
            </select>
          </label>
          {options.template === 'year' && (
            <label>
              Year
              <select
                value={options.year}
                onChange={(e) => setOptions({ ...options, year: e.target.value })}
              >
                {years.map((year) => (
                  <option key={year}>{year}</option>
                ))}
              </select>
            </label>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={options.showName}
              onChange={(e) => setOptions({ ...options, showName: e.target.checked })}
            />{' '}
            Show my name
          </label>
          {options.template === 'finish' && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={options.showTime}
                onChange={(e) => setOptions({ ...options, showTime: e.target.checked })}
              />{' '}
              Show finish time
            </label>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              <Check size={16} /> {message}
            </p>
          )}
          <a
            className={`button primary full ${busy || !file ? 'disabled' : ''}`}
            href={!busy ? image : undefined}
            download="my-medal-shelf.png"
            aria-disabled={busy || !file}
            onClick={(e) => {
              if (busy || !file) e.preventDefault();
            }}
          >
            <Download size={17} /> Download image
          </a>
          {canShare && (
            <button
              className="button secondary full"
              disabled={busy || !file}
              onClick={() => void share()}
            >
              <Share2 size={17} /> Share to an app
            </button>
          )}
          <div className="share-tip">
            <ArrowUpRight size={18} />
            <p>
              <b>Made for your Instagram Story.</b>
              <br />
              Download, open Instagram, and choose the image from your gallery.
            </p>
          </div>
          <small className="muted">
            1080 × {options.format === 'story' ? '1920' : '1080'} px · PNG
          </small>
        </div>
      </div>
    </Modal>
  );
}
