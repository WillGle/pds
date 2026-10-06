import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Social Pulse Scraper — Facebook & TikTok Analytics",
  description: "High-speed serverless scraper for Facebook Reels and TikTok videos built for Vercel.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
