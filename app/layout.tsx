import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

/** Display / heading font — geometric grotesk for Orbit's premium feel */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

/** Body / UI font — clean neutral sans */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/** Mono — code / vault keys */
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Orbit",
  description: "Your subscriptions, in orbit.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6fe" },
    { media: "(prefers-color-scheme: dark)", color: "#090b17" },
  ],
};

/**
 * Inline script that runs synchronously in <head> before first paint.
 * Reads localStorage and applies .dark to <html> to avoid FOUC.
 */
const noFlashScript = `
(function() {
  try {
    var stored = localStorage.getItem('orbit-theme') || 'system';
    var dark =
      stored === 'dark' ||
      (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch (e) {}
})();
`.trim();

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* No-flash theme script — must run before paint */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
