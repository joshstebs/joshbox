import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata:Metadata={title:'JoshBox — Your private AI studio',description:'A personal workspace for original characters, images, and animation.',robots:{index:false,follow:false},manifest:'/manifest.webmanifest',icons:{icon:'/favicon.svg',apple:'/icon-192.png'}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#f6f5ef'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>;}
