"use client";

import { useEffect, useMemo, useState } from "react";

type Shipment = {
  id_envio: number;
  codigo_envio: string;
  nombre_cliente: string;
  codigo_trailer: string | null;
  estatus_general?: string;
};

type Doc = {
  id_documento: number;
  id_envio: number;
  codigo_envio: string;
  nombre_cliente: string;
  tipo_documento: string;
  estatus_documento: string;
};

const order = ["BOL", "FACTURA", "CARTA_PORTE", "LISTA_EMPAQUE"];

function label(v: string) {
  return v.replaceAll("_", " ");
}

function statusClass(value: unknown) {
  const s = String(value ?? "").toUpperCase();
  if (
    [
      "LISTO",
      "APROBADO",
      "BUENO",
      "EXCELENTE",
      "ENTREGADO",
      "EN_TRANSITO",
    ].includes(s)
  )
    return "status-pill status-green";
  if (
    ["EN PROGRESO", "EN_PROCESO", "CARGANDO", "PENDIENTE", "EN_ORIGEN"].includes(
      s
    )
  )
    return "status-pill status-yellow";
  if (
    ["RECHAZADO", "CANCELADO", "NO_ENTREGADO", "MALO", "DEFICIENTE"].includes(s)
  )
    return "status-pill status-red";
  if (["REGULAR", "OBSERVACIONES"].includes(s))
    return "status-pill status-orange";
  return "status-pill status-neutral";
}

export default function Page() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const [a, b] = await Promise.all([
      fetch("/api/operaciones/envios", { cache: "no-store" }),
      fetch("/api/operaciones/documentos", { cache: "no-store" }),
    ]);
    if (!a.ok || !b.ok)
      throw new Error("No se pudieron cargar envíos o documentos.");
    const [s, d] = await Promise.all([a.json(), b.json()]);
    setShipments(Array.isArray(s) ? s : []);
    setDocs(Array.isArray(d) ? d : []);
    setDraft({});
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  // Close modal with Escape key
  useEffect(() => {
    if (expanded === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const grouped = useMemo(() => {
    const m = new Map<number, Doc[]>();
    docs.forEach((d) => m.set(d.id_envio, [...(m.get(d.id_envio) || []), d]));
    return m;
  }, [docs]);

  function currentValue(d: Doc) {
    return draft[d.id_documento] ?? d.estatus_documento;
  }

  function status(id: number) {
    const ds = grouped.get(id) || [];
    if (
      ds.length === 4 &&
      order.every((t) =>
        ds.some((d) => d.tipo_documento === t && currentValue(d) === "LISTO")
      )
    )
      return "LISTO";
    return "EN PROGRESO";
  }

  function changedForShipment(id: number) {
    return (grouped.get(id) || []).some(
      (d) =>
        draft[d.id_documento] !== undefined &&
        draft[d.id_documento] !== d.estatus_documento
    );
  }

  function setDocument(d: Doc, checked: boolean) {
    setDraft((old) => ({
      ...old,
      [d.id_documento]: checked ? "LISTO" : "NO_ENTREGADO",
    }));
    setMsg("");
  }

  async function save() {
    const changes = docs.filter(
      (d) =>
        draft[d.id_documento] !== undefined &&
        draft[d.id_documento] !== d.estatus_documento
    );
    if (!changes.length) {
      setMsg("No hay cambios pendientes de guardar.");
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      for (const d of changes) {
        const response = await fetch("/api/operaciones/documentos", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_documento: d.id_documento,
            estatus_documento: draft[d.id_documento],
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || `No se pudo guardar ${label(d.tipo_documento)}.`
          );
      }
      await load();
      setExpanded(null);
      setMsg("Cambios guardados.");
    } catch (e) {
      setMsg(
        e instanceof Error ? e.message : "Error al guardar los documentos."
      );
    } finally {
      setLoading(false);
    }
  }

  const activeShipment =
    expanded !== null
      ? shipments.find((s) => s.id_envio === expanded) ?? null
      : null;

  return (
    <section>
      <header>
        <div>
          <h1>Documentos</h1>
          <p className="muted">
            Selecciona un envío de la tabla para abrir su checklist documental.
          </p>
        </div>
      </header>

      {msg && (
        <p
          className={`message ${
            msg.toLowerCase().includes("error") ||
            msg.toLowerCase().includes("no se pudo")
              ? "error"
              : ""
          }`}
        >
          {msg}
        </p>
      )}

      {/* SHIPMENTS TABLE */}
      <div className="panel responsive-table">
        <table>
          <thead>
            <tr>
              <th>Envío</th>
              <th>Cliente</th>
              <th>Documento</th>
              <th>Estatus documental</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr
                key={s.id_envio}
                onClick={() => setExpanded(s.id_envio)}
                className={expanded === s.id_envio ? "selected-row" : ""}
                style={{ cursor: "pointer" }}
              >
                <td>
                  <button
                    type="button"
                    className="table-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(s.id_envio);
                    }}
                  >
                    {s.codigo_envio}
                  </button>
                </td>
                <td>{s.nombre_cliente}</td>
                <td>BOL / Paquete Documental</td>
                <td>
                  <span className={statusClass(status(s.id_envio))}>
                    {label(status(s.id_envio))}
                  </span>
                </td>
              </tr>
            ))}
            {!shipments.length && (
              <tr>
                <td colSpan={4}>Todavía no hay envíos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL OVERLAY IN FRONT OF THE TABLE */}
      {expanded !== null && activeShipment && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpanded(null)}
        >
          <div
            className="centinela-card detail-panel modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-heading">
              <div>
                <h2>Envío: {activeShipment.codigo_envio}</h2>
                <p style={{ margin: "4px 0 0", fontWeight: 600 }}>
                  Cliente: {activeShipment.nombre_cliente}
                </p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => setExpanded(null)}
              >
                Cerrar
              </button>
            </div>

            <p className="muted">
              Los cambios permanecen pendientes hasta presionar Guardar. El
              estatus será LISTO cuando los cuatro documentos estén marcados.
            </p>

            <div className="checks">
              {order.map((type) => {
                const d = (grouped.get(expanded) || []).find(
                  (x) => x.tipo_documento === type
                );
                return (
                  <label key={type}>
                    <input
                      type="checkbox"
                      checked={!!d && currentValue(d) === "LISTO"}
                      disabled={!d || loading}
                      onChange={(e) => d && setDocument(d, e.target.checked)}
                    />
                    {label(type)}
                    {d &&
                    draft[d.id_documento] !== undefined &&
                    draft[d.id_documento] !== d.estatus_documento
                      ? " (Pendiente)"
                      : ""}
                  </label>
                );
              })}
            </div>

            <p>
              <strong>Estatus documental: </strong>
              <span className={statusClass(status(expanded))}>
                {label(status(expanded))}
              </span>
            </p>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={save}
                disabled={loading || !changedForShipment(expanded)}
              >
                {loading ? "Guardando..." : "Guardar"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setExpanded(null)}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
