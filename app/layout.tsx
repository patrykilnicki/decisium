import type { Metadata } from "next";
import { Domine, Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { UserPreferencesProvider } from "@/contexts/user-preferences-context";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  title: "Decisium",
  description: "Your personal AI-powered reflection assistant",
  verification: {
    google: "9B93rQYjxzvTPxuG7NK7QKObNkFV2uhhiC8K8A1fy1M",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${domine.variable} antialiased`}
      >
        <ThemeProvider>
          <UserPreferencesProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </UserPreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
