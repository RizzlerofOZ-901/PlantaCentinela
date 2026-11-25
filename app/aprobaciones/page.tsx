"use client";

import { useEffect, useMemo, useState } from "react";
import { statusClass } from "@/app/lib/session";

type Row = Record<string, unknown>;
type User = {
  id_usuario: number;
  nombre_completo: string;
  rol: string;
  activo: number | boolean;
};

function active(v: unknown) {
  return v === true || Number(v) === 1;
}

function display(v: unknown) {
  return String(v ?? "—").replaceAll("_", " ");
}

export default function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [uid, setUid] = useState("");
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  async function load() {
    const [shipmentResponse, userResponse] = await Promise.all([
      fetch("/api/operaciones/envios", { cache: "no-store" }),
      fetch("/api/operaciones/usuarios", { cache: "no-store" }),
    ]);
    if (!shipmentResponse.ok || !userResponse.ok)
      throw new Error("Error cargando envíos o usuarios.");
    const [shipments, userRows] = await Promise.all([
      shipmentResponse.json(),
      userResponse.json(),
    ]);
    setRows(Array.isArray(shipments) ? shipments : []);
    setUsers(Array.isArray(userRows) ? userRows : []);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  const supervisors = users.filter(
    (u) => active(u.activo) && String(u.rol).toUpperCase() === "SUPERVISOR"
  );

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
    if (!uid) {
      setMsg("Selecciona un supervisor activo.");
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
          id_supervisor: Number(uid),
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
          Supervisor
          <select value={uid} onChange={(e) => setUid(e.target.value)} required>
            <option value="">Seleccionar supervisor activo</option>
            {supervisors.map((u) => (
              <option key={u.id_usuario} value={u.id_usuario}>
                {u.nombre_completo}
              </option>
            ))}
          </select>
        </label>
        {!supervisors.length && (
          <p className="muted">
            No hay supervisores activos. Revisa que el usuario tenga rol
            SUPERVISOR y esté activo.
          </p>
        )}
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
              msg.toLowerCase().includes("no se pudo")
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
                      disabled={!uid || busy === id}
                      onClick={() => decide(id, "APROBADO")}
                    >
                      {busy === id ? "Guardando..." : "Aprobar"}
                    </button>
                    <button
                      type="button"
                      className="button-reject"
                      disabled={!uid || busy === id}
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

