import { useState, useEffect } from 'react';

// Track 1121: the one definition of "mobile" in this codebase. 767px must
// stay in lockstep with Tailwind's `md` breakpoint (768px) — every mobile-
// only behavioral branch (not just styling, which uses `md:` classes
// directly) reads this hook, or this exported query string, so there is
// exactly one place this number lives.
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_MEDIA_QUERY).matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleChange = e => setIsMobile(e.matches);
    mql.addEventListener('change', handleChange);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}
