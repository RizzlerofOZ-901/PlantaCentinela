"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canCreateShipment,
  fmtDateTime,
  getSessionUser,
  statusClass,
} from "@/app/lib/session";

type Row = Record<string, any>;

type FormState = {
  cliente_existente: string;
  nombre_cliente: string;
  direccion_destino: string;
  distancia_km: string;
  fecha_pedido: string;
  carga_date: string;
  carga_hour: string;
  carga_min: string;
  carga_ampm: "AM" | "PM";
  creado_por: string;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const blank: FormState = {
  cliente_existente: "__nuevo__",
  nombre_cliente: "",
  direccion_destino: "",
  distancia_km: "",
  fecha_pedido: todayISO(),
  carga_date: todayISO(),
  carga_hour: "8",
  carga_min: "00",
  carga_ampm: "AM",
  creado_por: "",
};

const TRAILERS = Array.from(
  { length: 10 },
  (_, i) => `TRL-${String(i + 1).padStart(3, "0")}`
);

function show(value: unknown) {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function statusLabel(value: unknown) {
  return String(value ?? "EN_ORIGEN").replaceAll("_", " ");
}

function buildDateFrom12h(
  dateStr: string,
  hour12: string,
  minute: string,
  ampm: "AM" | "PM"
): Date | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  let h = Number(hour12);
  const min = Number(minute);
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return new Date(y, m - 1, d, h, min, 0);
}

function toSqlDateTime(dt: Date | null): string | null {
  if (!dt) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}:00`;
}

export default function Envios() {
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [form, setForm] = useState<FormState>(blank);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [allowCreate, setAllowCreate] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  async function load() {
    const [sr, ur] = await Promise.all([
      fetch("/api/operaciones/envios", { cache: "no-store" }),
      fetch("/api/operaciones/usuarios", { cache: "no-store" }),
    ]);
    if (!sr.ok || !ur.ok)
      throw new Error("No se pudieron cargar los envíos o usuarios.");
    const [s, u] = await Promise.all([sr.json(), ur.json()]);
    setRows(Array.isArray(s) ? s : []);
    setUsers(Array.isArray(u) ? u : []);
  }

  useEffect(() => {
    setAllowCreate(canCreateShipment(getSessionUser()));
    load().catch((e) => setError(e.message));
  }, []);

  const allowedCreators = useMemo(() => {
    return users.filter((u) => {
      const isActive = Number(u.activo) === 1 || u.activo === true;
      const rol = String(u.rol ?? "").toUpperCase();
      const dep = String(u.departamento ?? "").toUpperCase();
      return (
        isActive &&
        (rol === "SUPERVISOR" || (rol === "OPERADOR" && dep === "TRAFICO"))
      );
    });
  }, [users]);

  const cargaDateObj = useMemo(
    () =>
      buildDateFrom12h(
        form.carga_date,
        form.carga_hour,
        form.carga_min,
        form.carga_ampm
      ),
    [form.carga_date, form.carga_hour, form.carga_min, form.carga_ampm]
  );

  const despachoDateObj = useMemo(
    () =>
      cargaDateObj
        ? new Date(cargaDateObj.getTime() + 4 * 60 * 60 * 1000)
        : null,
    [cargaDateObj]
  );

  const entregaDateObj = useMemo(
    () =>
      cargaDateObj
        ? new Date(cargaDateObj.getTime() + 8 * 60 * 60 * 1000)
        : null,
    [cargaDateObj]
  );

  const clients = useMemo(() => {
    const map = new Map<string, Row>();
    rows.forEach((r) => {
      const name = String(r.nombre_cliente ?? "").trim();
      if (name && !map.has(name)) map.set(name, r);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [rows]);

  const occupied = useMemo(
    () =>
      new Set(
        rows
          .filter(
            (r) =>
              !["ENTREGADO", "CANCELADO", "RECHAZADO"].includes(
                String(r.estatus_general)
              )
          )
          .map((r) => String(r.codigo_trailer ?? ""))
          .filter(Boolean)
      ),
    [rows]
  );

  const free = TRAILERS.filter((t) => !occupied.has(t)).length;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const st = String(r.estatus_general ?? "").toUpperCase();
      if (statusFilter !== "ALL" && st !== statusFilter) return false;
      if (!q) return true;
      return (
        String(r.codigo_envio ?? "").toLowerCase().includes(q) ||
        String(r.nombre_cliente ?? "").toLowerCase().includes(q) ||
        String(r.codigo_trailer ?? "").toLowerCase().includes(q) ||
        String(r.creador_nombre ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  function change(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm((old) => ({ ...old, [name]: value }));
  }

  function chooseClient(e: React.ChangeEvent<HTMLSelectElement>) {
    const name = e.target.value;
    if (name === "__nuevo__") {
      setForm((old) => ({
        ...old,
        cliente_existente: name,
        nombre_cliente: "",
        direccion_destino: "",
        distancia_km: "",
      }));
      return;
    }
    const selected = clients.find(([n]) => n === name)?.[1];
    setForm((old) => ({
      ...old,
      cliente_existente: name,
      nombre_cliente: name,
      direccion_destino: String(selected?.direccion_destino ?? ""),
      distancia_km: String(selected?.distancia_km ?? ""),
    }));
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/operaciones/envios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre_cliente: form.nombre_cliente.trim(),
          direccion_destino: form.direccion_destino.trim(),
          distancia_km: Number(form.distancia_km),
          fecha_pedido: form.fecha_pedido,
          fecha_carga_programada: toSqlDateTime(cargaDateObj),
          fecha_despacho_programada: toSqlDateTime(despachoDateObj),
          fecha_entrega_estimada: toSqlDateTime(entregaDateObj),
          creado_por: Number(form.creado_por),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "No se pudo crear el envío.");
      setMessage(
        `Envío ${result.codigo_envio} creado con estado CREADO${
          result.codigo_trailer
            ? ` y trailer ${result.codigo_trailer}`
            : " (sin trailer disponible)"
        }.`
      );
      setForm({ ...blank, fecha_pedido: todayISO(), carga_date: todayISO() });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear el envío.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <header>
        <div>
          <h1>Envíos</h1>
          <p className="muted">
            {free} de {TRAILERS.length} trailers disponibles
          </p>
        </div>
        <button
          type="button"
          disabled={!allowCreate}
          title={
            !allowCreate ? "Tu perfil no tiene permiso para crear envíos" : ""
          }
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Cerrar formulario" : "+ Crear envío"}
        </button>
      </header>

      {message && <p className="message">{message}</p>}
      {error && <p className="message error">{error}</p>}

      {showForm && allowCreate && (
        <form className="panel" onSubmit={save}>
          <h2>Nuevo envío</h2>
          <p className="muted">
            El código, trailer y estado inicial se asignan automáticamente.
            Despacho (+4 h) y Entrega (+8 h) se calculan desde Carga programada.
          </p>

          <div className="formgrid">
            <label className="field">
              Cliente
              <select
                name="cliente_existente"
                value={form.cliente_existente}
                onChange={chooseClient}
              >
                <option value="__nuevo__">
                  Nuevo cliente / capturar manualmente
                </option>
                {clients.map(([name]) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Nombre del cliente
              <input
                name="nombre_cliente"
                value={form.nombre_cliente}
                onChange={change}
                required
                readOnly={form.cliente_existente !== "__nuevo__"}
              />
            </label>

            <label className="field">
              Dirección destino
              <input
                name="direccion_destino"
                value={form.direccion_destino}
                onChange={change}
                required
              />
            </label>

            <label className="field">
              Distancia (km)
              <input
                name="distancia_km"
                type="number"
                min="0"
                step="0.01"
                value={form.distancia_km}
                onChange={change}
                required
              />
            </label>

            <label className="field">
              Fecha del pedido
              <input
                name="fecha_pedido"
                type="date"
                value={form.fecha_pedido}
                onChange={change}
                required
              />
            </label>

            <div className="field">
              <span>Carga programada (Fecha y Hora 12h)</span>
              <div className="datetime-12h">
                <input
                  name="carga_date"
                  type="date"
                  value={form.carga_date}
                  onChange={change}
                  required
                />
                <select
                  name="carga_hour"
                  value={form.carga_hour}
                  onChange={change}
                >
                  {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(
                    (h) => (
                      <option key={h} value={h}>
                        {h.padStart(2, "0")}
                      </option>
                    )
                  )}
                </select>
                <select
                  name="carga_min"
                  value={form.carga_min}
                  onChange={change}
                >
                  {["00", "15", "30", "45"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  name="carga_ampm"
                  value={form.carga_ampm}
                  onChange={change}
                >
                  <option value="AM">a.m.</option>
                  <option value="PM">p.m.</option>
                </select>
              </div>
            </div>

            <label className="field">
              Despacho programado (+4 horas automático)
              <input value={fmtDateTime(despachoDateObj)} readOnly />
            </label>

            <label className="field">
              Entrega programada (+8 horas automático)
              <input value={fmtDateTime(entregaDateObj)} readOnly />
            </label>

            <label className="field">
              Creado por (Supervisor u Operador Tráfico)
              <select
                name="creado_por"
                value={form.creado_por}
                onChange={change}
                required
              >
                <option value="">Seleccionar usuario</option>
                {allowedCreators.map((u) => (
                  <option key={u.id_usuario} value={u.id_usuario}>
                    {u.nombre_completo} ({u.rol} - {u.departamento})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p>
            <button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar envío"}
            </button>{" "}
            <button
              type="button"
              className="secondary"
              onClick={() => setShowForm(false)}
              disabled={loading}
            >
              Cancelar
            </button>
          </p>
        </form>
      )}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Buscar por envío, cliente, trailer o creador..."
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
              <th>Trailer</th>
              <th>Estado general</th>
              <th>Despacho</th>
              <th>Entrega</th>
              <th>Creador</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.id_envio}>
                <td style={{ fontWeight: 700 }}>{show(r.codigo_envio)}</td>
                <td>{show(r.nombre_cliente)}</td>
                <td>{show(r.codigo_trailer)}</td>
                <td>
                  <span className={statusClass(r.estatus_general)}>
                    {statusLabel(r.estatus_general)}
                  </span>
                </td>
                <td>{fmtDateTime(r.fecha_despacho_programada)}</td>
                <td>{fmtDateTime(r.fecha_entrega_estimada)}</td>
                <td>{show(r.creador_nombre)}</td>
              </tr>
            ))}
            {!filteredRows.length && (
              <tr>
                <td colSpan={7} className="muted">
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


