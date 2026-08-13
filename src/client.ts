export interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
}

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch.bind(globalThis)
  ) {}

  async request(method: string, path: string, options: RequestOptions = {}): Promise<unknown> {
    const url = this.buildUrl(path, options.query);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };

    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(url, init);

    if (!response.ok) {
      throw new ApiError(response.status);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private buildUrl(path: string, query?: Record<string, unknown>): URL {
    const baseOrigin = new URL(this.baseUrl).origin;
    const url = new URL(path, this.baseUrl);
    if (url.origin !== baseOrigin) {
      throw new Error(
        `Refusing cross-origin request path "${path}" (resolved to ${url.origin}, expected ${baseOrigin})`
      );
    }
    if (query === undefined) {
      return url;
    }
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }
}
