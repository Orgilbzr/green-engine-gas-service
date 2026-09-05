import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import "./mobile.css";
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
 icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
 openGraph:{title:"Грийн Энжин Газ сервис",description:"Салбар · Цаг · Урьдчилгаа · Тайлан",images:["/og.png"]},
 twitter:{card:"summary_large_image",title:"Грийн Энжин Газ сервис",description:"Салбар · Цаг · Урьдчилгаа · Тайлан",images:["/og.png"]}
 ,metadataBase:new URL("https://gas.ecoauto.app")
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="mn"><body>{children}<SpeedInsights /></body></html>}
