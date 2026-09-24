import { createRoot } from 'react-dom/client';
import { resolveLang, setLang } from '../../shared/i18n';
import { minute } from './api';
import { App } from './App';
import { ToastProvider } from './components/ui';
import './styles.css';

// langue de l'interface posée avant le premier rendu ; si elle change, la fenêtre se recharge
void Promise.all([minute.settings.get(), minute.info()]).then(([s, info]) => {
  const lang = resolveLang(s.uiLanguage, info.locale);
  setLang(lang);
  document.documentElement.lang = lang;
  minute.on('settings', (next) => {
    if (resolveLang(next.uiLanguage, info.locale) !== lang) location.reload();
  });
  createRoot(document.getElementById('root')!).render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
});
