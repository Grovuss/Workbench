import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/baloo-2/800.css';
import '@fontsource/nunito-sans/500.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import './styles.css';
import App from './App';
import { reduceMotionStored, setReduceMotion } from './motion';

// Title bar layout differs per OS (window controls right on Windows, left on macOS).
document.documentElement.dataset.platform = window.workbench.platform;
setReduceMotion(reduceMotionStored());

// A file dropped outside a drop zone would otherwise replace the app with that file.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
