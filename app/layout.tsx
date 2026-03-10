import type { Metadata } from "next";
import { Domine, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { UserPreferencesProvider } from "@/contexts/user-preferences-context";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const domine = Domine({
  subsets: ["latin"],
  variable: "--font-serif",
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
      <body className={`${inter.variable} ${domine.variable} antialiased`}>
        <AuthProvider>
          <UserPreferencesProvider>
            <ThemeProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </ThemeProvider>
          </UserPreferencesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
