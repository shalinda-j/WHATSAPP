import { useState, useEffect } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms of
 * inactivity. Use this to avoid firing API calls on every keystroke in search
 * inputs — the debounced value is safe to include in `useEffect` dependency
 * arrays because it only changes when the user pauses typing.
 *
 * @example
 *   const debouncedSearch = useDebounce(searchTerm, 300);
 *   useEffect(() => { fetchContacts(debouncedSearch); }, [debouncedSearch]);
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debouncedValue;
}
