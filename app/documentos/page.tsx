"use client";

import { useEffect, useMemo, useState } from "react";
import { statusClass } from "@/app/lib/session";

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

type User = {
  id_usuario: number;
  nombre_completo: string;
  rol: string;
  departamento: string;
  activo: number | boolean;
};

const order = ["BOL", "FACTURA", "CARTA_PORTE", "LISTA_EMPAQUE"];

function label(v: string) {
  return v.replaceAll("_", " ");
}

export default function Page() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [operators, setOperators] = useState<User[]>([]);
  const [uid, setUid] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  async function load() {
    const [a, b, c] = await Promise.all([
      fetch("/api/operaciones/envios", { cache: "no-store" }),
      fetch("/api/operaciones/documentos", { cache: "no-store" }),
      fetch("/api/operaciones/usuarios", { cache: "no-store" }),
    ]);
    if (!a.ok || !b.ok || !c.ok)
      throw new Error("No se pudieron cargar envíos, documentos o usuarios.");
    const [s, d, u] = await Promise.all([a.json(), b.json(), c.json()]);
    setShipments(Array.isArray(s) ? s : []);
    setDocs(Array.isArray(d) ? d : []);
    setOperators(
      (Array.isArray(u) ? (u as User[]) : []).filter(
        (x) =>
          (x.activo === true || Number(x.activo) === 1) &&
          String(x.rol).toUpperCase() === "OPERADOR" &&
          String(x.departamento).toUpperCase() === "TRAFICO"
      )
    );
    setDraft({});
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

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

  const filteredShipments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shipments.filter((s) => {
      const st = status(s.id_envio);
      if (statusFilter !== "ALL" && st !== statusFilter) return false;
      if (!q) return true;
      return (
        s.codigo_envio.toLowerCase().includes(q) ||
        s.nombre_cliente.toLowerCase().includes(q)
      );
    });
  }, [shipments, grouped, draft, search, statusFilter]);

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
    if (!uid) {
      setMsg("Selecciona un operador de Tráfico activo.");
      return;
    }
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
            actualizado_por: Number(uid),
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
      setUid("");
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
            msg.toLowerCase().includes("no se pudo") ||
            msg.toLowerCase().includes("selecciona")
              ? "error"
              : ""
          }`}
        >
          {msg}
        </p>
      )}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Buscar por envío o cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">Todos los estatus</option>
          <option value="EN PROGRESO">EN PROGRESO</option>
          <option value="LISTO">LISTO</option>
        </select>
      </div>

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
            {filteredShipments.map((s) => (
              <tr
                key={s.id_envio}
                onClick={() => {
                  setExpanded(s.id_envio);
                  setUid("");
                }}
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
                      setUid("");
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
            {!filteredShipments.length && (
              <tr>
                <td colSpan={4} className="muted">
                  No se encontraron envíos con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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

            <label className="field">
              Operador de Tráfico
              <select
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                required
              >
                <option value="">Seleccionar operador de Tráfico activo</option>
                {operators.map((u) => (
                  <option key={u.id_usuario} value={u.id_usuario}>
                    {u.nombre_completo}
                  </option>
                ))}
              </select>
            </label>

            {!operators.length && (
              <p className="muted">
                No hay operadores activos en el departamento TRAFICO.
              </p>
            )}

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
                disabled={
                  loading ||
                  !uid ||
                  !operators.length ||
                  !changedForShipment(expanded)
                }
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

