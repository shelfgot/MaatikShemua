import { useEffect } from 'react';

interface Shortcuts {
  [key: string]: () => void;
}

export function useKeyboardShortcuts(shortcuts: Shortcuts, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    
    const handler = (e: KeyboardEvent) => {
      // Don't trigger in input fields unless explicitly allowed
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        // Only allow Escape and Ctrl+S in inputs
        if (e.key !== 'Escape' && !(e.ctrlKey && e.key === 's')) {
          return;
        }
      }
      
      const key = [
        e.ctrlKey && 'Ctrl',
        e.altKey && 'Alt',
        e.shiftKey && 'Shift',
        e.key,
      ].filter(Boolean).join('+');
      
      if (shortcuts[key]) {
        e.preventDefault();
        shortcuts[key]();
      }
    };
    
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts, enabled]);
}
