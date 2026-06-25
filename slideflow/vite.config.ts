import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const page = (name: string) => resolve(root, name);

// One HTML entry per SPEC page — preserves the public-filename contract.
export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(root, 'src/core'),
      '@ports': resolve(root, 'src/ports'),
      '@adapters': resolve(root, 'src/adapters'),
      '@features': resolve(root, 'src/features'),
      '@composition': resolve(root, 'src/composition'),
      '@ui': resolve(root, 'src/ui'),
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: page('index.html'),
        login: page('login.html'),
        edit: page('edit.html'),
        editFrame: page('edit-frame.html'),
        present: page('present.html'),
        note: page('note.html'),
        view: page('view.html'),
        training: page('training.html'),
      },
    },
  },
});
