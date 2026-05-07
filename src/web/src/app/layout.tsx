import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PodCraft — Pick a topic, hit play",
  description: "An in-car podcast player. Type a topic, press Go, and an AI host and guest start an interview-style conversation immediately. Tap Ask to interrupt with a question.",
  themeColor: "#050510",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
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
        {children}
      </body>
    </html>
  );
}
