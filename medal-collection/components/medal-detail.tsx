'use client';
import { useState } from 'react';
import {
  CalendarDays,
  MapPin,
  Timer,
  Pencil,
  Share2,
  Trash2,
  LockKeyhole,
  Globe2,
  LoaderCircle,
} from 'lucide-react';
import Modal from './modal';
import { Medal } from '@/lib/types';
import { dateLabel, distanceLabel } from '@/lib/validation';
export default function MedalDetail({
  medal,
  onClose,
  onEdit,
  onShare,
  onDelete,
}: {
  medal: Medal;
  onClose: () => void;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={medal.raceName}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="detail-image" style={{ background: medal.color }}>
        <span className="distance-pill">{distanceLabel(medal.distance)}</span>
        <img src={medal.image} alt={`${medal.raceName} finisher medal`} />
      </div>
      <div className="editor-body">
        <div className="detail-meta">
          <span>
            <CalendarDays size={16} />
            {dateLabel(medal.date)}
          </span>
          {medal.location && (
            <span>
              <MapPin size={16} />
              {medal.location}
            </span>
          )}
          {medal.duration && (
            <span>
              <Timer size={16} />
              {medal.duration}
            </span>
          )}
        </div>
        {medal.note && <p className="medal-note">“{medal.note}”</p>}
        <p className="muted small">
          {medal.visibility === 'private' ? <LockKeyhole size={13} /> : <Globe2 size={13} />}
          {medal.demo
            ? 'Example medal · illustrative artwork and race details'
            : medal.visibility === 'private'
              ? 'Only you can see this medal.'
              : 'Included when your public shelf is enabled.'}
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {confirm ? (
          <div className="delete-confirm">
            <b>Remove this medal from your shelf?</b>
            <p>This removes the photo and race details. Shared downloads cannot be recalled.</p>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                Keep medal
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onDelete();
                    onClose();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not delete medal.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />} Remove
                medal
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-footer">
            <div className="button-row">
              {!medal.demo && (
                <>
                  <button
                    className="icon-button"
                    aria-label="Delete medal"
                    onClick={() => setConfirm(true)}
                  >
                    <Trash2 size={18} />
                  </button>
                  <button className="button secondary" onClick={onEdit}>
                    <Pencil size={16} /> Edit
                  </button>
                </>
              )}
            </div>
            <button className="button primary" onClick={onShare}>
              <Share2 size={16} /> Share this finish
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
