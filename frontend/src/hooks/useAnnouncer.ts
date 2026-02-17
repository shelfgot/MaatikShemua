import { useCallback, useRef } from 'react';

export function useAnnouncer() {
  const announcerRef = useRef<HTMLDivElement | null>(null);
  
  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (!announcerRef.current) {
      const announcer = document.createElement('div');
      announcer.setAttribute('role', 'status');
      announcer.setAttribute('aria-live', priority);
      announcer.setAttribute('aria-atomic', 'true');
      announcer.className = 'sr-only';
      document.body.appendChild(announcer);
      announcerRef.current = announcer;
    }
    
    announcerRef.current.setAttribute('aria-live', priority);
    // Clear and set to trigger announcement
    announcerRef.current.textContent = '';
    setTimeout(() => {
      if (announcerRef.current) {
        announcerRef.current.textContent = message;
      }
    }, 100);
  }, []);
  
  return { announce };
}
