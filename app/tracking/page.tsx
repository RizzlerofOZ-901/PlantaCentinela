"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtDateTime, statusClass } from "@/app/lib/session";

const TrackingMap = dynamic(() => import("./TrackingMap"), { ssr: false });

type Shipment = {
  id_envio: number;
  codigo_envio: string;
  nombre_cliente: string;
  codigo_trailer: string | null;
  estatus_general: string;
  empresa_origen?: string;
  direccion_origen?: string;
  direccion_destino: string;
  fecha_despacho_programada: string | null;
  fecha_despacho_real: string | null;
  fecha_entrega_estimada: string | null;
  fecha_entrega_real: string | null;
};

type Checkpoint = {
  id_checkpoint: number;
  numero_checkpoint: number;
  distancia_acumulada_km: number | string;
  latitud: number | string;
  longitud: number | string;
  ubicacion: string | null;
  estatus: "PENDIENTE" | "ALCANZADO" | "BLOQUEADO" | "OMITIDO" | string;
  fecha_registro: string | null;
  observaciones: string | null;
};

type TrackingData = {
  shipment: Shipment;
  session: {
    route: [number, number][];
    originalRoute: [number, number][];
    distanceKm: number;
    progressKm: number;
    durationMinutes: number;
    state: string;
    currentPosition: [number, number];
    incident: string | null;
  };
  checkpoints: Checkpoint[];
};

type MapCheckpoint = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  status: string;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deliveryResult(shipment: Shipment): string {
  const scheduled = parseDate(shipment.fecha_entrega_estimada);
  const actual = parseDate(shipment.fecha_entrega_real);

  if (shipment.estatus_general !== "ENTREGADO") {
    if (scheduled && Date.now() > scheduled.getTime()) {
      return "Retrasado — entrega aún no registrada";
    }
    return "En tránsito — aún no se puede confirmar";
  }

  if (!scheduled || !actual) {
    return "Faltan fecha programada o fecha real";
  }

  return actual.getTime() <= scheduled.getTime()
    ? "Entregado a tiempo"
    : "Entregado con retraso";
}

