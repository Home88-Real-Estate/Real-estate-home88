import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HOME88 CRM", template: "%s | HOME88 CRM" },
  // Belt and braces with the X-Robots-Tag header: an internal tool is never a
  // search result.
  robots: { index: false, follow: false, nocache: true },
  // Opened from the home screen it looks like an app; the manifest (app/manifest.ts) does the rest.
  appleWebApp: { capable: true, title: "HOME88", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#062b46" },
    { media: "(prefers-color-scheme: dark)", color: "#08131e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the boot script before hydration.
    <html lang="el" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
