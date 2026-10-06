import type { Metadata } from "next";
import { Manrope, Fira_Code } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const nohemi = localFont({
  src: [
    { path: "./fonts/nohemi/Nohemi-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/nohemi/Nohemi-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/nohemi/Nohemi-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/nohemi/Nohemi-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-nohemi",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DRAG — Developer Repository Augmented Generation",
  description:
    "AI assistant for software repositories. Index, search, and chat with your codebase.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${nohemi.variable} ${firaCode.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}