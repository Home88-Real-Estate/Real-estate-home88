import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HOME88 CRM", template: "%s | HOME88 CRM" },
  // Belt and braces with the X-Robots-Tag header: an internal tool is never a
  // search result.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
