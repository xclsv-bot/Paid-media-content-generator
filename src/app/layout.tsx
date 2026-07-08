import type { Metadata } from "next";
import "./globals.css";
import AppNav from "@/components/AppNav";

export const metadata: Metadata = {
  title: {
    default: "XCLSV Studio",
    template: "%s · XCLSV Studio",
  },
  description:
    "XCLSV Media's creative engine — ideate, produce, and grade paid-social content on a weekly testing loop.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AppNav />
        {children}
      </body>
    </html>
  );
}
