import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Veyra Talent",
  description: "AI-powered applicant tracking and talent acquisition",
};

// Apply the saved theme before first paint, so there is no light-to-dark flash.
const themeScript = `(function(){try{var t=localStorage.getItem('veyra.theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
