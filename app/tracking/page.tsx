"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { MapPoint } from "./TrackingMap";

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

type RouteOption = {
  coordinates: [number, number][];
  distanceKm?: number;
  durationMinutes?: number;
  label: string;
};

type Checkpoint = MapPoint & {
  occurredAt: Date;
  observation: string;
  isCurrent?: boolean;
};

// Demo corridor only: approximate city/state coordinates from Nuevo Laredo to Monterrey.
// Replace this demo path after geocoding each shipment's actual origin and destination.
// Coordinates are city-level approximations, not truck GPS positions.
const DEMO_CHECKPOINTS: MapPoint[] = [
  { id: "cp-01", label: "Nuevo Laredo, Tamaulipas", lat: 27.476, lng: -99.516 },
  { id: "cp-02", label: "Anáhuac, Nuevo León", lat: 27.245, lng: -100.132 },
  { id: "cp-03", label: "Lampazos de Naranjo, Nuevo León", lat: 27.025, lng: -100.510 },
  { id: "cp-04", label: "Bustamante, Nuevo León", lat: 26.533, lng: -100.507 },
  { id: "cp-05", label: "Sabinas Hidalgo, Nuevo León", lat: 26.505, lng: -100.181 },
  { id: "cp-06", label: "Vallecillo, Nuevo León", lat: 26.660, lng: -99.986 },
  { id: "cp-07", label: "Ciénega de Flores, Nuevo León", lat: 25.957, lng: -100.167 },
  { id: "cp-08", label: "Salinas Victoria, Nuevo León", lat: 25.963, lng: -100.293 },
  { id: "cp-09", label: "General Escobedo, Nuevo León", lat: 25.795, lng: -100.315 },
  { id: "cp-10", label: "Monterrey, Nuevo León", lat: 25.6866, lng: -100.3161 },
];

// A second illustrative line for the button "Simular ruta alterna".
// It is not a traffic-aware route and must be replaced by an API alternative.
const DEMO_ALTERNATE: [number, number][] = [
  [27.476, -99.516],
  [27.18, -99.86],
  [26.90, -100.25],
  [26.65, -100.52],
  [26.32, -100.44],
  [26.08, -100.31],
  [25.90, -100.35],
  [25.79, -100.315],
  [25.6866, -100.3161],
];

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const result = new Date(normalized);
  return Number.isNaN(result.getTime()) ? null : result;
}

function fmt(value: string | Date | null | undefined) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusClass(value: unknown) {
  const s = String(value ?? "").toUpperCase().replaceAll(" ", "_");
  if (["ENTREGADO", "LISTO", "APROBADO", "BUENO", "EXCELENTE"].includes(s)) return "status-pill status-green";
  if (["EN_TRANSITO", "CARGANDO", "EN_ORIGEN", "EN_PROGRESO", "PENDIENTE"].includes(s)) return "status-pill status-yellow";
  if (["RECHAZADO", "CANCELADO", "RETRASADO", "MALO", "RETRABAJO"].includes(s)) return "status-pill status-red";
  return "status-pill status-neutral";
}

function buildDemoCheckpoints(shipment: Shipment): Checkpoint[] {
  const dispatch =
    parseDate(shipment.fecha_despacho_real) ??
    parseDate(shipment.fecha_despacho_programada) ??
    new Date();

  return DEMO_CHECKPOINTS.map((point, index) => {
    // Demonstration only: time advances by about 50 minutes per city checkpoint.
    const occurredAt = new Date(dispatch.getTime() + index * 50 * 60 * 1000);
    if (index === DEMO_CHECKPOINTS.length - 1) {
      const actualDelivery = parseDate(shipment.fecha_entrega_real);
      const estimatedDelivery = parseDate(shipment.fecha_entrega_estimada);
      if (actualDelivery) occurredAt.setTime(actualDelivery.getTime());
      else if (estimatedDelivery) occurredAt.setTime(estimatedDelivery.getTime());
    }
    return {
      ...point,
      occurredAt,
      observation: index === DEMO_CHECKPOINTS.length - 1
        ? shipment.estatus_general === "ENTREGADO"
          ? "Entrega registrada (demo; revisar fecha real en la base)"
          : "Último checkpoint estimado"
        : "Checkpoint simulado por intervalo de ruta",
      isCurrent: index === 4 && shipment.estatus_general === "EN_TRANSITO",
    };
  });
}

function deliveryResult(shipment: Shipment) {
  const scheduled = parseDate(shipment.fecha_entrega_estimada);
  const actual = parseDate(shipment.fecha_entrega_real);
  if (shipment.estatus_general !== "ENTREGADO") {
    if (scheduled && Date.now() > scheduled.getTime()) return "Retrasado — entrega aún no registrada";
    return "En tránsito — aún no se puede confirmar";
  }
  if (!scheduled || !actual) return "Faltan fecha programada o fecha real";
  return actual.getTime() <= scheduled.getTime() ? "Entregado a tiempo" : "Entregado con retraso";
}

