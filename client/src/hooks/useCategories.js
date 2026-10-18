import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Static reference data — fetched once per page load and cached in module
// scope so every component that needs it doesn't re-fetch.
let cache = null;

export function useCategories() {
  const [categories, setCategories] = useState(cache || []);

  useEffect(() => {
    if (cache) return;
    api.get('/api/categories').then(({ categories }) => {
      cache = categories;
      setCategories(categories);
    });
  }, []);

  return categories;
}
