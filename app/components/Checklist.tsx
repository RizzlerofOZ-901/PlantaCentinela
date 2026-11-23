"use client";

import { useEffect, useMemo, useState } from "react";

type Kind = "riesgo" | "inspeccion";
type Shipment = {
  id_envio: number;
  codigo_envio: string;
  nombre_cliente: string;
  direccion_destino: string;
  distancia_km: number;
  codigo_trailer: string | null;
  estatus_general: string;
  fecha_despacho_programada: string | null;
  fecha_entrega_estimada: string | null;
};
type User = {
  id_usuario: number;
  nombre_completo: string;
  departamento: string;
  activo: number | boolean;
};
type Eval = Record<string, any> & {
  id_envio: number;
  resultado_ruta?: string;
  resultado_carga?: string;
};

const risk: [string, string][] = [
  ["carretera_danada", "Carretera dañada"],
  ["clima_adverso", "Clima adverso"],
  ["trafico_intenso", "Tráfico intenso"],
  ["incidente_reportado", "Incidente reportado"],
  ["retraso_probable", "Retraso probable"],
];

const cargo: [string, string][] = [
  ["material_coincide", "Material coincide"],
  ["distribucion_correcta", "Distribución correcta"],
  ["embalaje_adecuado", "Embalaje adecuado"],
  ["carga_asegurada", "Carga asegurada"],
];

function date(v: unknown) {
  if (!v) return "—";
  const s = String(v).slice(0, 10),
    p = s.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
}

function active(v: unknown) {
  return v === true || Number(v) === 1;
}

export default function Checklist({ kind }: { kind: Kind }) {
  const isRisk = kind === "riesgo",
    endpoint = isRisk ? "riesgo" : "inspeccion",
    fields = isRisk ? risk : cargo;
  const [ship, setShip] = useState<Shipment[]>([]),
    [records, setRecords] = useState<Eval[]>([]),
    [inspectors, setInspectors] = useState<User[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null),
    [uid, setUid] = useState(""),
    [checks, setChecks] = useState<Record<string, boolean>>({}),
    [notes, setNotes] = useState(""),
    [msg, setMsg] = useState(""),
    [saving, setSaving] = useState(false);

  async function load() {
    const [a, b, c] = await Promise.all([
      fetch("/api/operaciones/envios", { cache: "no-store" }),
      fetch(`/api/operaciones/${endpoint}`, { cache: "no-store" }),
      fetch("/api/operaciones/usuarios", { cache: "no-store" }),
    ]);
    if (!a.ok || !b.ok || !c.ok)
      throw new Error(
        "No se pudieron cargar envíos, evaluaciones o inspectores."
      );
    const [s, r, u] = await Promise.all([a.json(), b.json(), c.json()]);
    setShip(s);
    setRecords(r);
    setInspectors(
      (u as User[]).filter(
        (x) =>
          active(x.activo) &&
          String(x.departamento).toUpperCase() === "INSPECCION"
      )
    );
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [endpoint]);

  // Close modal with Escape key
  useEffect(() => {
    if (expanded === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const latest = useMemo(() => {
    const m = new Map<number, Eval>();
    for (const r of records) {
      const old = m.get(Number(r.id_envio));
      const dt = String(r.fecha_inspeccion || r.fecha_evaluacion || "");
      const od = String(old?.fecha_inspeccion || old?.fecha_evaluacion || "");
      if (!old || dt >= od) m.set(Number(r.id_envio), r);
    }
    return m;
  }, [records]);

  function open(id: number) {
    setExpanded(id);
    setUid("");
    setChecks({});
    setNotes("");
    setMsg("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const s = ship.find((x) => x.id_envio === expanded);
    if (!s) return;
    if (!uid) {
      setMsg("Selecciona un inspector activo.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        id_envio: s.id_envio,
        observaciones: notes,
        ...(isRisk
          ? {
              id_evaluador: Number(uid),
              destino_evaluado: s.direccion_destino,
              distancia_km: s.distancia_km,
            }
          : { id_inspector: Number(uid) }),
        ...Object.fromEntries(
          fields.map(([k]) => [k, checks[k] === true ? 1 : 0])
        ),
      };
      const r = await fetch(`/api/operaciones/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo guardar.");
      setMsg("Evaluación guardada.");
      setExpanded(null);
      setChecks({});
      setNotes("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  const activeShipment =
    expanded !== null
      ? ship.find((s) => s.id_envio === expanded) ?? null
      : null;

  return (
    <section>
      <header>
        <div>
          <h1>{isRisk ? "Riesgos de ruta" : "Inspección de mercancía"}</h1>
          <p className="muted">
            Selecciona un envío de la tabla para abrir su evaluación.
          </p>
        </div>
      </header>

      {msg && <p className="message">{msg}</p>}

      {/* SHIPMENTS TABLE */}
      <div className="panel responsive-table">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Cliente</th>
              <th>Trailer</th>
              <th>Estado general</th>
              <th>Despacho</th>
              <th>Entrega</th>
            </tr>
          </thead>
          <tbody>
            {ship.map((s) => (
              <tr
                key={s.id_envio}
                onClick={() => open(s.id_envio)}
                className={expanded === s.id_envio ? "selected-row" : ""}
                style={{ cursor: "pointer" }}
              >
                <td>
                  <button
                    type="button"
                    className="table-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      open(s.id_envio);
                    }}
                  >
                    {s.codigo_envio}
                  </button>
                </td>
                <td>{s.nombre_cliente}</td>
                <td>{s.codigo_trailer || "Sin asignar"}</td>
                <td>
                  {String(s.estatus_general || "EN_ORIGEN").replaceAll(
                    "_",
                    " "
                  )}
                </td>
                <td>{date(s.fecha_despacho_programada)}</td>
                <td>{date(s.fecha_entrega_estimada)}</td>
              </tr>
            ))}
            {!ship.length && (
              <tr>
                <td colSpan={6}>Todavía no hay envíos.</td>
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
          <form
            className="centinela-card detail-panel modal-dialog"
            onSubmit={save}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-heading">
              <div>
                <h2>
                  {activeShipment.codigo_envio} —{" "}
                  {isRisk ? "Evaluación de ruta" : "Inspección de carga"}
                </h2>
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
              Inspector / evaluador
              <select
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                required
              >
                <option value="">Seleccionar inspector activo</option>
                {inspectors.map((u) => (
                  <option key={u.id_usuario} value={u.id_usuario}>
                    {u.nombre_completo}
                  </option>
                ))}
              </select>
            </label>

            {!inspectors.length && (
              <p className="muted">
                No hay usuarios activos en el departamento INSPECCION. Activa o
                asigna un usuario a ese departamento.
              </p>
            )}

            <h3>Checklist</h3>
            <div className="checks">
              {fields.map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={!!checks[key]}
                    onChange={(e) =>
                      setChecks((old) => ({ ...old, [key]: e.target.checked }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>

            <label className="field">
              Observaciones
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            <p className="muted">
              El estado general cambia automáticamente a CARGANDO al guardar una
              evaluación, salvo que el envío ya esté en tránsito o entregado.
            </p>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button type="submit" disabled={saving || !inspectors.length}>
                {saving ? "Guardando..." : "Guardar evaluación"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setExpanded(null)}
                disabled={saving}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
