import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

// The licensed display font is optional; do not request a missing font file.
if (__HAS_LULO_FONT__) {
  const fontStyle = document.createElement('style');
  fontStyle.textContent = `@font-face {
    font-family: 'Lulo Clean';
    src: url('${import.meta.env.BASE_URL}fonts/LuloClean.woff2') format('woff2');
    font-weight: 800;
    font-display: swap;
  }`;
  document.head.appendChild(fontStyle);
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
