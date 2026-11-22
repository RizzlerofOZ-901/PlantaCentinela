import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/app/components/Sidebar";
export const metadata:Metadata={title:"Planta Centinela",description:"Control de embarques"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body><div className="shell"><Sidebar/><main>{children}</main></div></body></html>;}


