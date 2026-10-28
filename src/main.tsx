import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fonts (SIL Open Font License), bundled by Vite: no request to Google.
import '@fontsource/marcellus/latin-400.css';
import '@fontsource-variable/source-sans-3/wght.css';
import { App } from './App';
import './styles/tokens.css';
import './styles.css';

// Ask the browser not to clear this site's data under storage pressure.
void navigator.storage?.persist?.();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
