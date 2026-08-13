import type { DesktopBootOutcome } from '@/lib/desktopBoot';

declare global {
  interface Window {
    __NOATINWORK_HOME__?: string;
    __NOATINWORK_MACOS_MAJOR__?: number;
    __NOATINWORK_LOCAL_ORIGIN__?: string;
    __NOATINWORK_ELECTRON__?: { runtime?: string; arch?: string; trayEnabled?: boolean };
    __NOATINWORK_PLATFORM__?: string;
    __NOATINWORK_DESKTOP_BOOT_OUTCOME__?: DesktopBootOutcome;
  }

  interface WebviewElement extends HTMLElement {
    loadURL(url: string): void;
    goBack(): void;
    goForward(): void;
    reload(): void;
    getURL(): string;
    getTitle(): string;
    isLoading(): boolean;
    getWebContentsId(): number;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<WebviewElement> & {
          src?: string;
          partition?: string;
          preload?: string;
          nodeintegration?: string;
          allowpopups?: string;
          ref?: React.Ref<WebviewElement>;
        },
        WebviewElement
      >;
    }
  }
}

export {};
