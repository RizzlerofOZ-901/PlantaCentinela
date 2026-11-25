"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canCreateShipment,
  fmtDateTime,
  getSessionUser,
  statusClass,
  type SessionUser,
} from "@/app/lib/session";

type Row = Record<string, any>;

type DateTimeParts = {
  date: string;
  hour: string;
  min: string;
  ampm: "AM" | "PM";
};

type FormState = {
  cliente_existente: string;
  nombre_cliente: string;
  direccion_destino: string;
  distancia_km: string;
  fecha_pedido: string;
  carga: DateTimeParts;
  despacho: DateTimeParts;
  entrega: DateTimeParts;
};

const emptyDT: DateTimeParts = { date: "", hour: "8", min: "00", ampm: "AM" };

const blank: FormState = {
  cliente_existente: "__nuevo__",
  nombre_cliente: "",
  direccion_destino: "",
  distancia_km: "",
  fecha_pedido: "",
  carga: { ...emptyDT },
  despacho: { ...emptyDT },
  entrega: { ...emptyDT },
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

function partsToDate(p: DateTimeParts): Date | null {
  if (!p.date) return null;
  const [y, m, d] = p.date.split("-").map(Number);
  if (!y || !m || !d) return null;
  let h = Number(p.hour);
  const min = Number(p.min);
  if (p.ampm === "PM" && h !== 12) h += 12;
  if (p.ampm === "AM" && h === 12) h = 0;
  return new Date(y, m - 1, d, h, min, 0);
}

function dateToParts(dt: Date): DateTimeParts {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const rawHour = dt.getHours();
  const ampm: "AM" | "PM" = rawHour >= 12 ? "PM" : "AM";
  let hour12 = rawHour % 12;
  if (hour12 === 0) hour12 = 12;
  const min = pad(dt.getMinutes());
  return { date, hour: String(hour12), min, ampm };
}

function toSqlDateTime(dt: Date | null): string | null {
  if (!dt) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}:00`;
}

export default function Envios() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<FormState>(blank);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [allowCreate, setAllowCreate] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  async function load() {
    const sr = await fetch("/api/operaciones/envios", { cache: "no-store" });
    if (!sr.ok) throw new Error("No se pudieron cargar los envíos.");
    const s = await sr.json();
    setRows(Array.isArray(s) ? s : []);
  }

  useEffect(() => {
    const current = getSessionUser();
    setUser(current);
    setAllowCreate(canCreateShipment(current));
    load().catch((e) => setError(e.message));
  }, []);

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
  const noTrailers = free === 0;

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

  // Updating Carga auto-recommends Despacho (+4h) and Entrega (+8h)
  function updateCarga(field: keyof DateTimeParts, value: string) {
    setForm((old) => {
      const nextCarga = { ...old.carga, [field]: value } as DateTimeParts;
      const cargaDt = partsToDate(nextCarga);
      if (!cargaDt) {
        return { ...old, carga: nextCarga };
      }
      const recDespacho = new Date(cargaDt.getTime() + 4 * 60 * 60 * 1000);
      const recEntrega = new Date(cargaDt.getTime() + 8 * 60 * 60 * 1000);
      return {
        ...old,
        carga: nextCarga,
        despacho: dateToParts(recDespacho),
        entrega: dateToParts(recEntrega),
      };
    });
  }

  function updateDespacho(field: keyof DateTimeParts, value: string) {
    setForm((old) => ({
      ...old,
      despacho: { ...old.despacho, [field]: value } as DateTimeParts,
    }));
  }

  function updateEntrega(field: keyof DateTimeParts, value: string) {
    setForm((old) => ({
      ...old,
      entrega: { ...old.entrega, [field]: value } as DateTimeParts,
    }));
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
    setMessage("");
    setError("");

    if (noTrailers) {
      setError("No se puede crear el envío, no hay trailers disponibles");
      return;
    }

    const cargaDt = partsToDate(form.carga);
    const despachoDt = partsToDate(form.despacho);
    const entregaDt = partsToDate(form.entrega);

    // Date sequence logic checks
    if (cargaDt && despachoDt && despachoDt.getTime() < cargaDt.getTime()) {
      setError(
        "El despacho programado no puede ser anterior a la carga programada."
      );
      return;
    }
    if (cargaDt && entregaDt && entregaDt.getTime() < cargaDt.getTime()) {
      setError(
        "La entrega programada no puede ser anterior a la carga programada."
      );
      return;
    }
    if (despachoDt && entregaDt && entregaDt.getTime() < despachoDt.getTime()) {
      setError(
        "La entrega programada no puede ser anterior al despacho programado."
      );
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/operaciones/envios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre_cliente: form.nombre_cliente.trim(),
          direccion_destino: form.direccion_destino.trim(),
          distancia_km: Number(form.distancia_km),
          fecha_pedido: form.fecha_pedido,
          fecha_carga_programada: toSqlDateTime(cargaDt),
          fecha_despacho_programada: toSqlDateTime(despachoDt),
          fecha_entrega_estimada: toSqlDateTime(entregaDt),
          creado_por: user && user.id_usuario > 0 ? user.id_usuario : null,
          actor_nombre: user?.nombre_completo || "Sistema",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "No se pudo crear el envío.");
      setMessage(
        `Envío ${result.codigo_envio} creado con estado CREADO y trailer ${result.codigo_trailer}.`
      );
      setForm(blank);
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
          disabled={!allowCreate || noTrailers}
          title={
            noTrailers
              ? "No se puede crear el envío, no hay trailers disponibles"
              : !allowCreate
                ? "Tu perfil no tiene permiso para crear envíos"
                : ""
          }
          onClick={() => {
            if (noTrailers) {
              setError("No se puede crear el envío, no hay trailers disponibles");
              return;
            }
            setShowForm((v) => !v);
          }}
        >
          {showForm ? "Cerrar formulario" : "+ Crear envío"}
        </button>
      </header>

      {noTrailers && (
        <p className="message error">
          No se puede crear el envío, no hay trailers disponibles
        </p>
      )}
      {message && <p className="message">{message}</p>}
      {error && <p className="message error">{error}</p>}

      {showForm && allowCreate && !noTrailers && (
        <form className="panel" onSubmit={save}>
          <h2>Nuevo envío</h2>
          <p className="muted">
            Al elegir Carga programada se sugerirán Despacho (+4 h) y Entrega
            (+8 h), pero puedes modificar todas las fechas y horas libremente.
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

            <label className="field">
              Creado por (Sesión activa)
              <input
                value={
                  user
                    ? `${user.nombre_completo} (${user.rol} · ${user.departamento})`
                    : "Sin sesión"
                }
                readOnly
              />
            </label>

            {/* Carga programada (Editable 12h) */}
            <div className="field">
              <span>Carga programada</span>
              <div className="datetime-12h">
                <input
                  type="date"
                  value={form.carga.date}
                  onChange={(e) => updateCarga("date", e.target.value)}
                />
                <select
                  value={form.carga.hour}
                  onChange={(e) => updateCarga("hour", e.target.value)}
                  disabled={!form.carga.date}
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
                  value={form.carga.min}
                  onChange={(e) => updateCarga("min", e.target.value)}
                  disabled={!form.carga.date}
                >
                  {["00", "15", "30", "45"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={form.carga.ampm}
                  onChange={(e) => updateCarga("ampm", e.target.value)}
                  disabled={!form.carga.date}
                >
                  <option value="AM">a.m.</option>
                  <option value="PM">p.m.</option>
                </select>
              </div>
            </div>

            {/* Despacho programado (Auto +4h, Editable 12h) */}
            <div className="field">
              <span>Despacho programado (sugerido +4 h)</span>
              <div className="datetime-12h">
                <input
                  type="date"
                  value={form.despacho.date}
                  onChange={(e) => updateDespacho("date", e.target.value)}
                />
                <select
                  value={form.despacho.hour}
                  onChange={(e) => updateDespacho("hour", e.target.value)}
                  disabled={!form.despacho.date}
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
                  value={form.despacho.min}
                  onChange={(e) => updateDespacho("min", e.target.value)}
                  disabled={!form.despacho.date}
                >
                  {["00", "15", "30", "45"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={form.despacho.ampm}
                  onChange={(e) => updateDespacho("ampm", e.target.value)}
                  disabled={!form.despacho.date}
                >
                  <option value="AM">a.m.</option>
                  <option value="PM">p.m.</option>
                </select>
              </div>
            </div>

            {/* Entrega programada (Auto +8h, Editable 12h) */}
            <div className="field">
              <span>Entrega programada (sugerido +8 h)</span>
              <div className="datetime-12h">
                <input
                  type="date"
                  value={form.entrega.date}
                  onChange={(e) => updateEntrega("date", e.target.value)}
                />
                <select
                  value={form.entrega.hour}
                  onChange={(e) => updateEntrega("hour", e.target.value)}
                  disabled={!form.entrega.date}
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
                  value={form.entrega.min}
                  onChange={(e) => updateEntrega("min", e.target.value)}
                  disabled={!form.entrega.date}
                >
                  {["00", "15", "30", "45"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={form.entrega.ampm}
                  onChange={(e) => updateEntrega("ampm", e.target.value)}
                  disabled={!form.entrega.date}
                >
                  <option value="AM">a.m.</option>
                  <option value="PM">p.m.</option>
                </select>
              </div>
            </div>
          </div>

          <p>
            <button type="submit" disabled={loading || noTrailers}>
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
