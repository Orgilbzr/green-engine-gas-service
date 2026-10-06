import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import "./mobile.css";
import "./reports/reports.css";
import "./sidebar.css";
export const viewport: Viewport = {
 width: "device-width",
 initialScale: 1,
 viewportFit: "cover",
 themeColor: "#0d1b35",
};
export const metadata:Metadata={
 title:"Грийн Энжин Газ сервис",
 description:"Автомашины газан систем суурилуулалтын салбар, цаг, төлбөрийн нэгдсэн бүртгэл.",
 applicationName: "Грийн Энжин",
 appleWebApp: { capable: true, title: "Грийн Энжин", statusBarStyle: "black-translucent" },
 other: { "apple-mobile-web-app-capable": "yes" },
 icons: {
  icon: [
   { url: "/favicon.ico", sizes: "any" },
   { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
   { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
   { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
  ],
  shortcut: "/favicon.ico",
  apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
 },
 openGraph:{title:"Грийн Энжин Газ сервис",description:"Салбар · Цаг · Урьдчилгаа · Тайлан",images:["/og.png"]},
 twitter:{card:"summary_large_image",title:"Грийн Энжин Газ сервис",description:"Салбар · Цаг · Урьдчилгаа · Тайлан",images:["/og.png"]}
 ,metadataBase:new URL("https://gas.ecoauto.app")
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="mn"><body>{children}<SpeedInsights /></body></html>}
