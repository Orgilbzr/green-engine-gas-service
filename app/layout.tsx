import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
export const metadata:Metadata={
 title:"Грийн Энжин Газ сервис",
 description:"Автомашины газан систем суурилуулалтын салбар, цаг, төлбөрийн нэгдсэн бүртгэл.",
 openGraph:{title:"Грийн Энжин Газ сервис",description:"Салбар · Цаг · Урьдчилгаа · Тайлан",images:["/og.png"]},
 twitter:{card:"summary_large_image",title:"Грийн Энжин Газ сервис",description:"Салбар · Цаг · Урьдчилгаа · Тайлан",images:["/og.png"]}
 ,metadataBase:new URL("https://gas.ecoauto.app")
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="mn"><body>{children}<SpeedInsights /></body></html>}
