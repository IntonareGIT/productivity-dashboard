import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Self-hosted Inter, latin subset only (bundled by Vite -> precached by the
// service worker, so the app renders fully offline after first load)
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
