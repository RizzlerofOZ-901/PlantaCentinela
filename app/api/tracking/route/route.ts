// FILE: app/api/tracking/route/route.ts
// Server-side proxy: keep OPENROUTESERVICE_API_KEY in .env.local.
// This endpoint accepts coordinates, not addresses. Geocoding must be added separately.
import { NextRequest, NextResponse } from "next/server";

type Body = { coordinates?: [number, number][] };

export async function POST(request: NextRequest) {
  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Configura OPENROUTESERVICE_API_KEY en .env.local para solicitar rutas reales." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const coordinates = body.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 ||
      coordinates.some((p) => !Array.isArray(p) || p.length !== 2 ||
        !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
    return NextResponse.json({ error: "Envía al menos dos coordenadas [longitud, latitud]." }, { status: 400 });
  }

  try {
    // Current ORS/HeiGIT API host. Do not use the deprecated api.openrouteservice.org host.
    const response = await fetch("https://api.heigit.org/v2/directions/driving-car/geojson", {
      method: "POST",
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates,
        instructions: false,
        alternative_routes: {
          target_count: 3,
          weight_factor: 1.4,
          share_factor: 0.6,
        },
      }),
      cache: "no-store",
    });

    const result = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: result?.error?.message || "El proveedor de rutas rechazó la solicitud." },
        { status: response.status }
      );
    }

    const routes = (result.features ?? []).map((feature: any, index: number) => ({
      label: index === 0 ? "Ruta recomendada" : `Alternativa ${index}`,
      // GeoJSON coordinates are [longitude, latitude]; the map component expects [latitude, longitude].
      coordinates: (feature.geometry?.coordinates ?? []).map((c: number[]) => [c[1], c[0]]),
      distanceKm: Number(feature.properties?.summary?.distance ?? 0) / 1000,
      durationMinutes: Number(feature.properties?.summary?.duration ?? 0) / 60,
    }));

    return NextResponse.json({ routes });
  } catch (error) {
    console.error("Tracking routing error:", error);
    return NextResponse.json({ error: "No se pudo conectar con el proveedor de rutas." }, { status: 502 });
  }
}
