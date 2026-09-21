import type { Metadata } from 'next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
export const metadata: Metadata = { title: 'Panel Club — Indian comedy, all in one place', description: 'Explore Indian comedy panels, roasts and game shows. Find your next episode.', icons: { icon: '/favicon.svg' } };
export default function Layout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body suppressHydrationWarning>{children}<SpeedInsights/><Analytics/></body></html>}
