export type Medal = {
  id: string;
  raceName: string;
  date: string;
  distance: number;
  duration: string;
  location: string;
  note: string;
  image: string;
  originalImage?: string;
  color: string;
  visibility: 'private' | 'public';
  createdAt: string;
  demo?: boolean;
};
export type Profile = { name: string; handle: string; isPublic: boolean };
export const defaultProfile: Profile = { name: 'Runner', handle: '', isPublic: false };
export const colors = ['#ece9e1', '#e6ebdf', '#f0e3df', '#e2e8ed', '#eee5d8', '#e6e2ef'];
export const demoMedals: Medal[] = [
  {
    id: 'demo-1',
    raceName: 'Seoul Marathon',
    date: '2025-03-16',
    distance: 42.195,
    duration: '03:48:26',
    location: 'Seoul, South Korea',
    note: 'The early mornings. The last kilometer. All worth it.',
    image: '/medals/seoul.svg',
    color: colors[0],
    visibility: 'private',
    createdAt: '2025-03-16',
    demo: true,
  },
  {
    id: 'demo-2',
    raceName: 'Jeju Half Marathon',
    date: '2025-05-18',
    distance: 21.0975,
    duration: '01:46:12',
    location: 'Jeju, South Korea',
    note: 'Ocean air and a finish line I’ll never forget.',
    image: '/medals/jeju.svg',
    color: colors[1],
    visibility: 'private',
    createdAt: '2025-05-18',
    demo: true,
  },
  {
    id: 'demo-3',
    raceName: 'Seoul Night Run',
    date: '2025-09-06',
    distance: 10,
    duration: '00:49:38',
    location: 'Seoul, South Korea',
    note: 'Chasing city lights along the Han River.',
    image: '/medals/night.svg',
    color: colors[3],
    visibility: 'private',
    createdAt: '2025-09-06',
    demo: true,
  },
  {
    id: 'demo-4',
    raceName: 'Gyeongju Marathon',
    date: '2024-10-19',
    distance: 42.195,
    duration: '03:56:41',
    location: 'Gyeongju, South Korea',
    note: 'My very first marathon. One step at a time.',
    image: '/medals/gyeongju.svg',
    color: colors[4],
    visibility: 'private',
    createdAt: '2024-10-19',
    demo: true,
  },
  {
    id: 'demo-5',
    raceName: 'Cherry Blossom Run',
    date: '2025-04-05',
    distance: 10,
    duration: '00:52:08',
    location: 'Seoul, South Korea',
    note: 'A new season, a new starting line.',
    image: '/medals/cherry.svg',
    color: colors[2],
    visibility: 'private',
    createdAt: '2025-04-05',
    demo: true,
  },
];
