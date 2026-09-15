import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { ServiceWorkerRegister } from "@/components/system/sw-register";
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
    default: "Lyko System : gestion d'entreprises immobilières & juridiques",
    template: "%s · Lyko System",
  },
  description:
    "Plateforme multi-tenant de gestion locative : locataires, propriétaires, contrats, paiements, réclamations, comptabilité et charges.",
  manifest: "/manifest.webmanifest",
  applicationName: "Lyko System",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Lyko System" },
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
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
