
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export const isText = (value, min = 1, max = 5000) =>
  typeof value === 'string' &&
  value.trim().length >= min &&
  value.trim().length <= max;
