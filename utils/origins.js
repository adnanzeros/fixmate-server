

const clean = value =>
  String(value || '')
    .trim()
    .replace(/\/+$/, '');

export const allowedOrigins = () =>
  (process.env.CLIENT_URL || '').split(',').map(clean).filter(Boolean);

/**
 * Picks the client URL to redirect back to (Stripe success / cancel).
 * Uses the browser Origin when it is allowed (works for localhost AND production
 * with one CLIENT_URL list), otherwise falls back to the first CLIENT_URL.
 */
export function clientUrlFor(req) {
  const list = allowedOrigins();
  const origin = clean(req?.headers?.origin);
  if (origin && list.includes(origin)) return origin;
  return list[0] || '';
}
