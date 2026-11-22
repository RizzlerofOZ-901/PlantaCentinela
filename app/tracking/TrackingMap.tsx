"use client";

import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type MapPoint = {
  id: string;
  label: string;
  lat: number;
  lng: number;
};

type Props = {
  route: [number, number][];
  checkpoints: MapPoint[];
};

export default function TrackingMap({ route, checkpoints }: Props) {
  const origin: [number, number] = route[0] ?? [27.476, -99.516];
  const destination: [number, number] = route[route.length - 1] ?? [25.6866, -100.3161];
  const bounds = route.length ? route : [origin, destination];

  return (
    <div className="tracking-map">
      <MapContainer
        bounds={bounds as [number, number][]}
        boundsOptions={{ padding: [28, 28] }}
        scrollWheelZoom
        style={{ width: "100%", height: "100%", minHeight: 420 }}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

        <Polyline positions={route} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.85 }} />

        <CircleMarker center={origin} radius={9} pathOptions={{ color: "#15803d", fillColor: "#22c55e", fillOpacity: 1 }}>
          <Popup>Origen de demostración</Popup>
        </CircleMarker>

        <CircleMarker center={destination} radius={9} pathOptions={{ color: "#b91c1c", fillColor: "#ef4444", fillOpacity: 1 }}>
          <Popup>Destino de demostración</Popup>
        </CircleMarker>

        {checkpoints.map((point, index) => (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lng]}
            radius={5}
            pathOptions={{ color: "#1d4ed8", fillColor: "#93c5fd", fillOpacity: 1 }}
          >
            <Popup>
              <strong>Checkpoint {index + 1}</strong>
              <br />
              {point.label}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
