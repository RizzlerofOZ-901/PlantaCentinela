"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const links = [["Envíos","/envios"],["Documentos","/documentos"],["Riesgo de rutas","/riesgo-rutas"],["Inspección de mercancía","/inspeccion"],["Aprobaciones","/aprobaciones"],["Usuarios","/usuarios"],["Tracking (pendiente)","/tracking"]];
export default function Sidebar(){ const path=usePathname(); return <aside className="sidebar"><h2>Planta Centinela</h2><nav aria-label="Navegación principal">{links.map(([name,href])=><Link key={href} href={href} className={path.startsWith(href)?"active":""}>{name}</Link>)}</nav></aside>; }

