import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NeedleDrop',
  description: 'A tactile virtual vinyl collection powered by Navidrome.',
  applicationName: 'NeedleDrop',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'NeedleDrop' },
};
export const viewport: Viewport = { themeColor: '#11100d', colorScheme: 'dark' };

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}<script dangerouslySetInnerHTML={{__html:`if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}`}} /></body></html>;
}
