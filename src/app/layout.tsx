import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { themeInitScript } from "@/components/theme/theme-init";
import "./globals.css";

const manrope = localFont({
  src: "./fonts/manrope/Manrope-Variable.woff2",
  variable: "--font-manrope",
  display: "swap",
});

const firaCode = localFont({
  src: [
    { path: "./fonts/fira-code/FiraCode-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/fira-code/FiraCode-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/fira-code/FiraCode-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/fira-code/FiraCode-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-fira-code",
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

const ethnocentric = localFont({
  src: [
    { path: "./fonts/ethnocentric/Ethnocentric-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/ethnocentric/Ethnocentric-Italic.ttf", weight: "700", style: "italic" },
  ],
  variable: "--font-ethnocentric",
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
      data-theme="dark"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${manrope.variable} ${nohemi.variable} ${firaCode.variable} ${ethnocentric.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}