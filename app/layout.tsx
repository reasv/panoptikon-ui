import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Panoptikon",
  description: "What do you want to find today?",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
