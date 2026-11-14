import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { APPLY_SETTINGS_SCRIPT } from "@/lib/settings";
import SettingsProvider from "./components/SettingsProvider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Bordvakt",
  description: "Realtidsassistent för restauranger",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Bordvakt", statusBarStyle: "default" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Tema och språk läggs på <html> innan sidan ritas (se APPLY_SETTINGS_SCRIPT)
    <html lang="sv" className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_SETTINGS_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
