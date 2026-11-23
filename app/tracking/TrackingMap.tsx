"use client";

import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

type MapPoint = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  status: string;
};

type Props = {
  route: [number, number][];
  originalRoute: [number, number][];
  currentPosition: [number, number];
  checkpoints: MapPoint[];
};

export default function TrackingMap({
  route,
  originalRoute,
  currentPosition,
  checkpoints,
}: Props) {
  if (!route.length) return <p>No hay geometría de ruta para mostrar.</p>;

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 420 }}>
      <MapContainer
        key={`${route[0][0]}-${route[0][1]}-${route.length}`}
        bounds={route}
        boundsOptions={{ padding: [28, 28] }}
        scrollWheelZoom
        style={{ width: "100%", height: "100%", minHeight: 420 }}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

        {originalRoute.length > 1 && (
          <Polyline
            positions={originalRoute}
            pathOptions={{
              color: "#94a3b8",
              weight: 4,
              opacity: 0.55,
              dashArray: "8 8",
            }}
          />
        )}

        <Polyline
          positions={route}
          pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.9 }}
        />

        <CircleMarker
          center={route[0]}
          radius={8}
          pathOptions={{
            color: "#15803d",
            fillColor: "#22c55e",
            fillOpacity: 1,
          }}
        >
          <Popup>Inicio del tramo activo</Popup>
        </CircleMarker>

        <CircleMarker
          center={route[route.length - 1]}
          radius={8}
          pathOptions={{
            color: "#b91c1c",
            fillColor: "#ef4444",
            fillOpacity: 1,
          }}
        >
          <Popup>Destino</Popup>
        </CircleMarker>

        <CircleMarker
          center={currentPosition}
          radius={10}
          pathOptions={{
            color: "#1d4ed8",
            fillColor: "#facc15",
            fillOpacity: 1,
            weight: 3,
          }}
        >
          <Popup>Posición simulada del camión</Popup>
        </CircleMarker>

        {checkpoints.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lng]}
            radius={5}
            pathOptions={{
              color: point.status === "ALCANZADO" ? "#15803d" : "#64748b",
              fillColor: point.status === "ALCANZADO" ? "#22c55e" : "#cbd5e1",
              fillOpacity: 1,
            }}
          >
            <Popup>
              <strong>{point.label}</strong>
              <br />
              {point.status}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
