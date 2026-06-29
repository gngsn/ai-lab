/** Tiny typed wrapper over the local PostgREST data API. The only HTTP knowledge
 *  the local store adapters need; keeps fetch/PostgREST quirks out of features. */
export interface RestClientOptions {
  baseUrl: string;
  /** Supplies the current access token (owner session) for authorized requests. */
  getToken?: () => string | null;
}

export class RestClient {
  constructor(private readonly opts: RestClientOptions) {}

  /** GET a collection. `query` is a raw PostgREST query string, e.g. `owner_id=eq.x&order=updated_at.desc`. */
  get<T>(path: string, query = ''): Promise<T> {
    const url = query ? `${this.base}${path}?${query}` : `${this.base}${path}`;
    return this.send<T>('GET', url);
  }

  post<T>(path: string, body: unknown, prefer = 'return=representation'): Promise<T> {
    return this.send<T>('POST', `${this.base}${path}`, body, { Prefer: prefer });
  }

  patch<T>(path: string, query: string, body: unknown): Promise<T> {
    return this.send<T>('PATCH', `${this.base}${path}?${query}`, body, {
      Prefer: 'return=representation',
    });
  }

  delete(path: string, query: string): Promise<void> {
    return this.send<void>('DELETE', `${this.base}${path}?${query}`);
  }

  /** Call a Postgres function exposed at `/rpc/<fn>`. */
  rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.send<T>('POST', `${this.base}/rpc/${fn}`, args);
  }

  private get base(): string {
    return this.opts.baseUrl.replace(/\/$/, '');
  }

  private async send<T>(
    method: string,
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = this.opts.getToken?.();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`PostgREST ${method} ${url} failed: ${res.status} ${detail}`);
    }
    // `return=minimal` and 204 responses have an empty body — don't JSON.parse those.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
