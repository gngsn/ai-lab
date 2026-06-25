/** Keeps DOMPurify (or any sanitizer) out of the core; injected where HTML is cleaned. */
export interface SanitizerPort {
  /** Return safe HTML, stripping scripts, inline handlers, and `javascript:` URLs. */
  sanitize(html: string): string;
}
