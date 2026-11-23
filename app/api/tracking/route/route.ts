import { NextRequest, NextResponse } from "next/server";

type Body = { coordinates?: [number, number][] };

export async function POST(request: NextRequest) {
  const key = process.env.OPENROUTESERVICE_API_KEY;

  if (!key) {
    return NextResponse.json(
      { error: "Configura OPENROUTESERVICE_API_KEY en el servidor." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const coordinates = body.coordinates;

  if (
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    coordinates.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1])
    )
  ) {
    return NextResponse.json(
      { error: "Envía origen y destino como [longitud, latitud]." },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      "https://api.heigit.org/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          Authorization: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ coordinates, instructions: false }),
        cache: "no-store",
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.error?.message || "El proveedor rechazó la solicitud." },
        { status: response.status }
      );
    }

    const routes = (result.features ?? []).map((feature: any) => ({
      coordinates: (feature.geometry?.coordinates ?? []).map(
        (coordinate: number[]) => [coordinate[1], coordinate[0]]
      ),
      distanceKm: Number(feature.properties?.summary?.distance ?? 0) / 1000,
      durationMinutes: Number(feature.properties?.summary?.duration ?? 0) / 60,
    }));

    return NextResponse.json({ routes });
  } catch (error) {
    console.error("Tracking routing error:", error);
    return NextResponse.json(
      { error: "No se pudo conectar con el proveedor de rutas." },
      { status: 502 }
    );
  }
}
