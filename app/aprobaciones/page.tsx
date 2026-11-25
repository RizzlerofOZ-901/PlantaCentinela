"use client";

import { useEffect, useMemo, useState } from "react";
import { getSessionUser, statusClass, type SessionUser } from "@/app/lib/session";

type Row = Record<string, unknown>;

function display(v: unknown) {
  return String(v ?? "—").replaceAll("_", " ");
}

export default function Page() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  async function load() {
    const shipmentResponse = await fetch("/api/operaciones/envios", {
      cache: "no-store",
    });
    if (!shipmentResponse.ok) throw new Error("Error cargando envíos.");
    const shipments = await shipmentResponse.json();
    setRows(Array.isArray(shipments) ? shipments : []);
  }

  useEffect(() => {
    setUser(getSessionUser());
    load().catch((e) => setMsg(e.message));
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const st = String(r.estatus_general ?? "").toUpperCase();
      if (statusFilter !== "ALL" && st !== statusFilter) return false;
      if (!q) return true;
      return (
        String(r.codigo_envio ?? "").toLowerCase().includes(q) ||
        String(r.nombre_cliente ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  async function decide(id: number, decision: "APROBADO" | "RECHAZADO") {
    if (!user) {
      setMsg("No hay una sesión activa.");
      return;
    }
    setBusy(id);
    setMsg("");
    try {
      const response = await fetch("/api/operaciones/aprobaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_envio: id,
          id_supervisor: user.id_usuario,
          is_admin: Boolean(user.isAdmin),
          actor_nombre: user.nombre_completo,
          decision,
          comentarios: comment,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "No se pudo guardar la decisión.");
      setMsg(`Decisión guardada: ${display(decision)}.`);
      setComment("");
      await load();
    } catch (e) {
      setMsg(
        e instanceof Error ? e.message : "Error al guardar la decisión."
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <header>
        <h1>Aprobaciones</h1>
      </header>

      <div className="panel">
        <label className="field">
          Supervisor (Sesión activa)
          <input
            value={
              user
                ? `${user.nombre_completo} (${user.rol} · ${user.departamento})`
                : "Sin sesión"
            }
            readOnly
          />
        </label>
        <label className="field">
          Comentarios
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        {msg && (
          <p
            className={`message ${
              msg.toLowerCase().includes("error") ||
              msg.toLowerCase().includes("no se pudo") ||
              msg.toLowerCase().includes("se requieren") ||
              msg.toLowerCase().includes("solo un supervisor")
                ? "error"
                : ""
            }`}
          >
            {msg}
          </p>
        )}
      </div>

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
          <option value="CREADO">CREADO</option>
          <option value="CARGANDO">CARGANDO</option>
          <option value="EN_TRANSITO">EN TRÁNSITO</option>
          <option value="ENTREGADO">ENTREGADO</option>
          <option value="RECHAZADO">RECHAZADO</option>
        </select>
      </div>

      <div className="panel responsive-table">
        <table>
          <thead>
            <tr>
              <th>Envío</th>
              <th>Cliente</th>
              <th>Docs</th>
              <th>Carga</th>
              <th>Ruta</th>
              <th>Decisión</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => {
              const id = Number(r.id_envio);
              return (
                <tr key={String(r.id_envio)}>
                  <td style={{ fontWeight: 700 }}>
                    {String(r.codigo_envio ?? "—")}
                  </td>
                  <td>{String(r.nombre_cliente ?? "—")}</td>
                  <td>
                    <span className={statusClass(r.estatus_documentacion)}>
                      {display(r.estatus_documentacion)}
                    </span>
                  </td>
                  <td>
                    <span className={statusClass(r.estatus_carga)}>
                      {display(r.estatus_carga)}
                    </span>
                  </td>
                  <td>
                    <span className={statusClass(r.estatus_ruta)}>
                      {display(r.estatus_ruta)}
                    </span>
                  </td>
                  <td className="approval-actions">
                    <button
                      type="button"
                      className="button-approve"
                      disabled={!user || busy === id}
                      onClick={() => decide(id, "APROBADO")}
                    >
                      {busy === id ? "Guardando..." : "Aprobar"}
                    </button>
                    <button
                      type="button"
                      className="button-reject"
                      disabled={!user || busy === id}
                      onClick={() => decide(id, "RECHAZADO")}
                    >
                      Rechazar
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filteredRows.length && (
              <tr>
                <td colSpan={6} className="muted">
                  No se encontraron envíos con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
