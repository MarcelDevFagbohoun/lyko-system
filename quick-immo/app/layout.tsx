import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ToastProvider } from "@/lib/toast/toast-context";
import { ToastStack } from "@/components/ui/toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Quick Immo : trouvez, louez ou vendez votre bien",
    template: "%s · Quick Immo",
  },
  description: "La plateforme qui met en relation propriétaires et agences immobilières partenaires pour louer ou vendre un bien.",
};

export const viewport: Viewport = {
  themeColor: "#1E3A8A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${inter.variable} ${GeistSans.variable}`}>
      <body>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
          <ToastStack />
        </ToastProvider>
      </body>
    </html>
  );
}
