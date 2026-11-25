import pool from "@/app/lib/db";
import type { RowDataPacket } from "mysql2";

export type LatLng = [number, number];

const ORIGIN: LatLng = [27.4783865, -99.5075197];
const ORIGIN_LABEL = "Nuevo Laredo, Tamps. (Origen)";

const DESTINATIONS: Record<string, LatLng> = {
  "JOHNSON CONTROLS": [25.772584, -100.191632],
  NIDEC: [25.778848, -100.198305],
  NEMAK: [25.7331043, -100.5371376],
  METALSA: [25.7674251, -100.1911475],
  LENOVO: [25.7766, -100.1706],
};

// Fast local municipality directory for Nuevo Laredo -> Monterrey / NL / Coahuila
const KNOWN_CITIES: Array<{ name: string; lat: number; lng: number }> = [
  { name: "Nuevo Laredo, Tamps.", lat: 27.4784, lng: -99.5075 },
  { name: "Colombia, NL", lat: 27.7017, lng: -99.7567 },
  { name: "Anáhuac, NL", lat: 27.2406, lng: -100.1322 },
  { name: "Lampazos de Naranjo, NL", lat: 27.0264, lng: -100.5069 },
  { name: "Vallecillo, NL", lat: 26.6606, lng: -99.9875 },
  { name: "Parás, NL", lat: 26.5019, lng: -99.5244 },
  { name: "Sabinas Hidalgo, NL", lat: 26.5028, lng: -100.1819 },
  { name: "Bustamante, NL", lat: 26.5625, lng: -100.5019 },
  { name: "Villaldama, NL", lat: 26.5011, lng: -100.4264 },
  { name: "Agualeguas, NL", lat: 26.3106, lng: -99.5364 },
  { name: "Cerralvo, NL", lat: 26.0858, lng: -99.6169 },
  { name: "Salinas Victoria, NL", lat: 25.9631, lng: -100.2939 },
  { name: "Ciénega de Flores, NL", lat: 25.9564, lng: -100.1678 },
  { name: "General Zuazua, NL", lat: 25.8953, lng: -100.1072 },
  { name: "Higueras, NL", lat: 25.9658, lng: -100.0156 },
  { name: "Marín, NL", lat: 25.8772, lng: -100.0322 },
  { name: "Doctor González, NL", lat: 25.8625, lng: -99.9447 },
  { name: "Pesquería, NL", lat: 25.7847, lng: -100.0506 },
  { name: "Apodaca, NL", lat: 25.7815, lng: -100.1886 },
  { name: "General Escobedo, NL", lat: 25.8086, lng: -100.3239 },
  { name: "San Nicolás de los Garza, NL", lat: 25.7417, lng: -100.3022 },
  { name: "Guadalupe, NL", lat: 25.6768, lng: -100.2565 },
  { name: "Monterrey, NL", lat: 25.6866, lng: -100.3161 },
  { name: "Santa Catarina, NL", lat: 25.6733, lng: -100.4581 },
  { name: "García, NL", lat: 25.8136, lng: -100.5942 },
  { name: "Mina, NL", lat: 26.0014, lng: -100.5297 },
  { name: "Cadereyta Jiménez, NL", lat: 25.5889, lng: -99.9978 },
  { name: "Ramos Arizpe, Coah.", lat: 25.5394, lng: -100.9469 },
  { name: "Saltillo, Coah.", lat: 25.4232, lng: -101.0053 },
  { name: "Monclova, Coah.", lat: 26.9069, lng: -101.4206 },
];

// Real paved highway bypass hubs (West Corridor: Hwy 1 / Lampazos-Villaldama-Mina,
// East Corridor: Hwy 2 / Parás-Agualeguas-Cerralvo-Marín, Metro bypasses: García / Pesquería)
const BYPASS_HUBS: Array<{ name: string; point: LatLng }> = [
  { name: "Lampazos de Naranjo, NL", point: [27.0264, -100.5069] },
  { name: "Villaldama, NL", point: [26.5011, -100.4264] },
  { name: "Parás, NL", point: [26.5019, -99.5244] },
  { name: "Agualeguas, NL", point: [26.3106, -99.5364] },
  { name: "Cerralvo, NL", point: [26.0858, -99.6169] },
  { name: "Mina, NL", point: [26.0014, -100.5297] },
  { name: "Marín, NL", point: [25.8772, -100.0322] },
  { name: "Pesquería, NL", point: [25.7847, -100.0506] },
  { name: "García, NL", point: [25.8136, -100.5942] },
];

