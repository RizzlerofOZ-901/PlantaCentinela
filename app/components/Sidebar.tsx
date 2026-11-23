"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Inicio", "/inicio"],
  ["Envíos", "/envios"],
  ["Documentos", "/documentos"],
  ["Riesgo de rutas", "/riesgo-rutas"],
  ["Inspección de mercancía", "/inspeccion"],
  ["Aprobaciones", "/aprobaciones"],
  ["Usuarios", "/usuarios"],
  ["Seguimiento", "/tracking"],
  ["Auditoría", "/auditoria"],
];

export default function Sidebar() {
  const path = usePathname();

  return (
    <aside className="sidebar">
      <div>
        <div className="sidebar-logo-wrap">
          <img
            src="/imagenes/logo-sidebar.png"
            alt="Planta Centinela"
            className="sidebar-logo"
          />
        </div>
        <nav aria-label="Navegación principal">
          {links.map(([name, href]) => (
            <Link
              key={href}
              href={href}
              className={path.startsWith(href) ? "active" : ""}
            >
              {name}
            </Link>
          ))}
        </nav>
      </div>

      <div className="sidebar-footer">
        <Link href="/" className="sidebar-logout">
          Cerrar Sesión
        </Link>
      </div>
    </aside>
  );
}
