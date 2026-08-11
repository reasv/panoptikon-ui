import type { Metadata } from "next";
import { Inter as FontSans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils"
import Providers from "@/lib/providers"
import { Toaster } from "@/components/ui/toaster"

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-inter",
})
export const metadata: Metadata = {
  title: "Panoptikon",
  description: "What do you want to find today?",
  // public/ ships these, but nothing referenced them, so the browser was left
  // to guess /favicon.ico on its own. Behind an authenticating reverse proxy
  // that guess gets answered with a redirect to the login page, and browsers
  // cache the resulting "this origin has no icon" verdict per origin.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased dark overflow-hidden",
          fontSans.variable
        )}
      >
        <Providers>
          {children}
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
