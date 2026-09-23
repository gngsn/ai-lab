'use client';
import { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ImagePlus,
  LoaderCircle,
  RotateCw,
  Sparkles,
  Upload,
  LockKeyhole,
} from 'lucide-react';
import Modal from './modal';
import { Medal, colors } from '@/lib/types';
import {
  normalizePhoto,
  transformPhoto,
  removePhotoBackground,
  removePhotoBackgroundAI,
} from '@/lib/images';
import { supabase } from '@/lib/supabase';
import { medalFields } from '@/lib/validation';
export default function MedalEditor({
  medal,
  onClose,
  onSave,
  canPublish,
}: {
  medal?: Medal;
  onClose: () => void;
  onSave: (medal: Medal, imageChanged: boolean) => Promise<void>;
  canPublish: boolean;
}) {
  const [step, setStep] = useState(medal ? 1 : 0);
  const [source, setSource] = useState(medal?.originalImage || medal?.image || '');
  const [image, setImage] = useState(medal?.image || '');
  const [original, setOriginal] = useState(medal?.originalImage || medal?.image || '');
  const [changed, setChanged] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [cutout, setCutout] = useState('');
  const [dark, setDark] = useState(false);
  const [form, setForm] = useState({
    raceName: medal?.raceName || '',
    date: medal?.date || new Date().toISOString().slice(0, 10),
    distance: String(medal?.distance ?? 42.195),
    duration: medal?.duration || '',
    location: medal?.location || '',
    note: medal?.note || '',
    color: medal?.color || colors[0],
    visibility: medal?.visibility || 'private',
  });
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  async function choose(file?: File) {
    if (!file) return;
    setBusy('Preparing your photo…');
    setError('');
    try {
      const result = await normalizePhoto(file);
      setSource(result);
      setImage(result);
      setOriginal(result);
      setCutout('');
      setRotation(0);
      setZoom(1);
      setChanged(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this photo.');
    } finally {
      setBusy('');
    }
  }
  async function transform(nextRotation: number, nextZoom: number) {
    setRotation(nextRotation);
    setZoom(nextZoom);
    setError('');
    try {
      const result = await transformPhoto(source, nextRotation, nextZoom);
      setImage(result);
      setOriginal(result);
      setCutout('');
      setChanged(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not edit the photo.');
    }
  }
  async function remove(ai = false) {
    setBusy('Preparing editor…');
    setError('');
    try {
      let result: string;
      if (ai) {
        const session = (await supabase?.auth.getSession())?.data.session;
        if (!session) throw new Error('Sign in to use AI cleanup.');
        setBusy('Finding the edges of your medal…');
        result = await removePhotoBackgroundAI(original, session.access_token);
      } else result = await removePhotoBackground(original, setBusy);
      setCutout(result);
      setImage(result);
      setChanged(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Background removal could not finish. Keep your original photo or try again.',
      );
    } finally {
      setBusy('');
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const parsed = medalFields.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (!image) {
      setError('Add a photo of your medal.');
      setStep(0);
      return;
    }
    setBusy('Saving your finish…');
    try {
      await onSave(
        {
          ...parsed.data,
          id: medal?.id || crypto.randomUUID(),
          image,
          originalImage: original,
          createdAt: medal?.createdAt || new Date().toISOString(),
        },
        changed,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal
      title={medal ? 'Edit your medal' : 'Another finish. Another story.'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="stepper">
        <span className={step === 0 ? 'active' : 'complete'}>
          <b>{step === 1 ? <Check size={12} /> : '1'}</b> Your medal
        </span>
        <div />
        <span className={step === 1 ? 'active' : ''}>
          <b>2</b> The story
        </span>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {step === 0 ? (
        <div className="editor-body">
          <input
            ref={gallery}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            hidden
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {!image ? (
            <>
              <div
                className="upload-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy) void choose(e.dataTransfer.files[0]);
                }}
              >
                <div className="upload-symbol">
                  <ImagePlus size={32} strokeWidth={1.3} />
                </div>
                <h3>Give your medal a home.</h3>
                <p>
                  One photo is all it takes to keep
                  <br />
                  that finish-line feeling.
                </p>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() => gallery.current?.click()}
                >
                  <Upload size={17} /> Choose a photo
                </button>
                <button
                  className="button text-button"
                  disabled={!!busy}
                  onClick={() => camera.current?.click()}
                >
                  <Camera size={17} /> Take a photo
                </button>
                <small>JPEG, PNG, WebP or HEIC · Up to 20 MB</small>
              </div>
              <div className="photo-tip">
                <Sparkles size={20} />
                <div>
                  <b>A little light goes a long way.</b>
                  <p>
                    Lay your medal on a plain background and photograph it from above. Natural light
                    works best.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={`photo-preview ${dark ? 'dark-preview' : ''}`}>
                <img src={image} alt="Your medal preview" />
                <button
                  aria-label="Switch preview background"
                  className="preview-toggle"
                  onClick={() => setDark(!dark)}
                />
              </div>
              <div className="photo-tools">
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => void transform((rotation + 90) % 360, zoom)}
                >
                  <RotateCw size={16} /> Rotate
                </button>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => gallery.current?.click()}
                >
                  <ImagePlus size={16} /> Replace
                </button>
                <button className="button primary" disabled={!!busy} onClick={() => void remove()}>
                  <Sparkles size={16} /> Remove background
                </button>
              </div>
              {canPublish && (
                <button
                  className="button secondary full"
                  disabled={!!busy}
                  onClick={() => void remove(true)}
                >
                  <Sparkles size={16} /> AI cleanup for complex backgrounds
                </button>
              )}
              <label className="zoom-label">
                Crop / zoom
                <input
                  aria-label="Crop zoom"
                  type="range"
                  min="1"
                  max="2.5"
                  step="0.05"
                  value={zoom}
                  disabled={!!busy}
                  onChange={(e) => void transform(rotation, Number(e.target.value))}
                />
              </label>
              {cutout && (
                <div className="segmented">
                  <button
                    className={image === cutout ? 'selected' : ''}
                    onClick={() => setImage(cutout)}
                  >
                    Use cutout
                  </button>
                  <button
                    className={image === original ? 'selected' : ''}
                    onClick={() => setImage(original)}
                  >
                    Use original
                  </button>
                </div>
              )}
              <p className="muted small">
                <LockKeyhole size={13} /> Quick cleanup works best with a plain, contrasting
                background. Review the edges before continuing.
              </p>
            </>
          )}
          {busy && (
            <p className="progress-message" role="status">
              <LoaderCircle className="spin" size={17} />
              {busy}
            </p>
          )}
          <div className="modal-footer">
            <span className="muted small">Your medal, exactly as you earned it.</span>
            <button
              className="button primary"
              disabled={!image || !!busy}
              onClick={() => setStep(1)}
            >
              Continue <ArrowRight size={17} />
            </button>
          </div>
        </div>
      ) : (
        <form className="editor-body" onSubmit={save}>
          <div className="mini-preview" style={{ background: form.color }}>
            <img src={image} alt="Selected medal" />
            <span>
              That finish-line feeling.
              <br />
              <b>Let’s give it a story.</b>
            </span>
            <button type="button" className="button secondary" onClick={() => setStep(0)}>
              Edit photo
            </button>
          </div>
          <label>
            Race name <span>*</span>
            <input
              autoFocus
              required
              maxLength={100}
              value={form.raceName}
              onChange={(e) => update('raceName', e.target.value)}
              placeholder="e.g. Seoul Marathon"
            />
          </label>
          <div className="form-row">
            <label>
              Race date <span>*</span>
              <input
                required
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={form.date}
                onChange={(e) => update('date', e.target.value)}
              />
            </label>
            <label>
              Distance <span>*</span>
              <select
                value={
                  ['42.195', '21.0975', '10', '5'].includes(form.distance)
                    ? form.distance
                    : 'custom'
                }
                onChange={(e) =>
                  update('distance', e.target.value === 'custom' ? '' : e.target.value)
                }
              >
                <option value="42.195">Marathon · 42.195 km</option>
                <option value="21.0975">Half marathon · 21.1 km</option>
                <option value="10">10K</option>
                <option value="5">5K</option>
                <option value="custom">Custom distance</option>
              </select>
            </label>
          </div>
          {!['42.195', '21.0975', '10', '5'].includes(form.distance) && (
            <label>
              Distance in kilometers
              <input
                type="number"
                min="0.01"
                max="1000"
                step="any"
                required
                value={form.distance}
                onChange={(e) => update('distance', e.target.value)}
              />
            </label>
          )}
          <div className="form-row">
            <label>
              Finish time <em>optional</em>
              <input
                inputMode="text"
                placeholder="03:45:00"
                value={form.duration}
                onChange={(e) => update('duration', e.target.value)}
                maxLength={9}
              />
            </label>
            <label>
              Location <em>optional</em>
              <input
                placeholder="Seoul, South Korea"
                maxLength={150}
                value={form.location}
                onChange={(e) => update('location', e.target.value)}
              />
            </label>
          </div>
          <label>
            A memory to keep <em>optional</em>
            <textarea
              rows={3}
              placeholder="The last kilometer. The people. The feeling."
              maxLength={1000}
              value={form.note}
              onChange={(e) => update('note', e.target.value)}
            />
          </label>
          <fieldset className="color-field">
            <legend>Shelf background</legend>
            <div>
              {colors.map((color, i) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Background color ${i + 1}`}
                  aria-pressed={form.color === color}
                  className={`color-swatch ${form.color === color ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => update('color', color)}
                >
                  {form.color === color && <Check size={17} />}
                </button>
              ))}
            </div>
          </fieldset>
          {canPublish && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.visibility === 'public'}
                onChange={(e) => update('visibility', e.target.checked ? 'public' : 'private')}
              />
              <span>
                Include on my public shelf
                <small>Only visible when your public profile is also enabled.</small>
              </span>
            </label>
          )}
          <div className="modal-footer">
            <button
              type="button"
              className="button text-button"
              disabled={!!busy}
              onClick={() => setStep(0)}
            >
              <ArrowLeft size={16} /> Back
            </button>
            <button className="button primary" disabled={!!busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
              {busy || 'Save to my shelf'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
