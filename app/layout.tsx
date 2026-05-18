import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clip — AI Clipping Studio",
  description: "Turn long-form content into viral short clips with AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-surface-900 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
