import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import ArtworkRefresh from '@/components/ArtworkRefresh';
import './globals.css';
import './discogs.css';
import './v4-1.css';
import './v4-2.css';
import './v4-3.css';
import './v4-4.css';
import './v4-5.css';
import './v5.css';
import './v6.css';
import './v7.css';
import './v7-2.css';

export const metadata: Metadata = {
  title: { default: 'NeedleDrop', template: '%s · NeedleDrop' },
  description: 'A tactile virtual vinyl collection and animated turntable powered by Navidrome.',
  applicationName: 'NeedleDrop',
  icons: {
    icon: [
      { url: '/needledrop-icon.png', type: 'image/png', sizes: '256x256' },
      { url: '/needledrop-icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/needledrop-icon.png', type: 'image/png', sizes: '256x256' }],
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'NeedleDrop' },
};

export const viewport: Viewport = { themeColor: '#11100d', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}<ArtworkRefresh /><Script id="needledrop-service-worker" strategy="afterInteractive">{`if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}`}</Script></body></html>;
}
