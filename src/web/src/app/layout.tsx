import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "./components/NavBar";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import ToastProvider from "./components/ToastProvider";
import ThemeProvider from "./components/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PodCraft — AI Podcast Generator",
  description: "Turn any topic into an engaging interview-style podcast episode with AI-generated scripts and natural speech synthesis.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('podcraft-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()` }} />
        <script dangerouslySetInnerHTML={{ __html: `
          // Remove Next.js route announcer custom element to prevent aria-live conflicts
          (function() {
            function fix() {
              var els = document.getElementsByTagName('next-route-announcer');
              for (var i = els.length - 1; i >= 0; i--) els[i].remove();
            }
            setInterval(fix, 100);
            if (typeof MutationObserver !== 'undefined') {
              new MutationObserver(fix).observe(document.documentElement, { childList: true, subtree: true });
            }
          })();
        `}} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <NavBar />
          <KeyboardShortcuts />
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
