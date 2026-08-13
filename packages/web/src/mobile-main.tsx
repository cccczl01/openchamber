import { createConfiguredWebAPIs } from './runtimeConfig';
import type { RuntimeAPIs } from '@noatinwork-app/ui/lib/api/types';
import '@noatinwork-app/ui/index.css';
import '@noatinwork-app/ui/styles/fonts';

declare global {
  interface Window {
    __NOATINWORK_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

window.__NOATINWORK_RUNTIME_APIS__ = createConfiguredWebAPIs();

void import('@noatinwork-app/ui/apps/renderMobileApp')
  .then(({ renderMobileApp }) => {
    renderMobileApp(window.__NOATINWORK_RUNTIME_APIS__ ?? createConfiguredWebAPIs());
  });
