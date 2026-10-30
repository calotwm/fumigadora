export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};

/** The app registers a handler that flips the auth state when any call answers 401. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface ApiOptions {
  method?: string;
  /** JSON body, or a FormData sent as multipart (file uploads). */
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const hasBody = options.body !== undefined;
  const isForm = options.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (hasBody ? 'POST' : 'GET'),
      credentials: 'same-origin',
      // The browser sets the multipart boundary itself.
      headers: hasBody && !isForm ? { 'content-type': 'application/json' } : undefined,
      body: isForm ? (options.body as FormData) : hasBody ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'No se pudo conectar con el servidor. Revise su conexión.');
  }
  if (response.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
  const text = await response.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!response.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? 'error',
      err?.message ?? 'Ocurrió un error inesperado.',
      err?.details,
    );
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
}