export type RouteResult = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMinutes: number;
};

export function destinationFor(clientName: string): LatLng {
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

export function haversine(a: LatLng, b: LatLng): number {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function resolveCityName(lat: number, lng: number): string {
  let nearest = KNOWN_CITIES[0];
  let bestDist = Infinity;

  for (const city of KNOWN_CITIES) {
    const d = haversine([lat, lng], [city.lat, city.lng]);
    if (d < bestDist) {
      bestDist = d;
      nearest = city;
    }
  }

  return nearest.name;
}

async function getRoadRoute(
  waypoints: LatLng[],
  avoidPolygon?: object
): Promise<RouteResult> {
  const key = process.env.OPENROUTESERVICE_API_KEY;

  if (!key) {
    throw new Error("Falta OPENROUTESERVICE_API_KEY.");
  }

  const payload: Record<string, unknown> = {
    coordinates: waypoints.map(([lat, lng]) => [lng, lat]), // ORS expects [lng, lat]
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
      `HeiGIT devolvió una respuesta no válida. HTTP ${response.status}.`
    );
  }

  if (!response.ok) {
    throw new Error(
      result?.error?.message || `Error de HeiGIT: HTTP ${response.status}`
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

function pointAtDistance(route: LatLng[], targetKm: number): LatLng {
  if (!route.length) {
    throw new Error("La ruta no contiene coordenadas.");
  }

  if (targetKm <= 0) {
    return route[0];
  }

  let accumulated = 0;

  for (let i = 1; i < route.length; i++) {
    const segment = haversine(route[i - 1], route[i]);

    if (accumulated + segment >= targetKm) {
      const ratio = segment === 0 ? 0 : (targetKm - accumulated) / segment;

      return [
        route[i - 1][0] + (route[i][0] - route[i - 1][0]) * ratio,
        route[i - 1][1] + (route[i][1] - route[i - 1][1]) * ratio,
      ];
    }

    accumulated += segment;
  }

  return route[route.length - 1];
}

export function getPositionOnRoute(route: LatLng[], targetKm: number): LatLng {
  return pointAtDistance(route, targetKm);
}

/**
 * Returns the exact polyline prefix from Origin (0 km) up to `targetKm`,
 * ending at the truck's current position.
 */
export function sliceRouteUpToDistance(
  route: LatLng[],
  targetKm: number
): LatLng[] {
  if (!route.length) return [];
  if (targetKm <= 0) return [route[0]];

  const prefix: LatLng[] = [route[0]];
  let accumulated = 0;

  for (let i = 1; i < route.length; i++) {
    const segment = haversine(route[i - 1], route[i]);

    if (accumulated + segment >= targetKm) {
      const ratio = segment === 0 ? 0 : (targetKm - accumulated) / segment;
      prefix.push([
        route[i - 1][0] + (route[i][0] - route[i - 1][0]) * ratio,
        route[i - 1][1] + (route[i][1] - route[i - 1][1]) * ratio,
      ]);
      return prefix;
    }

    prefix.push(route[i]);
    accumulated += segment;
  }

  return prefix;
}

/**
 * Finds the distance along `route` closest to `clickedPoint`.
 */
export function findNearestRouteDistanceKm(
  route: LatLng[],
  clickedPoint: LatLng
): { km: number; point: LatLng; distanceToRouteKm: number } {
  let accumulated = 0;
  let bestKm = 0;
  let bestPoint = route[0];
  let bestDist = haversine(route[0], clickedPoint);

  for (let i = 1; i < route.length; i++) {
    accumulated += haversine(route[i - 1], route[i]);
    const d = haversine(route[i], clickedPoint);
    if (d < bestDist) {
      bestDist = d;
      bestKm = accumulated;
      bestPoint = route[i];
    }
  }

  return { km: bestKm, point: bestPoint, distanceToRouteKm: bestDist };
}

/**
 * Checks the minimum distance (in km) from a route polyline to a blocked point.
 */
function minDistanceToRouteKm(route: LatLng[], target: LatLng): number {
  let minD = Infinity;
  const step = Math.max(1, Math.floor(route.length / 250));
  for (let i = 0; i < route.length; i += step) {
    const d = haversine(route[i], target);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Builds a small oriented corridor polygon for short-range (< 115 km) detours.
 */
function buildCorridorPolygon(
  route: LatLng[],
  centerKm: number,
  totalKm: number,
  halfLengthKm = 8,
  halfWidthKm = 1.2
) {
  const startKm = Math.max(1, centerKm - halfLengthKm);
  const endKm = Math.min(totalKm - 1, centerKm + halfLengthKm);
  const p1 = pointAtDistance(route, startKm);
  const p2 = pointAtDistance(route, endKm);

  const dLat = p2[0] - p1[0];
  const dLng = p2[1] - p1[1];
  const len = Math.hypot(dLat, dLng) || 0.001;

  const degPerKm = 1 / 111;
  const perpLat = (-dLng / len) * (halfWidthKm * degPerKm);
  const perpLng = (dLat / len) * (halfWidthKm * degPerKm);

  const c1: [number, number] = [p1[1] + perpLng, p1[0] + perpLat];
  const c2: [number, number] = [p2[1] + perpLng, p2[0] + perpLat];
  const c3: [number, number] = [p2[1] - perpLng, p2[0] - perpLat];
  const c4: [number, number] = [p1[1] - perpLng, p1[0] - perpLat];

  return {
    type: "Polygon",
    coordinates: [[c1, c2, c3, c4, c1]],
  };
}

/**
 * Computes a brand-new alternative road route from `currentPosition` to `destination`
 * that avoids `clickedPoint`, working reliably at ANY distance (> 150 km included).
 * Returns `null` only if no valid bypass exists (triggering the 10s traffic delay).
 */
export async function recalculateAvoidingZone(
  activeRoute: LatLng[],
  currentPosition: LatLng,
  destination: LatLng,
  clickedPoint: LatLng,
  totalDistanceKm: number
): Promise<{ route: RouteResult; snappedPoint: LatLng; blockedKm: number } | null> {
  const nearest = findNearestRouteDistanceKm(activeRoute, clickedPoint);
  const directKm = haversine(currentPosition, destination);

  const rankedHubs = BYPASS_HUBS.filter(
    (hub) => haversine(hub.point, nearest.point) >= 18
  )
    .map((hub) => {
      const detourEst =
        haversine(currentPosition, hub.point) + haversine(hub.point, destination);
      return { ...hub, detourEst };
    })
    .sort((a, b) => a.detourEst - b.detourEst)
    .slice(0, 4);

  const tasks: Promise<RouteResult>[] = rankedHubs.map((hub) =>
    getRoadRoute([currentPosition, hub.point, destination])
  );

  if (directKm < 115) {
    const poly = buildCorridorPolygon(
      activeRoute,
      nearest.km,
      totalDistanceKm,
      8,
      1.2
    );
    tasks.push(getRoadRoute([currentPosition, destination], poly));
  }

  const settled = await Promise.allSettled(tasks);
  const validDetours: RouteResult[] = [];

  for (const res of settled) {
    if (res.status === "fulfilled" && res.value.coordinates.length >= 2) {
      const clearanceKm = minDistanceToRouteKm(
        res.value.coordinates,
        nearest.point
      );
      if (clearanceKm >= 3.5) {
        validDetours.push(res.value);
      }
    }
  }

  if (validDetours.length > 0) {
    validDetours.sort((a, b) => a.distanceKm - b.distanceKm);
    return {
      route: validDetours[0],
      snappedPoint: nearest.point,
      blockedKm: nearest.km,
    };
  }

  return null;
}

/**
 * Generates checkpoints:
 * - #1: 0 km (Origin) on initial creation
 * - Every 30 km (cumulative): resolved city name (e.g. "Sabinas Hidalgo, NL")
 * - Final: total cumulative trip distance (Client Name)
 */
export async function rebuildTrackingCheckpoints(
  shipmentId: number,
  routeCoordinates: LatLng[],
  distanceKm: number,
  clientName: string,
  originLabel = ORIGIN_LABEL,
  startNumber = 1,
  markOriginReached = true,
  baseDistanceKm = 0
): Promise<void> {
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
    throw new Error("No se puede crear checkpoints: ruta inválida.");
  }

  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    throw new Error("No se puede crear checkpoints: distancia inválida.");
  }

  const rows: Array<
    [number, number, number, number, number, string, string, Date | null, string | null]
  > = [];
  let num = startNumber;

  // Checkpoint 1: Origin (0 km) only on initial route creation
  if (startNumber === 1 && baseDistanceKm === 0) {
    const [oLat, oLng] = routeCoordinates[0];
    rows.push([
      shipmentId,
      num++,
      0,
      oLat,
      oLng,
      originLabel,
      markOriginReached ? "ALCANZADO" : "PENDIENTE",
      markOriginReached ? new Date() : null,
      markOriginReached ? "Salida registrada desde origen" : null,
    ]);
  }

  const totalTripKm = baseDistanceKm + distanceKm;
  // Next 30 km multiple ahead of current cumulative progress
  const firstStepKm =
    baseDistanceKm > 0
      ? Math.ceil((baseDistanceKm + 1) / 30) * 30
      : 30;

  for (
    let cumulativeKm = firstStepKm;
    cumulativeKm < totalTripKm - 10;
    cumulativeKm += 30
  ) {
    const distanceAlongDetour = cumulativeKm - baseDistanceKm;
    const [lat, lng] = pointAtDistance(routeCoordinates, distanceAlongDetour);
    const cityName = resolveCityName(lat, lng);
    rows.push([
      shipmentId,
      num++,
      cumulativeKm,
      lat,
      lng,
      cityName,
      "PENDIENTE",
      null,
      null,
    ]);
  }

  // Final checkpoint: Destination at total cumulative trip distance
  const [dLat, dLng] = routeCoordinates[routeCoordinates.length - 1];
  const destCity = resolveCityName(dLat, dLng);
  rows.push([
    shipmentId,
    num++,
    Number(totalTripKm.toFixed(2)),
    dLat,
    dLng,
    `${clientName} (${destCity})`,
    "PENDIENTE",
    null,
    null,
  ]);

  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");

  await pool.query(
    `INSERT IGNORE INTO tracking_checkpoints
      (id_envio, numero_checkpoint, distancia_acumulada_km,
       latitud, longitud, ubicacion, estatus, fecha_registro, observaciones)
     VALUES ${placeholders}`,
    rows.flat()
  );
}

export async function initializeTracking(shipmentId: number): Promise<void> {
  const [existing] = await pool.execute<RowDataPacket[]>(
    `SELECT s.id_tracking, s.ruta_original, s.distancia_total_km, e.nombre_cliente
     FROM tracking_sessions s
     INNER JOIN envios e ON e.id_envio = s.id_envio
     WHERE s.id_envio = ?
     LIMIT 1`,
    [shipmentId]
  );

  if (existing.length) {
    const [cpCount] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM tracking_checkpoints WHERE id_envio = ?",
      [shipmentId]
    );
    if (Number(cpCount[0]?.cnt ?? 0) === 0) {
      const storedRoute =
        typeof existing[0].ruta_original === "string"
          ? JSON.parse(existing[0].ruta_original)
          : existing[0].ruta_original;

      await rebuildTrackingCheckpoints(
        shipmentId,
        storedRoute as LatLng[],
        Number(existing[0].distancia_total_km),
        String(existing[0].nombre_cliente)
      );
    }
    return;
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id_envio, nombre_cliente, estatus_general
     FROM envios
     WHERE id_envio = ?
     LIMIT 1`,
    [shipmentId]
  );

  if (!rows.length) {
    throw new Error("No se encontró el envío.");
  }

  if (rows[0].estatus_general !== "EN_TRANSITO") {
    return;
  }

  const clientName = String(rows[0].nombre_cliente);
  const destination = destinationFor(clientName);
  const route = await getRoadRoute([ORIGIN, destination]);

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

  await rebuildTrackingCheckpoints(
    shipmentId,
    route.coordinates,
    route.distanceKm,
    clientName
  );
}
