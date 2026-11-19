import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { registerServiceWorker } from './offline';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker();

// iOS Safari は viewport の user-scalable=no を無視するため、ピンチの拡大操作を止める（reader.md §4.3）
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
