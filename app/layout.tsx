import type { Metadata } from "next";
import { Domine, Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const domine = Domine({
  subsets: ["latin"],
  variable: "--font-serif",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Daily Intelligence",
  description: "Your personal daily journaling and AI-powered reflection assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
      <meta name="google-site-verification" content="9B93rQYjxzvTPxuG7NK7QKObNkFV2uhhiC8K8A1fy1M" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${domine.variable} antialiased`}
      >
        
        {children}
      </body>
    </html>
  );
}