export default function TrackingPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [routeIndex, setRouteIndex] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);

  async function load() {
    const response = await fetch("/api/operaciones/envios", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudieron cargar los envíos.");
    const data = await response.json();
    const filtered = (Array.isArray(data) ? data : []).filter((s: Shipment) =>
      ["EN_TRANSITO", "ENTREGADO", "RETRASADO"].includes(String(s.estatus_general).toUpperCase())
    );
    setShipments(filtered);
    if (selectedId === null && filtered.length) setSelectedId(filtered[0].id_envio);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  const selected = shipments.find((s) => s.id_envio === selectedId) ?? null;

  const checkpoints = useMemo(
    () => selected ? buildDemoCheckpoints(selected) : [],
    [selected]
  );

  // Try the protected server API for route options. Without an API key, show demo lines.
  // The demo coordinates must be replaced by geocoded shipment-specific coordinates.
  useEffect(() => {
    if (!selected) {
      setRouteOptions([]);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    setRouteIndex(0);
    fetch("/api/tracking/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coordinates: [
          [-99.516, 27.476],       // longitude, latitude: Nuevo Laredo demo origin
          [-100.3161, 25.6866],    // longitude, latitude: Monterrey demo destination
        ],
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Routing API no disponible.");
        return data.routes as RouteOption[];
      })
      .then((routes) => {
        if (!cancelled && routes?.length) setRouteOptions(routes);
      })
      .catch(() => {
        if (!cancelled) {
          setRouteOptions([
            {
              coordinates: DEMO_CHECKPOINTS.map((p) => [p.lat, p.lng]),
              label: "Ruta base demostrativa",
            },
            {
              coordinates: DEMO_ALTERNATE,
              label: "Ruta alterna demostrativa",
            },
          ]);
        }
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  const route = routeOptions[routeIndex]?.coordinates ?? DEMO_CHECKPOINTS.map((p) => [p.lat, p.lng] as [number, number]);
  const checkpointsForMap = checkpoints;

  return (
    <section>
      <header>
        <div>
          <h1>Tracking de envíos</h1>
          <p className="muted">Consulta envíos en tránsito y entregados.</p>
        </div>
        <button type="button" className="secondary" onClick={() => load().catch(e => setMessage(e.message))}>
          Actualizar
        </button>
      </header>

      {message && <p className="message error">{message}</p>}

      <div className="panel responsive-table">
        <table>
          <thead>
            <tr>
              <th>Código</th><th>Cliente</th><th>Trailer</th><th>Estado</th>
              <th>Despacho programado</th><th>Entrega estimada</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr key={s.id_envio} onClick={() => setSelectedId(s.id_envio)} style={{ cursor: "pointer" }}>
                <td>
                  <button type="button" className="table-link" onClick={(e) => { e.stopPropagation(); setSelectedId(s.id_envio); }}>
                    {s.codigo_envio}
                  </button>
                </td>
                <td>{s.nombre_cliente}</td>
                <td>{s.codigo_trailer || "Sin asignar"}</td>
                <td><span className={statusClass(s.estatus_general)}>{String(s.estatus_general).replaceAll("_", " ")}</span></td>
                <td>{fmt(s.fecha_despacho_programada)}</td>
                <td>{fmt(s.fecha_entrega_estimada)}</td>
              </tr>
            ))}
            {!shipments.length && <tr><td colSpan={6}>No hay envíos en tránsito o entregados.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="tracking-layout">
          <aside className="panel tracking-timeline">
            <div className="detail-heading">
              <div>
                <h2>{selected.codigo_envio}</h2>
                <p className="muted">{selected.nombre_cliente} · {selected.codigo_trailer || "Sin trailer"}</p>
              </div>
              <span className={statusClass(selected.estatus_general)}>{selected.estatus_general.replaceAll("_", " ")}</span>
            </div>

            <div className="tracking-times">
              <p><strong>Despacho programado:</strong><br />{fmt(selected.fecha_despacho_programada)}</p>
              <p><strong>Despacho real:</strong><br />{fmt(selected.fecha_despacho_real)}</p>
              <p><strong>Entrega programada:</strong><br />{fmt(selected.fecha_entrega_estimada)}</p>
              <p><strong>Entrega real:</strong><br />{fmt(selected.fecha_entrega_real)}</p>
            </div>

            <p><strong>Resultado de entrega:</strong> {deliveryResult(selected)}</p>
            <p className="muted">
              Los checkpoints siguientes son simulados para demostración. No son lecturas GPS.
              La ruta de ejemplo es Nuevo Laredo → Monterrey y no sustituye el destino guardado en el envío.
            </p>

            <h3>10 checkpoints simulados (intervalo ilustrativo)</h3>
            <ol className="checkpoint-list">
              {checkpoints.map((point, index) => (
                <li key={point.id} className={point.isCurrent ? "checkpoint-current" : ""}>
                  <div className="checkpoint-dot" />
                  <div>
                    <strong>{index + 1}. {point.label}</strong>
                    <div className="muted">{fmt(point.occurredAt)}</div>
                    <div className="muted">{point.observation}</div>
                  </div>
                </li>
              ))}
            </ol>
          </aside>

          <div className="panel tracking-map-panel">
            <div className="detail-heading">
              <div>
                <h2>Mapa de ruta</h2>
                <p className="muted">Vista demostrativa con ciudades y coordenadas aproximadas.</p>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={routeLoading || routeOptions.length < 2}
                onClick={() => setRouteIndex((i) => (i + 1) % routeOptions.length)}
              >
                {routeLoading ? "Calculando..." : "Simular ruta alterna"}
              </button>
            </div>
            {routeOptions[routeIndex] && (
              <p className="muted">
                {routeOptions[routeIndex].label}
                {routeOptions[routeIndex].distanceKm ? ` · ${routeOptions[routeIndex].distanceKm!.toFixed(1)} km` : ""}
                {routeOptions[routeIndex].durationMinutes ? ` · ${Math.round(routeOptions[routeIndex].durationMinutes!)} min` : ""}
              </p>
            )}
            <TrackingMap route={route} checkpoints={checkpointsForMap} />
            <p className="muted">© OpenStreetMap contributors. La alternativa se obtiene del API si se configura; de lo contrario es una línea de demo.</p>
          </div>
        </div>
      )}
    </section>
  );
}
