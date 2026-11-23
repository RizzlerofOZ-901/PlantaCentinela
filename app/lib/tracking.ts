import pool from "@/app/lib/db";
import type { RowDataPacket } from "mysql2";

export type LatLng = [number, number];

const ORIGIN: LatLng = [27.4783865, -99.5075197];

const DESTINATIONS: Record<string, LatLng> = {
  "JOHNSON CONTROLS": [25.772584, -100.191632],
  NIDEC: [25.778848, -100.198305],
  NEMAK: [25.7331043, -100.5371376],
  METALSA: [25.7674251, -100.1911475],
};

type RouteResult = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMinutes: number;
};

function destinationFor(clientName: string): LatLng {
  const normalized = clientName.trim().toUpperCase();
  const match = Object.entries(DESTINATIONS).find(([name]) =>
    normalized.includes(name)
  );

  if (!match) {
    throw new Error(
      `No hay coordenadas configuradas para el cliente: ${clientName}`
    );
  }

  return match[1];
}

async function getRoadRoute(
  start: LatLng,
  end: LatLng,
  avoidPolygon?: object
): Promise<RouteResult> {
  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (!key) throw new Error("Falta OPENROUTESERVICE_API_KEY.");

  const payload: Record<string, unknown> = {
    coordinates: [
      [start[1], start[0]], // ORS espera [longitud, latitud].
      [end[1], end[0]],
    ],
    instructions: false,
  };

  if (avoidPolygon) {
    payload.options = { avoid_polygons: avoidPolygon };
  }

  const response = await fetch(
    "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson",
    {
      method: "POST",
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    }
  );

  const responseText = await response.text();

let result: any;

try {
  result = JSON.parse(responseText);
} catch {
  throw new Error(
    `HeiGIT devolvió una respuesta que no es JSON. HTTP ${response.status}. Respuesta: ${responseText.slice(0, 300)}`
  );
}

if (!response.ok) {
  throw new Error(
    result?.error?.message ||
    `Error de HeiGIT: HTTP ${response.status}`
  );
}

  const feature = result.features?.[0];
  const raw: number[][] = feature?.geometry?.coordinates ?? [];

  if (raw.length < 2) {
    throw new Error("El proveedor no devolvió una geometría de ruta válida.");
  }

  return {
    coordinates: raw.map(
      (point) => [Number(point[1]), Number(point[0])] as LatLng
    ),
    distanceKm: Number(feature.properties?.summary?.distance ?? 0) / 1000,
    durationMinutes: Number(feature.properties?.summary?.duration ?? 0) / 60,
  };
}

function haversine(a: LatLng, b: LatLng): number {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) *
      Math.cos(rad(b[0])) *
      Math.sin(dLng / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function pointAtDistance(route: LatLng[], targetKm: number): LatLng {
  if (!route.length) throw new Error("La ruta no contiene coordenadas.");
  if (targetKm <= 0) return route[0];

  let accumulated = 0;

  for (let i = 1; i < route.length; i++) {
    const segment = haversine(route[i - 1], route[i]);

    if (accumulated + segment >= targetKm) {
      const ratio =
        segment === 0 ? 0 : (targetKm - accumulated) / segment;

      return [
        route[i - 1][0] + (route[i][0] - route[i - 1][0]) * ratio,
        route[i - 1][1] + (route[i][1] - route[i - 1][1]) * ratio,
      ];
    }

    accumulated += segment;
  }

  return route[route.length - 1];
}

export function getPositionOnRoute(
  route: LatLng[],
  targetKm: number
): LatLng {
  return pointAtDistance(route, targetKm);
}

export async function initializeTracking(shipmentId: number): Promise<void> {
  const [existing] = await pool.execute<RowDataPacket[]>(
    "SELECT id_tracking FROM tracking_sessions WHERE id_envio = ? LIMIT 1",
    [shipmentId]
  );

  if (existing.length) return; // No reinicia una sesión existente.

  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT id_envio, nombre_cliente, estatus_general FROM envios WHERE id_envio = ? LIMIT 1",
    [shipmentId]
  );

  if (!rows.length) throw new Error("No se encontró el envío.");
  if (rows[0].estatus_general !== "EN_TRANSITO") return;

  const destination = destinationFor(String(rows[0].nombre_cliente));
  const route = await getRoadRoute(ORIGIN, destination);

  await pool.query(
    `INSERT IGNORE INTO tracking_sessions
      (id_envio, ruta_original, ruta_activa, distancia_total_km,
       distancia_avance_km, duracion_estimada_min, estado, ultimo_avance)
     VALUES (?, ?, ?, ?, 0, ?, 'ACTIVO', NOW())`,
    [
      shipmentId,
      JSON.stringify(route.coordinates),
      JSON.stringify(route.coordinates),
      route.distanceKm,
      route.durationMinutes,
    ]
  );

  // Checkpoints cada 50 km medidos sobre la geometría vial.
  const checkpoints: Array<[number, number, number, number, number]> = [];
  let checkpointNumber = 1;

  for (let km = 50; km < route.distanceKm; km += 50) {
    const [lat, lng] = pointAtDistance(route.coordinates, km);
    checkpoints.push([shipmentId, checkpointNumber++, km, lat, lng]);
  }

  if (checkpoints.length) {
    const placeholders = checkpoints.map(() => "(?, ?, ?, ?, ?)").join(", ");
    await pool.query(
      `INSERT IGNORE INTO tracking_checkpoints
        (id_envio, numero_checkpoint, distancia_acumulada_km,
         latitud, longitud, estatus)
       VALUES ${placeholders}`,
      checkpoints.flat()
    );
  }
}

export async function recalculateAvoiding(
  currentPosition: LatLng,
  destination: LatLng,
  blockedPoint: LatLng
): Promise<RouteResult> {
  // Polígono pequeño alrededor del punto seleccionado como cierre simulado.
  const latDelta = 0.008;
  const lngDelta = 0.008;

  const polygon = {
    type: "Polygon",
    coordinates: [[
      [blockedPoint[1] - lngDelta, blockedPoint[0] - latDelta],
      [blockedPoint[1] + lngDelta, blockedPoint[0] - latDelta],
      [blockedPoint[1] + lngDelta, blockedPoint[0] + latDelta],
      [blockedPoint[1] - lngDelta, blockedPoint[0] + latDelta],
      [blockedPoint[1] - lngDelta, blockedPoint[0] - latDelta],
    ]],
  };

  return getRoadRoute(currentPosition, destination, polygon);
}