function formatKm(value: number | string | null | undefined): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)} km` : "—";
}

export default function TrackingPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [message, setMessage] = useState("");
  const [loadingShipments, setLoadingShipments] = useState(false);
  const [loadingTracking, setLoadingTracking] = useState(false);
  const [incidentLoading, setIncidentLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const loadShipments = useCallback(async () => {
    setLoadingShipments(true);
    try {
      const response = await fetch("/api/operaciones/envios", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "No se pudieron cargar los envíos.");
      }

      const list: Shipment[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : [];

      const filtered = list.filter((shipment) =>
        ["EN_TRANSITO", "ENTREGADO", "RETRASADO"].includes(
          String(shipment.estatus_general).toUpperCase()
        )
      );

      setShipments(filtered);

      if (
        selectedId !== null &&
        !filtered.some((shipment) => shipment.id_envio === selectedId)
      ) {
        setSelectedId(null);
        setTracking(null);
      }
    } finally {
      setLoadingShipments(false);
    }
  }, [selectedId]);

  const loadTracking = useCallback(async (id: number) => {
    setLoadingTracking(true);
    try {
      const response = await fetch(`/api/tracking/${id}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data?.error ||
            "No hay una sesión de tracking inicializada para este envío."
        );
      }
      setTracking(data as TrackingData);
      setMessage("");
    } finally {
      setLoadingTracking(false);
    }
  }, []);

  useEffect(() => {
    loadShipments().catch((error) => {
      setMessage(
        error instanceof Error ? error.message : "Error al cargar envíos."
      );
    });
  }, [loadShipments]);

  useEffect(() => {
    if (selectedId === null) {
      setTracking(null);
      return;
    }

    setTracking(null);
    loadTracking(selectedId).catch((error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo cargar el tracking."
      );
    });
  }, [selectedId, loadTracking]);

  useEffect(() => {
    if (selectedId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  const filteredShipments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shipments.filter((s) => {
      const st = String(s.estatus_general).toUpperCase();
      if (statusFilter !== "ALL" && st !== statusFilter) return false;
      if (!q) return true;
      return (
        s.codigo_envio.toLowerCase().includes(q) ||
        s.nombre_cliente.toLowerCase().includes(q) ||
        String(s.codigo_trailer ?? "").toLowerCase().includes(q)
      );
    });
  }, [shipments, search, statusFilter]);

  const selected = useMemo(
    () =>
      shipments.find((shipment) => shipment.id_envio === selectedId) ?? null,
    [shipments, selectedId]
  );

  const mapCheckpoints: MapCheckpoint[] = useMemo(() => {
    return (tracking?.checkpoints ?? []).map((checkpoint) => ({
      id: String(checkpoint.id_checkpoint),
      label:
        checkpoint.ubicacion ||
        `Checkpoint ${checkpoint.numero_checkpoint} · ${formatKm(
          checkpoint.distancia_acumulada_km
        )}`,
      lat: Number(checkpoint.latitud),
      lng: Number(checkpoint.longitud),
      status: checkpoint.estatus,
    }));
  }, [tracking?.checkpoints]);

  useEffect(() => {
    if (
      selectedId === null ||
      !tracking ||
      tracking.session.state !== "ACTIVO" ||
      tracking.shipment.estatus_general !== "EN_TRANSITO"
    ) {
      return;
    }

    const shipmentId = selectedId;

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/tracking/${shipmentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "advance" }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result?.error || "No se pudo avanzar el tracking.");
        }

        if (result?.advanced || result?.delivered || result?.finished) {
          await loadTracking(shipmentId);
          await loadShipments();
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Error al actualizar el tracking."
        );
      }
    }, 4000);

    return () => window.clearInterval(timer);
  }, [
    selectedId,
    tracking?.session.state,
    tracking?.shipment.estatus_general,
    loadTracking,
    loadShipments,
  ]);

  async function simulateBlock(checkpoint: Checkpoint) {
    if (selectedId === null) return;

    const incident = window.prompt(
      "Describe el incidente simulado:",
      "Carretera bloqueada"
    );

    if (!incident?.trim()) return;

    setIncidentLoading(true);
    setMessage("");

    try {
      const response = await fetch(`/api/tracking/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "block",
          checkpointId: checkpoint.id_checkpoint,
          incident: incident.trim(),
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || "No se pudo recalcular la ruta.");
      }

      await loadTracking(selectedId);
      setMessage("Ruta recalculada para el incidente simulado.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Error al simular el bloqueo."
      );
    } finally {
      setIncidentLoading(false);
    }
  }

  return (
    <section>
      <header>
        <div>
          <h1>Seguimiento de envíos</h1>
          <p className="muted">
            Consulta envíos en tránsito y entregados. Selecciona un envío para
            abrir su timeline y mapa.
          </p>
        </div>

        <button
          type="button"
          className="secondary"
          disabled={loadingShipments}
          onClick={() => {
            setMessage("");
            loadShipments().catch((error) =>
              setMessage(
                error instanceof Error
                  ? error.message
                  : "No se pudieron actualizar los envíos."
              )
            );

            if (selectedId !== null) {
              loadTracking(selectedId).catch((error) =>
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "No se pudo actualizar el tracking."
                )
              );
            }
          }}
        >
          {loadingShipments ? "Actualizando..." : "Actualizar"}
        </button>
      </header>

      {message && <p className="message">{message}</p>}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Buscar por envío, cliente o trailer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">Todos los estatus</option>
          <option value="EN_TRANSITO">EN TRÁNSITO</option>
          <option value="ENTREGADO">ENTREGADO</option>
          <option value="RETRASADO">RETRASADO</option>
        </select>
      </div>

      <div className="panel responsive-table">
        <table>
          <thead>
            <tr>
              <th>Envío</th>
              <th>Cliente</th>
              <th>Trailer</th>
              <th>Estado</th>
              <th>Despacho programado</th>
              <th>Entrega estimada</th>
            </tr>
          </thead>

          <tbody>
            {filteredShipments.map((shipment) => (
              <tr
                key={shipment.id_envio}
                onClick={() => setSelectedId(shipment.id_envio)}
                className={
                  selectedId === shipment.id_envio ? "selected-row" : ""
                }
                style={{ cursor: "pointer" }}
                aria-selected={selectedId === shipment.id_envio}
              >
                <td>
                  <button
                    type="button"
                    className="table-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(shipment.id_envio);
                    }}
                  >
                    {shipment.codigo_envio}
                  </button>
                </td>
                <td>{shipment.nombre_cliente}</td>
                <td>{shipment.codigo_trailer || "Sin asignar"}</td>
                <td>
                  <span className={statusClass(shipment.estatus_general)}>
                    {String(shipment.estatus_general).replaceAll("_", " ")}
                  </span>
                </td>
                <td>{fmtDateTime(shipment.fecha_despacho_programada)}</td>
                <td>{fmtDateTime(shipment.fecha_entrega_estimada)}</td>
              </tr>
            ))}

            {!loadingShipments && filteredShipments.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No hay envíos con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL OVERLAY IN FRONT OF THE TABLE (Checkpoints + Map) */}
      {selectedId !== null && selected && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="centinela-card detail-panel modal-dialog modal-dialog-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-heading" style={{ marginBottom: "14px" }}>
              <div>
                <h2 style={{ margin: "0 0 2px" }}>
                  Seguimiento — {selected.codigo_envio}
                </h2>
                <p className="muted" style={{ margin: 0 }}>
                  {selected.nombre_cliente} ·{" "}
                  {selected.codigo_trailer || "Sin trailer"}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span className={statusClass(selected.estatus_general)}>
                  {selected.estatus_general.replaceAll("_", " ")}
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelectedId(null)}
                >
                  Cerrar
                </button>
              </div>
            </div>

            {loadingTracking && !tracking ? (
              <div className="panel" style={{ marginBottom: 0 }}>
                <p className="muted" style={{ margin: 0 }}>
                  Cargando información del envío...
                </p>
              </div>
            ) : tracking ? (
              <div className="tracking-layout">
                <aside className="panel tracking-timeline" style={{ marginBottom: 0 }}>
                  <div className="tracking-times">
                    <div className="tracking-time-item">
                      <span className="tracking-time-label">
                        Despacho programado:
                      </span>
                      <span className="tracking-time-value">
                        {fmtDateTime(tracking.shipment.fecha_despacho_programada)}
                      </span>
                    </div>

                    <div className="tracking-time-item">
                      <span className="tracking-time-label">Despacho real:</span>
                      <span className="tracking-time-value">
                        {fmtDateTime(tracking.shipment.fecha_despacho_real)}
                      </span>
                    </div>

                    <div className="tracking-time-item">
                      <span className="tracking-time-label">
                        Entrega programada:
                      </span>
                      <span className="tracking-time-value">
                        {fmtDateTime(tracking.shipment.fecha_entrega_estimada)}
                      </span>
                    </div>

                    <div className="tracking-time-item">
                      <span className="tracking-time-label">Entrega real:</span>
                      <span className="tracking-time-value">
                        {fmtDateTime(tracking.shipment.fecha_entrega_real)}
                      </span>
                    </div>
                  </div>

                  <div className="tracking-summary">
                    <p>
                      <strong>Estatus de entrega:</strong>{" "}
                      {deliveryResult(tracking.shipment)}
                    </p>
                    <p>
                      <strong>Progreso simulado:</strong>{" "}
                      {formatKm(tracking.session.progressKm)} /{" "}
                      {formatKm(tracking.session.distanceKm)}
                    </p>
                    <p>
                      <strong>Duración de la ruta:</strong>{" "}
                      {Math.round(tracking.session.durationMinutes)} min
                    </p>
                    {tracking.session.incident && (
                      <p>
                        <strong>Incidente actual:</strong>{" "}
                        {tracking.session.incident}
                      </p>
                    )}
                    <p className="muted tracking-summary-note">
                      La posición es una simulación persistida, no una lectura
                      GPS del vehículo.
                    </p>
                  </div>

                  <h3 className="tracking-checkpoints-title">
                    Checkpoints de ruta
                  </h3>

                  {tracking.checkpoints.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      No hay checkpoints pendientes o registrados para este
                      envío.
                    </p>
                  ) : (
                    <ol className="checkpoint-list">
                      {tracking.checkpoints.map((checkpoint) => (
                        <li
                          key={checkpoint.id_checkpoint}
                          className={
                            checkpoint.estatus === "ALCANZADO"
                              ? "checkpoint-current"
                              : ""
                          }
                        >
                          <div className="checkpoint-dot" />
                          <div>
                            <strong>
                              {checkpoint.numero_checkpoint}.{" "}
                              {checkpoint.ubicacion ||
                                `Checkpoint ${checkpoint.numero_checkpoint}`}
                            </strong>
                            <div className="muted">
                              {formatKm(checkpoint.distancia_acumulada_km)} ·{" "}
                              {checkpoint.estatus}
                            </div>
                            {checkpoint.fecha_registro && (
                              <div className="muted">
                                {fmtDateTime(checkpoint.fecha_registro)}
                              </div>
                            )}
                            {checkpoint.observaciones && (
                              <div className="muted">
                                {checkpoint.observaciones}
                              </div>
                            )}

                            {checkpoint.estatus === "PENDIENTE" &&
                              tracking.shipment.estatus_general ===
                                "EN_TRANSITO" && (
                                <button
                                  type="button"
                                  className="secondary"
                                  style={{
                                    marginTop: "6px",
                                    padding: "6px 12px",
                                    fontSize: "12px",
                                  }}
                                  disabled={incidentLoading}
                                  onClick={() => simulateBlock(checkpoint)}
                                >
                                  {incidentLoading
                                    ? "Recalculando..."
                                    : "Simular incidente aquí"}
                                </button>
                              )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </aside>

                <div className="panel tracking-map-panel" style={{ marginBottom: 0 }}>
                  <div className="detail-heading">
                    <div>
                      <h2 style={{ margin: "0 0 2px" }}>Mapa de ruta</h2>
                      <p className="muted" style={{ margin: "0 0 12px" }}>
                        Ruta vial calculada y posición simulada del camión.
                      </p>
                    </div>
                  </div>

                  {tracking.session.route.length > 1 ? (
                    <TrackingMap
                      route={tracking.session.route}
                      originalRoute={tracking.session.originalRoute}
                      currentPosition={tracking.session.currentPosition}
                      checkpoints={mapCheckpoints}
                    />
                  ) : (
                    <p className="muted">
                      La sesión no contiene una geometría de ruta válida.
                    </p>
                  )}

                  <p
                    className="muted"
                    style={{ marginBottom: 0, marginTop: "10px" }}
                  >
                    © OpenStreetMap contributors. Los incidentes son simulados;
                    no se consultan cierres ni tráfico en vivo.
                  </p>
                </div>
              </div>
            ) : (
              <div className="panel" style={{ marginBottom: 0 }}>
                <p className="muted" style={{ margin: 0 }}>
                  {message || "No se pudo cargar la sesión de tracking."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
