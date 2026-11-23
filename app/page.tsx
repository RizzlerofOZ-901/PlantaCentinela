// import { redirect } from "next/navigation";
// export default function Home() { redirect("/envios"); }

import Link from "next/link";

export default function SignInPage() {
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
        <div className="login-box">
          <h1 className="login-title">Inicio de Sesión</h1>
          <span className="login-subtitle">
            Sistema Integral de Logística y Control de Embarques
          </span>

          <p style={{ color: "#bfd6ee", marginBottom: "28px", lineHeight: 1.5 }}>
            Bienvenido a la plataforma operativa de Planta Centinela. Presiona el
            botón para ingresar al panel principal.
          </p>

          <Link href="/inicio" className="btn-login-accent">
            Ingresar →
          </Link>
        </div>

        <div className="login-brand-panel">
          <h2>PLANTA CENTINELA</h2>
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
