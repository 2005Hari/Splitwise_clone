// In dev, client/.env points this at the API's own port (Vite serves the
// client; the API is a separate process). Left unset — the production
// Docker build does this deliberately — it falls back to '', so every
// request is same-origin and goes through nginx's /api proxy. That keeps
// auth cookies first-party instead of fighting SameSite across two domains.
const API_URL = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    ...options,
  });

  if (res.status === 204) return null;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message = (isJson && body?.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

export const api = {
  get: (path) => request(path),
  post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  patch: (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data ?? {}) }),
  del: (path) => request(path, { method: 'DELETE' }),
  // FormData body — browser sets the multipart Content-Type (with boundary) itself.
  upload: (path, formData) => request(path, { method: 'POST', body: formData }),
};
