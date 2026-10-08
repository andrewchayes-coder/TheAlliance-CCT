import { useEffect } from 'react';

export function useSeo(title: string, description: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} | Alliance Volunteer Portal`;
    const restore: Array<() => void> = [];
    for (const [attr, key, val] of [['name', 'description', description], ['property', 'og:title', document.title], ['property', 'og:description', description]]) {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      const created = !el;
      const old = el?.content ?? '';
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
      el.content = val;
      const m = el;
      restore.push(() => { if (created) m.remove(); else m.content = old; });
    }
    return () => { document.title = prev; restore.forEach(r => r()); };
  }, [title, description]);
}
