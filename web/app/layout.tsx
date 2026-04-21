import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sentient HUD — Edge Memory Console",
  description:
    "Operator console for the Sentient-Cache edge memory controller. Real-time semantic galaxy, latency vitals, and write-behind telemetry.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
