import { z } from 'zod';
export const medalFields = z.object({
  raceName: z.string().trim().min(1, 'Enter the race name.').max(100),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a race date.')
    .refine((s) => {
      const date = new Date(s + 'T12:00:00Z');
      return (
        !isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === s &&
        s <= new Date().toISOString().slice(0, 10)
      );
    }, 'Choose a valid date that is not in the future.'),
  distance: z.coerce.number().positive('Enter a distance greater than zero.').max(1000),
  duration: z
    .string()
    .refine((s) => !s || /^\d{1,3}:[0-5]\d:[0-5]\d$/.test(s), 'Use HH:MM:SS for your finish time.'),
  location: z.string().trim().max(150),
  note: z.string().trim().max(1000),
  visibility: z.enum(['private', 'public']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export function distanceLabel(distance: number) {
  if (Math.abs(distance - 42.195) < 0.001) return 'Marathon';
  if (Math.abs(distance - 21.0975) < 0.001) return 'Half marathon';
  return `${Number(distance.toFixed(2))}K`;
}
export function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
export function durationSeconds(duration: string) {
  if (!duration) return Infinity;
  const [hours, minutes, seconds] = duration.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}
