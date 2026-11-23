import type { BrowserWindowConstructorOptions } from 'electron';
import { hardenedWebPreferences } from './security';

export const signInSize = { width: 480, height: 720 };

export function signInWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: signInSize.width,
    height: signInSize.height,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    title: 'Sifer Motion',
    autoHideMenuBar: true,
    backgroundColor: '#020b0c',
    webPreferences: hardenedWebPreferences(preload),
  };
}
