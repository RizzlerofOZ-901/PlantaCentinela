"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setSessionUser } from "@/app/lib/session";

type DbUser = {
  id_usuario: number;
  nombre_completo: string;
  rol: "OPERADOR" | "SUPERVISOR" | "AUDITOR";
  departamento: string;
  activo: number | boolean;
};

export default function SignInPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const typed = name.trim();
    if (!typed) {
      setError("Ingresa tu nombre de usuario.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      // Master Administrator shortcut
      if (typed.toLowerCase() === "rizzlerofoz") {
        setSessionUser({
          id_usuario: 0,
          nombre_completo: "RizzlerofOz",
          rol: "ADMINISTRADOR",
          departamento: "ADMINISTRACION",
          isAdmin: true,
        });
        router.push("/inicio");
        return;
      }

      const res = await fetch("/api/operaciones/usuarios", { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo validar el usuario.");
      const users: DbUser[] = await res.json();

      const match = users.find(
        (u) => u.nombre_completo.trim().toLowerCase() === typed.toLowerCase()
      );

      if (!match) {
        setError(
          "Usuario no encontrado. Verifica que esté registrado en la tabla de usuarios."
        );
        return;
      }

      if (!(match.activo === true || Number(match.activo) === 1)) {
        setError("Este usuario está inactivo. Contacta al administrador.");
        return;
      }

      setSessionUser({
        id_usuario: match.id_usuario,
        nombre_completo: match.nombre_completo,
        rol: match.rol,
        departamento: match.departamento,
      });

      router.push("/inicio");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="login-wrapper">
      <svg
        className="login-wave"
        viewBox="0 0 1200 700"
        preserveAspectRatio="none"
      >
        <path
          d="M 655 0 C 610 95, 725 155, 680 240 C 630 330, 565 395, 595 500 C 625 600, 745 625, 820 700 L 1200 700 L 1200 0 Z"
          fill="#8ab8e6"
          stroke="#4da3ff"
          strokeWidth="2.5"
        />
      </svg>

      <div className="login-content">
        <form className="login-box" onSubmit={handleLogin}>
          <div className="login-header-row">
            <div className="login-emblem">
              <img
                src="/imagenes/icono.png"
                alt="Icono Planta Centinela"
                className="login-top-icon"
              />
            </div>
            <div>
              <h1 className="login-title">Inicio de Sesión</h1>
              <span className="login-subtitle" style={{ marginBottom: 0 }}>
                Sistema Integral de Logística y Control de Embarques
              </span>
            </div>
          </div>

          <label
            style={{
              display: "block",
              color: "#ffffff",
              fontWeight: 600,
              marginBottom: "8px",
            }}
          >
            Nombre de usuario
          </label>
          <input
            type="text"
            placeholder="Ej. RizzlerofOz"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            required
            style={{
              marginBottom: "16px",
              borderRadius: "999px",
              padding: "11px 16px",
            }}
          />

          {error && <p className="message error">{error}</p>}

          <button type="submit" className="btn-login-accent" disabled={loading}>
            {loading ? "Validando..." : "Ingresar →"}
          </button>
        </form>

        <div className="login-brand-panel">
          <img
            src="/imagenes/logo-login.png"
            alt="Planta Centinela"
            className="login-brand-right"
          />
          <p style={{ fontWeight: 600, margin: 0 }}>
            Monitoreo de Envíos, Rutas y Operaciones
          </p>
          <div className="login-pills">
            <span className="login-pill-badge">Rutas GPS</span>
            <span className="login-pill-badge">Control de Envíos</span>
            <span className="login-pill-badge">Inspección y Riesgos</span>
          </div>
        </div>
      </div>
    </section>
  );
}

