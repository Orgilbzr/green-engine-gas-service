import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={
 title:"Грийн Энжин Газ сервис",
 description:"Автомашины газан систем суурилуулалтын салбар, цаг, төлбөрийн нэгдсэн бүртгэл.",
 openGraph:{title:"Грийн Энжин Газ сервис",description:"Салбар · Цаг · Урьдчилгаа · Тайлан",images:["/og.png"]},
 twitter:{card:"summary_large_image",title:"Грийн Энжин Газ сервис",description:"Салбар · Цаг · Урьдчилгаа · Тайлан",images:["/og.png"]}
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="mn"><body>{children}</body></html>}
