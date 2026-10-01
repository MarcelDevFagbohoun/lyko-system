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
    default: "Lyko System : la gestion locative pensée pour le Bénin",
    template: "%s · Lyko System",
  },
  description:
    "Logiciel de gestion locative pour entreprises et agences immobilières au Bénin : loyers, charges SONEB/SBEE, relances WhatsApp, quittances, relevés propriétaires et comptabilité SYSCOHADA.",
  openGraph: {
    type: "website",
    locale: "fr_BJ",
    siteName: "Lyko System",
    title: "Lyko System : la gestion locative pensée pour le Bénin",
    description:
      "Encaissez à temps, rendez des comptes justes à vos propriétaires : loyers, charges SONEB/SBEE, quittances et comptabilité SYSCOHADA.",
  },
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
