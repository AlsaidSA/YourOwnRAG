/*
 * Copyright 2026 OwnRAG contributors
 * Modified from an upstream Apache-2.0 project; see NOTICE for origin and attribution.
 * Copyright 2026 The InfiniFlow Authors. Licensed under the Apache License, Version 2.0.
 *
 * Transport. One axios instance for the whole console, plus the demo fallback.
 *
 * The preserved backend answers every request with HTTP 200 and a body of
 * `{ code, data, message, total? }`; `code === 0` means success. This module is the only
 * place that knows that, so pages deal in plain data and typed errors.
 *
 * Fallback policy: if the API is unreachable (no error response at all — DNS, refused
 * connection, offline), the console switches to the bundled demo corpus *once*, tells the
 * user through a toast and a persistent banner, and keeps serving from memory. A response
 * that arrives with a non-zero code is a real API error and is never masked by demo data.
 */
import axios, { type AxiosRequestConfig } from 'axios';
import { resolveDemo } from '@/api/demo/handlers';
import { getAuthToken, clearSession } from '@/store/auth';
import { useUiStore } from '@/store/ui';

export class ApiError extends Error {
  code: number;
  status?: number;
  constructor(message: string, code = 102, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** Sentinel code the console uses for "we could not reach the API at all". */
export const OFFLINE_CODE = -1;

export interface Envelope<T> {
  code: number;
  data: T;
  message?: unknown;
  total?: number;
}

export const http = axios.create({
  timeout: 120_000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    // The backend accepts the raw Authorization value and strips a Bearer prefix itself.
    config.headers.Authorization = `Bearer ${token}`;
  }
  // A multipart body must keep the boundary the browser generates; the instance-wide JSON
  // content-type would make the upload unreadable server-side.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login?reason=expired');
      }
    }
    return Promise.reject(error);
  },
);

export const isDemoMode = () => useUiStore.getState().demoMode;

let offlineToastShown = false;
function enterDemo(reason: string) {
  useUiStore.getState().enterDemoMode(reason);
  if (!offlineToastShown) {
    offlineToastShown = true;
    useUiStore.getState().toast({
      title: 'API unreachable — showing demo data',
      description: `${reason}. OwnRAG is rendering its bundled sample corpus so the console stays explorable. No data here comes from your backend.`,
      variant: 'warning',
      duration: 12_000,
    });
  }
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const anyError = error as {
    response?: { status?: number; data?: { message?: unknown; code?: number } };
    message?: string;
  };
  const payload = anyError?.response?.data;
  const message =
    (typeof payload?.message === 'string' && payload.message) ||
    (typeof payload?.message === 'object' && payload.message !== null
      ? JSON.stringify(payload.message)
      : undefined) ||
    anyError?.message ||
    'Request failed';
  return new ApiError(message, payload?.code ?? 102, anyError?.response?.status);
}

function unwrap<T>(envelope: Envelope<T>): T {
  if (envelope === null || envelope === undefined || typeof envelope !== 'object') {
    throw new ApiError('Malformed response from the API', 102);
  }
  if (envelope.code !== 0) {
    const message =
      typeof envelope.message === 'string' && envelope.message
        ? envelope.message
        : 'The API rejected the request';
    throw new ApiError(message, envelope.code);
  }
  return envelope.data;
}

function isNetworkFailure(error: unknown): boolean {
  const anyError = error as {
    response?: { status?: number; data?: unknown };
    code?: string;
    message?: string;
  };
  const response = anyError?.response;

  if (!response) {
    return (
      anyError?.code === 'ERR_NETWORK' ||
      anyError?.code === 'ECONNABORTED' ||
      /Network Error|Failed to fetch|fetch failed|timeout/i.test(anyError?.message ?? '')
    );
  }

  // A dev proxy, gateway or load balancer answers on the API's behalf when the API itself is
  // down. Those responses are not API answers: they carry no `{ code, data, message }`
  // envelope. Treat 5xx without an envelope as "unreachable" so the demo corpus can take
  // over — but never mask a real error, which always arrives inside the envelope.
  const status = response.status ?? 0;
  const body = response.data;
  const isEnvelope =
    Boolean(body) && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'number';
  return !isEnvelope && status >= 500;
}

interface RequestOptions {
  params?: Record<string, unknown>;
  body?: unknown;
  signal?: AbortSignal;
  /** Set for calls that must never fall back to demo data (e.g. live model calls). */
  noDemoFallback?: boolean;
}

async function demoResponse<T>(method: string, url: string, body: unknown): Promise<Envelope<T>> {
  // A small, stable latency keeps loading states honest instead of flashing.
  await new Promise((resolve) => setTimeout(resolve, 90 + Math.random() * 140));
  const resolved = resolveDemo(method, url, body);
  if (!resolved) {
    throw new ApiError(
      `The demo corpus does not model ${method.toUpperCase()} ${url}. Start the API server to use this screen for real.`,
      404,
    );
  }
  return resolved as Envelope<T>;
}

function withParams(url: string, params?: Record<string, unknown>) {
  if (!params) return url;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.append(key, String(value));
  });
  const qs = search.toString();
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

async function send<T>(method: string, url: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  const finalUrl = withParams(url, options.params);

  if (isDemoMode() && !options.noDemoFallback) {
    return demoResponse<T>(method, finalUrl, options.body);
  }

  try {
    const config: AxiosRequestConfig = {
      method,
      url: finalUrl,
      data: options.body,
      signal: options.signal,
    };
    const response = await http.request<Envelope<T>>(config);
    return response.data as Envelope<T>;
  } catch (error) {
    if (!options.noDemoFallback && !isDemoMode() && isNetworkFailure(error)) {
      enterDemo('The OwnRAG API did not answer');
      return demoResponse<T>(method, finalUrl, options.body);
    }
    throw normalizeError(error);
  }
}

export const api = {
  get: <T>(url: string, options?: RequestOptions) => send<T>('GET', url, options).then(unwrap),
  post: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    send<T>('POST', url, { ...options, body }).then(unwrap),
  put: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    send<T>('PUT', url, { ...options, body }).then(unwrap),
  patch: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    send<T>('PATCH', url, { ...options, body }).then(unwrap),
  delete: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    send<T>('DELETE', url, { ...options, body }).then(unwrap),

  /**
   * Multipart upload. The browser sets the boundary, so the body is sent as-is; demo mode has
   * no bytes to send and degrades to the same name list its handlers already serve.
   */
  upload: <T>(url: string, form: FormData, options?: RequestOptions) =>
    send<T>('POST', url, {
      ...options,
      body:
        isDemoMode() && !options?.noDemoFallback
          ? { names: form.getAll('file').map((entry) => (entry as File).name) }
          : form,
    }).then(unwrap),

  /** List endpoints: keeps the backend's `total` so pagination reflects server truth. */
  async list<T>(url: string, options?: RequestOptions): Promise<{ items: T[]; total: number }> {
    const envelope = await send<T[]>('GET', url, options);
    const items = (unwrap(envelope) ?? []) as T[];
    return { items, total: typeof envelope.total === 'number' ? envelope.total : items.length };
  },
};

export { isNetworkFailure };
