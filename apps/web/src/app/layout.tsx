import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Patchwork',
  description: 'API changes, tracked, assessed, and patched.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-x-hidden antialiased`}
    >
      {/* `clip`, not `hidden`, on body: `hidden` makes body a scroll container
          that never scrolls (the viewport does), which silently disables every
          `position: sticky` descendant -- the app rail and the landing header.
          `clip` still clips wide content without creating a scroll container.
          `<html>` keeps `hidden`, which propagates to the viewport and is what
          blocks horizontal panning (DESIGN.md Section 30). */}
      <body className="flex min-h-full flex-col overflow-x-clip bg-canvas text-fg">{children}</body>
    </html>
  );
}
