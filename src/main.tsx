import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/baloo-2/800.css';
import '@fontsource/nunito-sans/500.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import './styles.css';
import App from './App';

// Title bar layout differs per OS (window controls right on Windows, left on macOS).
document.documentElement.dataset.platform = window.workbench.platform;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
