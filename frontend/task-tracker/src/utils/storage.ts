/**
 * Typed localStorage helpers with JSON serialisation and exception handling.
 */

/**
 * Load a JSON-serialised value from localStorage.
 * Returns `fallback` if the key is missing, the value is not valid JSON,
 * or any other exception is thrown.
 */
export function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Serialise `value` to JSON and write it to localStorage.
 * Silently swallows any exceptions (e.g. storage quota exceeded).
 */
export function saveLS<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
