"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Shipment = {
  id_envio: number;
  codigo_envio: string;
  nombre_cliente: string;
  direccion_destino: string;
  codigo_trailer: string | null;
  estatus_general: string;
  fecha_entrega_estimada: string | null;
  fecha_entrega_real: string | null;
};

type DetourAlert = {
  id_envio: number;
  codigo_envio: string;
  nombre_cliente: string;
  codigo_trailer: string | null;
  incident: string;
};

const TRAILERS = Array.from(
  { length: 10 },
  (_, i) => `TRL-${String(i + 1).padStart(3, "0")}`
);

const ACTIVE_STATUSES = new Set([
  "CREADO",
  "EN_ORIGEN",
  "EN_TRANSITO",
  "CARGANDO",
]);

function formatDate(v: unknown) {
  if (!v) return "—";
  const raw = String(v).slice(0, 10);
  const parts = raw.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : raw;
}

export default function InicioPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [alerts, setAlerts] = useState<DetourAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const res = await fetch("/api/operaciones/envios", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("No se pudieron cargar los envíos.");
        const data: Shipment[] = await res.json();
        const list = Array.isArray(data) ? data : [];

        if (cancelled) return;
        setShipments(list);

        // Fetch tracking details only for shipments currently EN_TRANSITO
        const inTransit = list.filter(
          (s) => String(s.estatus_general).toUpperCase() === "EN_TRANSITO"
        );

        const detourResults = await Promise.all(
          inTransit.map(async (s): Promise<DetourAlert | null> => {
            try {
              const tr = await fetch(`/api/tracking/${s.id_envio}`, {
                cache: "no-store",
              });
              if (!tr.ok) return null;
              const td = await tr.json();
              const session = td?.session;
              if (!session) return null;

              const hasIncident = Boolean(session.incident);
              const hasModifiedRoute =
                JSON.stringify(session.route) !==
                JSON.stringify(session.originalRoute);

              if (hasIncident || hasModifiedRoute) {
                return {
                  id_envio: s.id_envio,
                  codigo_envio: s.codigo_envio,
                  nombre_cliente: s.nombre_cliente,
                  codigo_trailer: s.codigo_trailer,
                  incident:
                    session.incident || "Desvío de ruta activo en tránsito",
                };
              }
              return null;
            } catch {
              return null;
            }
          })
        );

        if (!cancelled) {
          setAlerts(
            detourResults.filter((item): item is DetourAlert => item !== null)
          );
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Error cargando información."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  // 1. Trailers Disponibles count
  const availableTrailersCount = useMemo(() => {
    const occupied = new Set(
      shipments
        .filter(
          (r) =>
            !["ENTREGADO", "CANCELADO", "RECHAZADO"].includes(
              String(r.estatus_general).toUpperCase()
            )
        )
        .map((r) => String(r.codigo_trailer ?? ""))
        .filter(Boolean)
    );
    return TRAILERS.filter((t) => !occupied.has(t)).length;
  }, [shipments]);

  // 2. Pedidos Activos count (CREADO, EN_ORIGEN, EN_TRANSITO, CARGANDO)
  const activeOrdersCount = useMemo(() => {
    return shipments.filter((s) =>
      ACTIVE_STATUSES.has(String(s.estatus_general).toUpperCase())
    ).length;
  }, [shipments]);

  // 3. Last 3 Delivered Shipments (ENTREGADO)
  const recentDelivered = useMemo(() => {
    return shipments
      .filter((s) => String(s.estatus_general).toUpperCase() === "ENTREGADO")
      .slice(0, 3);
  }, [shipments]);

  return (
    <section>
      <header>
        <div>
          <p
            style={{
              margin: 0,
              fontWeight: 700,
              fontSize: "12px",
              color: "#052c56",
            }}
          >
            INICIO
          </p>
          <h1>¡BIENVENIDO!</h1>
        </div>
        <Link href="/envios">
          <button type="button">Ir a Envíos</button>
        </Link>
      </header>

      {error && <p className="message error">{error}</p>}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div>
            <div className="muted" style={{ fontWeight: 700 }}>
              Trailers Disponibles
            </div>
            <div className="kpi-value">
              {loading ? "—" : `${availableTrailersCount} / ${TRAILERS.length}`}
            </div>
          </div>
          <div className="kpi-badge-icon">TRL</div>
        </div>

        <div className="kpi-card">
          <div>
            <div className="muted" style={{ fontWeight: 700 }}>
              Pedidos Activos
            </div>
            <div className="kpi-value">{loading ? "—" : activeOrdersCount}</div>
            <div className="muted" style={{ fontSize: "11px" }}>
              Creado · En Origen · Cargando · En Tránsito
            </div>
          </div>
          <div className="kpi-badge-icon">ACT</div>
        </div>
      </div>

      {/* Pedidos Recientes (Last 3 Entregados) */}
      <div className="centinela-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px" }}>
            Pedidos Recientes (Últimos 3 Entregados)
          </h2>
          <Link href="/envios">
            <button type="button" style={{ padding: "6px 14px", fontSize: "13px" }}>
              Ver Todos
            </button>
          </Link>
        </div>

        <div className="panel responsive-table" style={{ marginBottom: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Cliente</th>
                <th>Trailer</th>
                <th>Fecha Entrega</th>
                <th>Estatus</th>
              </tr>
            </thead>
            <tbody>
              {recentDelivered.map((s) => (
                <tr key={s.id_envio}>
                  <td style={{ fontWeight: 700 }}>{s.codigo_envio}</td>
                  <td>{s.nombre_cliente}</td>
                  <td>{s.codigo_trailer || "—"}</td>
                  <td>
                    {formatDate(s.fecha_entrega_real || s.fecha_entrega_estimada)}
                  </td>
                  <td>
                    <span className="status-pill status-green">ENTREGADO</span>
                  </td>
                </tr>
              ))}
              {!loading && !recentDelivered.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    Aún no hay envíos entregados registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alertas y Notificaciones (Active Detours in Transit) */}
      <div className="centinela-card">
        <h2 style={{ margin: "0 0 12px", fontSize: "18px" }}>
          Alertas y Notificaciones (Desvíos en Tránsito)
        </h2>

        {alerts.length > 0 ? (
          <div style={{ display: "grid", gap: "10px" }}>
            {alerts.map((alert) => (
              <div
                key={alert.id_envio}
                className="panel"
                style={{
                  marginBottom: 0,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  borderLeft: "6px solid #d97706",
                }}
              >
                <div>
                  <strong style={{ color: "#052c56" }}>
                    Envío {alert.codigo_envio} — {alert.nombre_cliente}
                  </strong>{" "}
                  {alert.codigo_trailer && (
                    <span className="muted">({alert.codigo_trailer})</span>
                  )}
                  <div style={{ marginTop: "4px", fontSize: "14px" }}>
                    <span className="status-pill status-orange">DESVÍO ACTIVO</span>{" "}
                    <span>{alert.incident}</span>
                  </div>
                </div>

                <Link href="/tracking">
                  <button
                    type="button"
                    style={{ padding: "7px 14px", fontSize: "13px" }}
                  >
                    Ver Seguimiento
                  </button>
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel" style={{ marginBottom: 0 }}>
            <span className="muted">
              Sin desvíos activos en envíos en tránsito por el momento.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
