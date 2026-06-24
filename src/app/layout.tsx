import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XCLSV Creative Dashboard",
  description: "Content slate, video delivery, and Meta performance for Outlier.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
