'use client';

import { useEffect } from 'react';

/**
 * Attaches a window.confirm() guard to any <form data-confirm="..."> submit.
 * Server actions do not let us read onSubmit from server components; this tiny
 * client island scans the DOM on mount.
 */
export function ConfirmSubmitScript() {
  useEffect(() => {
    const handler = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || form.tagName !== 'FORM') return;
      const message = form.dataset.confirm;
      if (!message) return;
      if (typeof window !== 'undefined' && !window.confirm(message)) {
        event.preventDefault();
      }
    };
    document.addEventListener('submit', handler, true);
    return () => document.removeEventListener('submit', handler, true);
  }, []);

  return null;
}