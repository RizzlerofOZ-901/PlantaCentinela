"use client";

import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Circle,
  Popup,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

type MapPoint = {
  id: string;
  label: string;
  km: number;
  lat: number;
  lng: number;
  status: string;
};

type Props = {
  route: [number, number][];
  originalRoute: [number, number][];
  currentPosition: [number, number];
  checkpoints: MapPoint[];
  blockedCenter?: [number, number] | null;
  canBlock?: boolean;
  onMapClickBlock?: (lat: number, lng: number) => void;
};

function MapClickHandler({
  enabled,
  onSelect,
}: {
  enabled: boolean;
  onSelect?: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (enabled && onSelect) {
        onSelect(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

export default function TrackingMap({
  route,
  originalRoute,
  currentPosition,
  checkpoints,
  blockedCenter,
  canBlock = false,
  onMapClickBlock,
}: Props) {
  if (!route.length) return <p>No hay geometría de ruta para mostrar.</p>;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 440,
        cursor: canBlock ? "crosshair" : "grab",
      }}
    >
      <MapContainer
        key={`${route[0][0]}-${route[0][1]}-${route.length}`}
        bounds={route}
        boundsOptions={{ padding: [28, 28] }}
        scrollWheelZoom
        style={{ width: "100%", height: "100%", minHeight: 440 }}
      >
        <MapClickHandler enabled={canBlock} onSelect={onMapClickBlock} />

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
              opacity: 0.6,
              dashArray: "8 8",
            }}
          />
        )}

        <Polyline
          positions={route}
          pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.92 }}
        />

        {/* 40 km Blocked Zone (20 km radius around clicked point) */}
        {blockedCenter && (
          <Circle
            center={blockedCenter}
            radius={20000}
            pathOptions={{
              color: "#dc2626",
              fillColor: "#ef4444",
              fillOpacity: 0.22,
              weight: 2.5,
              dashArray: "6 6",
            }}
          >
            <Popup>Zona bloqueada (radio 20 km / tramo 40 km)</Popup>
          </Circle>
        )}

        <CircleMarker
          center={route[0]}
          radius={8}
          pathOptions={{
            color: "#15803d",
            fillColor: "#22c55e",
            fillOpacity: 1,
          }}
        >
          <Popup>Origen / Inicio del tramo activo</Popup>
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
          <Popup>Posición actual del camión</Popup>
        </CircleMarker>

        {checkpoints.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lng]}
            radius={6}
            pathOptions={{
              color:
                point.status === "BLOQUEADO"
                  ? "#b91c1c"
                  : point.status === "ALCANZADO"
                    ? "#15803d"
                    : "#475569",
              fillColor:
                point.status === "BLOQUEADO"
                  ? "#ef4444"
                  : point.status === "ALCANZADO"
                    ? "#22c55e"
                    : "#cbd5e1",
              fillOpacity: 1,
            }}
          >
            <Popup>
              <strong>{point.label}</strong>
              <br />
              {point.km.toFixed(1)} km
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}