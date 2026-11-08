import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { SwRegister } from "@/components/p2p/sw-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Walt P2P Терминал — децентрализованный мониторинг курсов",
  description:
    "Инструмент для работы с P2P API Walt: лучшие курсы, спред, матрица рынков, избранное, алерты, калькулятор сделки и P2P-сеть между браузерами через WebRTC. Работает офлайн.",
  keywords: ["P2P", "Walt", "P2P API", "курсы", "USDT", "мониторинг", "трейдинг", "WebRTC", "PWA"],
  manifest: "/manifest.webmanifest",
  applicationName: "Walt P2P Терминал",
  icons: {
    icon: [
      { url: "/icons/icon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "P2P Терминал",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#101613",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          themes={["light", "dark", "orange", "purple", "sky"]}
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-right" richColors closeButton />
          <SwRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
