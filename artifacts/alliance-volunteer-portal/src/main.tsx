import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';
import { officialAddressRedirect } from './lib/official-address';

async function startPortal() {
  if (import.meta.env.PROD && window.location.hostname.endsWith('.replit.app')) {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/auth/session`, { credentials: 'include', cache: 'no-store' });
      if (response.ok) {
        const session = await response.json();
        const target = officialAddressRedirect(window.location, session.appOrigin, true);
        if (target) { window.location.replace(target); return; }
      }
    } catch (error) { console.error('The official portal address could not be checked.', error); }
  }
  createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
}
void startPortal();
