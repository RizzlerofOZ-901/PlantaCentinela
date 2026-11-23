"use client";

import { useEffect, useState } from "react";

type Shipment = {
  id_envio: number;
  codigo_envio: string;
  nombre_cliente: string;
  codigo_trailer: string | null;
  estatus_general: string;
  creador_nombre?: string | null;
  fecha_despacho_programada: string | null;
  fecha_entrega_estimada: string | null;
};

type AuditEvent = {
  _id: string;
  modulo: string;
  accion: string;
  id_envio?: number | null;
  codigo_envio?: string | null;
  actor?: string | null;
  estatus?: string | null;
  actualizacion: string;
  fecha_evento: string;
  detalles?: Record<string, any>;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusClass(value: unknown): string {
  const s = String(value ?? "").toUpperCase().replaceAll(" ", "_");
  if (["ENTREGADO", "LISTO", "APROBADO", "EXCELENTE", "BUENO", "ALCANZADO", "ACTIVO"].includes(s)) {
    return "status-pill status-green";
  }
  if (["EN_TRANSITO", "CARGANDO", "EN_ORIGEN", "EN_PROGRESO", "PENDIENTE", "ACEPTABLE", "CREADO"].includes(s)) {
    return "status-pill status-yellow";
  }
  if (["RECHAZADO", "CANCELADO", "RETRASADO", "MALO", "RETRABAJO", "ELIMINADO"].includes(s)) {
    return "status-pill status-red";
  }
  if (["DESVIO"].includes(s)) {
    return "status-pill status-orange";
  }
  return "status-pill status-neutral";
}

const AUDIT_SECTIONS: { key: string; title: string }[] = [
  { key: "DOCUMENTOS", title: "Documentos" },
  { key: "INSPECCION_CARGA", title: "Inspección de mercancía" },
  { key: "RIESGO_RUTA", title: "Riesgo de rutas" },
  { key: "APROBACIONES", title: "Aprobaciones" },
  { key: "TRACKING", title: "Tracking" },
];

export default function AuditoriaPage() {
  const [tab, setTab] = useState<"envios" | "usuarios">("envios");
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [userEvents, setUserEvents] = useState<AuditEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/operaciones/envios", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setShipments(Array.isArray(d) ? d : []))
      .catch(() => setMsg("No se pudieron cargar los envíos."));
  }, []);

  useEffect(() => {
    if (tab !== "usuarios") return;
    fetch("/api/auditoria?modulo=USUARIOS", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setUserEvents(Array.isArray(d) ? d : []))
      .catch(() => setMsg("No se pudo cargar la auditoría de usuarios."));
  }, [tab]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  async function openAudit(s: Shipment) {
    setSelected(s);
    setEvents([]);
    setLoadingEvents(true);
    setMsg("");
    try {
      const res = await fetch(`/api/auditoria?id_envio=${s.id_envio}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error consultando auditoría.");
      setEvents(Array.isArray(data) ? data : []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error cargando auditoría.");
    } finally {
      setLoadingEvents(false);
    }
  }

  return (
    <section>
      <header>
        <div>
          <h1>Auditoría</h1>
          <p className="muted">
            Historial de eventos registrado en MongoDB por envío y por usuario.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            className={tab === "envios" ? "" : "secondary"}
            onClick={() => setTab("envios")}
          >
            Auditoría de Envíos
          </button>
          <button
            type="button"
            className={tab === "usuarios" ? "" : "secondary"}
            onClick={() => setTab("usuarios")}
          >
            Auditoría de Usuarios
          </button>
        </div>
      </header>

      {msg && <p className="message error">{msg}</p>}

      {tab === "envios" ? (
        <div className="panel responsive-table">
          <table>
            <thead>
              <tr>
                <th>Envío</th>
                <th>Cliente</th>
                <th>Trailer</th>
                <th>Estado General</th>
                <th>Creador</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr
                  key={s.id_envio}
                  onClick={() => openAudit(s)}
                  className={selected?.id_envio === s.id_envio ? "selected-row" : ""}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <button
                      type="button"
                      className="table-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAudit(s);
                      }}
                    >
                      {s.codigo_envio}
                    </button>
                  </td>
                  <td>{s.nombre_cliente}</td>
                  <td>{s.codigo_trailer || "Sin asignar"}</td>
                  <td>
                    <span className={statusClass(s.estatus_general)}>
                      {String(s.estatus_general).replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>{s.creador_nombre || "—"}</td>
                </tr>
              ))}
              {!shipments.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    Todavía no hay envíos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel responsive-table">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Departamento</th>
                <th>Activo</th>
                <th>Acción</th>
                <th>Fecha y hora</th>
              </tr>
            </thead>
            <tbody>
              {userEvents.map((ev) => (
                <tr key={ev._id}>
                  <td>{ev.detalles?.id_usuario ?? "—"}</td>
                  <td>{ev.detalles?.nombre_completo ?? "—"}</td>
                  <td>{ev.detalles?.correo ?? "—"}</td>
                  <td>{ev.detalles?.rol ?? "—"}</td>
                  <td>{ev.detalles?.departamento ?? "—"}</td>
                  <td>{ev.detalles?.activo ?? "—"}</td>
                  <td>
                    <span className={statusClass(ev.estatus)}>
                      {ev.accion.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>{fmtDateTime(ev.fecha_evento)}</td>
                </tr>
              ))}
              {!userEvents.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    Sin eventos de usuarios registrados en MongoDB todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL OVERLAY IN FRONT OF THE TABLE */}
      {selected && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
        >
          <div
            className="centinela-card detail-panel modal-dialog"
            style={{ maxWidth: "760px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-heading">
              <h2>Auditoría — {selected.codigo_envio}</h2>
              <button
                type="button"
                className="secondary"
                onClick={() => setSelected(null)}
              >
                Cerrar
              </button>
            </div>

            {/* 2-COLUMN SUMMARY HEADER */}
            <div className="audit-meta-grid">
              <div>
                <strong>Envío:</strong> {selected.codigo_envio}
              </div>
              <div>
                <strong>Estado general:</strong>{" "}
                <span className={statusClass(selected.estatus_general)}>
                  {String(selected.estatus_general).replaceAll("_", " ")}
                </span>
              </div>
              <div>
                <strong>Cliente:</strong> {selected.nombre_cliente}
              </div>
              <div>
                <strong>Despacho programado:</strong>{" "}
                {fmtDateTime(selected.fecha_despacho_programada)}
              </div>
              <div>
                <strong>Trailer:</strong> {selected.codigo_trailer || "Sin asignar"}
              </div>
              <div>
                <strong>Entrega programada:</strong>{" "}
                {fmtDateTime(selected.fecha_entrega_estimada)}
              </div>
              <div>
                <strong>Creador:</strong> {selected.creador_nombre || "—"}
              </div>
            </div>

            {/* 1-COLUMN AUDIT TIMELINE BY MODULE */}
            {loadingEvents ? (
              <p className="muted">Cargando historial desde MongoDB...</p>
            ) : (
              <div className="audit-sections">
                {AUDIT_SECTIONS.map((sec) => {
                  const list = events.filter((ev) => ev.modulo === sec.key);
                  return (
                    <div key={sec.key} className="audit-section-box">
                      <h3>{sec.title}</h3>
                      {list.length === 0 ? (
                        <p className="muted" style={{ margin: 0 }}>
                          Sin registros todavía.
                        </p>
                      ) : (
                        <div className="audit-entries">
                          {list.map((ev) => (
                            <div key={ev._id} className="audit-entry">
                              <div className="audit-entry-top">
                                <span>
                                  <strong>Fecha y hora:</strong>{" "}
                                  {fmtDateTime(ev.fecha_evento)}
                                </span>
                                {ev.estatus && (
                                  <span className={statusClass(ev.estatus)}>
                                    {ev.estatus}
                                  </span>
                                )}
                              </div>
                              {ev.actor && (
                                <div>
                                  <strong>Responsable:</strong> {ev.actor}
                                </div>
                              )}
                              <div>
                                <strong>Actualización:</strong> {ev.actualizacion}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}