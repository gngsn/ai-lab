import DOMPurify from 'dompurify';
import type { SanitizerPort } from '@ports/sanitizer-port';

/** DOMPurify-backed sanitizer; the only place DOMPurify is imported. */
export class DompurifySanitizer implements SanitizerPort {
  sanitize(html: string): string {
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['style'],
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['script'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    });
  }
}
