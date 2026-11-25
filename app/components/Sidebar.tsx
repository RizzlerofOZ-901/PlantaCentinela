"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  clearSessionUser,
  getAllowedRoutes,
  getSessionUser,
  type SessionUser,
} from "@/app/lib/session";

const allLinks = [
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
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setUser(getSessionUser());
  }, [path]);

  const allowed = getAllowedRoutes(user);
  const visibleLinks = allLinks.filter(([, href]) => allowed.includes(href));

  function handleLogout() {
    clearSessionUser();
    router.push("/");
  }

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

        {user && (
          <div className="sidebar-user-badge">
            <strong>{user.nombre_completo}</strong>
            <span>
              {user.rol} · {user.departamento}
            </span>
          </div>
        )}

        <nav aria-label="Navegación principal">
          {visibleLinks.map(([name, href]) => (
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
        <button type="button" onClick={handleLogout} className="sidebar-logout">
          Cerrar Sesión
        </button>
      </div>
    </aside>
  );
}
