import type { Metadata } from "next";
import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource-variable/fraunces/wght-italic.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Docmivo — Find what matters", template: "%s · Docmivo" },
  description: "A private document library with indexed search and a direct path from every result to its source.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
