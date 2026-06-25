import { describe, it, expect } from 'vitest';
import { safeFilename } from './safe-filename';
import { slugify } from './slugify';

describe('safeFilename', () => {
  it('lowercases and replaces unsafe characters', () => {
    expect(safeFilename('My Photo (1).PNG')).toBe('my-photo-1-.png');
  });

  it('falls back when the name reduces to empty', () => {
    expect(safeFilename('***')).toBe('file');
  });

  it('caps length at 80 characters', () => {
    expect(safeFilename('a'.repeat(200)).length).toBe(80);
  });
});

describe('slugify', () => {
  it('produces a filename-safe slug', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('falls back to "untitled" when empty', () => {
    expect(slugify('   ')).toBe('untitled');
  });
});
