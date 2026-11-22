"use client";

import { useEffect, useMemo, useState } from "react";

type Row = Record<string, any>;
type FormState = {
  cliente_existente: string; nombre_cliente: string; direccion_destino: string;
  distancia_km: string; fecha_pedido: string; fecha_carga_programada: string;
  fecha_despacho_programada: string; fecha_entrega_estimada: string; creado_por: string;
};
const blank: FormState = {
  cliente_existente: "__nuevo__", nombre_cliente: "", direccion_destino: "", distancia_km: "",
  fecha_pedido: new Date().toISOString().slice(0, 10), fecha_carga_programada: "",
  fecha_despacho_programada: "", fecha_entrega_estimada: "", creado_por: "",
};
const TRAILERS = Array.from({ length: 10 }, (_, i) => `TRL-${String(i + 1).padStart(3, "0")}`);
function show(value: unknown) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function date(value: unknown) {
  if (!value) return "—";
  const raw = String(value).slice(0, 10);
  const parts = raw.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : raw;
}
function statusLabel(value: unknown) { return String(value ?? "EN_ORIGEN").replaceAll("_", " "); }

export default function Envios() {
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [form, setForm] = useState<FormState>(blank);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [sr, ur] = await Promise.all([
      fetch("/api/operaciones/envios", { cache: "no-store" }),
      fetch("/api/operaciones/usuarios", { cache: "no-store" }),
    ]);
    if (!sr.ok || !ur.ok) throw new Error("No se pudieron cargar los envíos o usuarios.");
    const [s, u] = await Promise.all([sr.json(), ur.json()]);
    setRows(Array.isArray(s) ? s : []); setUsers(Array.isArray(u) ? u : []);
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);

  const clients = useMemo(() => {
    const map = new Map<string, Row>();
    rows.forEach(r => { const name = String(r.nombre_cliente ?? "").trim(); if (name && !map.has(name)) map.set(name, r); });
    return [...map.entries()].sort((a,b) => a[0].localeCompare(b[0], "es"));
  }, [rows]);
  const occupied = useMemo(() => new Set(rows.filter(r => !["ENTREGADO","CANCELADO","RECHAZADO"].includes(String(r.estatus_general)))
    .map(r => String(r.codigo_trailer ?? "")).filter(Boolean)), [rows]);
  const free = TRAILERS.filter(t => !occupied.has(t)).length;

  function change(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target; setForm(old => ({ ...old, [name]: value }));
  }
  function chooseClient(e: React.ChangeEvent<HTMLSelectElement>) {
    const name = e.target.value;
    if (name === "__nuevo__") { setForm(old => ({ ...old, cliente_existente: name, nombre_cliente: "", direccion_destino: "", distancia_km: "" })); return; }
    const selected = clients.find(([n]) => n === name)?.[1];
    setForm(old => ({ ...old, cliente_existente: name, nombre_cliente: name,
      direccion_destino: String(selected?.direccion_destino ?? ""), distancia_km: String(selected?.distancia_km ?? "") }));
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/operaciones/envios", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre_cliente: form.nombre_cliente.trim(), direccion_destino: form.direccion_destino.trim(),
          distancia_km: Number(form.distancia_km), fecha_pedido: form.fecha_pedido,
          fecha_carga_programada: form.fecha_carga_programada || null, fecha_despacho_programada: form.fecha_despacho_programada || null,
          fecha_entrega_estimada: form.fecha_entrega_estimada || null, creado_por: Number(form.creado_por) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "No se pudo crear el envío.");
      setMessage(`Envío ${result.codigo_envio} creado con estado EN ORIGEN${result.codigo_trailer ? ` y trailer ${result.codigo_trailer}` : " (sin trailer disponible)"}.`);
      setForm({ ...blank, fecha_pedido: new Date().toISOString().slice(0,10) }); setShowForm(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Error al crear el envío."); }
    finally { setLoading(false); }
  }

  return <section>
    <header><div><h1>Envíos</h1><p className="muted">{free} de {TRAILERS.length} trailers disponibles</p></div>
      <button type="button" onClick={() => setShowForm(v => !v)}>{showForm ? "Cerrar formulario" : "+ Crear envío"}</button></header>
    {message && <p className="message">{message}</p>}{error && <p className="message error">{error}</p>}
    {showForm && <form className="panel" onSubmit={save}><h2>Nuevo envío</h2><p className="muted">El código, trailer y estado inicial EN ORIGEN se asignan automáticamente.</p>
      <div className="formgrid">
        <label className="field">Cliente<select name="cliente_existente" value={form.cliente_existente} onChange={chooseClient}>
          <option value="__nuevo__">Nuevo cliente / capturar manualmente</option>{clients.map(([name]) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="field">Nombre del cliente<input name="nombre_cliente" value={form.nombre_cliente} onChange={change} required readOnly={form.cliente_existente !== "__nuevo__"}/></label>
        <label className="field">Dirección destino<input name="direccion_destino" value={form.direccion_destino} onChange={change} required/></label>
        <label className="field">Distancia (km)<input name="distancia_km" type="number" min="0" step="0.01" value={form.distancia_km} onChange={change} required/></label>
        <label className="field">Fecha del pedido<input name="fecha_pedido" type="date" value={form.fecha_pedido} onChange={change} required/></label>
        <label className="field">Carga programada<input name="fecha_carga_programada" type="date" value={form.fecha_carga_programada} onChange={change}/></label>
        <label className="field">Despacho programado<input name="fecha_despacho_programada" type="date" value={form.fecha_despacho_programada} onChange={change}/></label>
        <label className="field">Entrega estimada<input name="fecha_entrega_estimada" type="date" value={form.fecha_entrega_estimada} onChange={change}/></label>
        <label className="field">Creado por<select name="creado_por" value={form.creado_por} onChange={change} required><option value="">Seleccionar usuario</option>
          {users.filter(u => Number(u.activo) === 1 || u.activo === true).map(u => <option key={u.id_usuario} value={u.id_usuario}>{u.nombre_completo}</option>)}</select></label>
      </div><p><button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar envío"}</button> <button type="button" className="secondary" onClick={() => setShowForm(false)} disabled={loading}>Cancelar</button></p>
    </form>}
    <div className="panel responsive-table"><table><thead><tr><th>Código</th><th>Cliente</th><th>Trailer</th><th>Estado general</th><th>Despacho</th><th>Entrega</th><th>Creador</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id_envio}><td>{show(r.codigo_envio)}</td><td>{show(r.nombre_cliente)}</td><td>{show(r.codigo_trailer)}</td>
        <td><span className="status-pill">{statusLabel(r.estatus_general)}</span></td><td>{date(r.fecha_despacho_programada)}</td><td>{date(r.fecha_entrega_estimada)}</td><td>{show(r.creador_nombre)}</td></tr>)}
      {!rows.length && <tr><td colSpan={7}>Todavía no hay envíos registrados.</td></tr>}
    </tbody></table></div>
  </section>;
}

