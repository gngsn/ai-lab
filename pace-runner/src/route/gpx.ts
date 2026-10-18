import type { GpsPoint, Run } from './types';

const TRKPT = /<(?:\w+:)?trkpt\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?trkpt>|<(?:\w+:)?trkpt\b([^>]*)\/>/g;
const ATTR = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`);
const TIME = /<(?:\w+:)?time>([^<]+)<\/(?:\w+:)?time>/;
const NAME = /<(?:\w+:)?name>(?:<!\[CDATA\[)?([^<\]]+)/;

/** Minimal GPX track parser — regex based so it also runs outside the browser. */
export function parseGpx(xml: string, fallbackName = 'Imported run'): Run {
  const points: GpsPoint[] = [];
  for (const m of xml.matchAll(TRKPT)) {
    const attrs = m[1] ?? m[3] ?? '';
    const lat = Number(attrs.match(ATTR('lat'))?.[1]);
    const lon = Number(attrs.match(ATTR('lon'))?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const timeStr = m[2]?.match(TIME)?.[1];
    const ms = timeStr ? Date.parse(timeStr.trim()) : NaN;
    points.push(Number.isFinite(ms) ? { lat, lon, t: ms / 1000 } : { lat, lon });
  }
  if (points.length < 2) throw new Error('The GPX file needs at least 2 track points.');
  const firstT = points.find((p) => p.t !== undefined)?.t;
  return {
    id: `gpx-${Date.now().toString(36)}`,
    name: xml.match(NAME)?.[1]?.trim() || fallbackName,
    date: firstT ? new Date(firstT * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    points,
  };
}
