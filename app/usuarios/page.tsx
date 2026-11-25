"use client";

import { useEffect, useState } from "react";
import { fmtDateTime, getSessionUser } from "@/app/lib/session";

type U = Record<string, any>;

const ROLES = ["OPERADOR", "SUPERVISOR", "AUDITOR"] as const;
const OPERATOR_DEPS = ["TRAFICO", "TRACKING", "INSPECCION"] as const;

export default function Page() {
  const [rows, setRows] = useState<U[]>([]);
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [f, setF] = useState({
    nombre_completo: "",
    correo: "",
    clave: "",
    rol: "OPERADOR",
    departamento: "TRAFICO",
  });

  async function load() {
    const res = await fetch("/api/operaciones/usuarios", { cache: "no-store" });
    setRows(await res.json());
  }

  useEffect(() => {
    load().catch(() => setMsg("Error cargando usuarios"));
  }, []);

  function change(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    if (name === "rol") {
      const autoDept =
        value === "SUPERVISOR"
          ? "EMBARQUES"
          : value === "AUDITOR"
            ? "ADMINISTRACION"
            : "TRAFICO";
      setF((old) => ({ ...old, rol: value, departamento: autoDept }));
      return;
    }
    setF((old) => ({ ...old, [name]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const current = getSessionUser();
    const r = await fetch("/api/operaciones/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...f,
        actor_nombre: current?.nombre_completo || "Administrador",
      }),
    });
    const d = await r.json();
    setMsg(r.ok ? "Usuario creado." : d.error || "Error al crear usuario.");
    if (r.ok) {
      setShow(false);
      setF({
        nombre_completo: "",
        correo: "",
        clave: "",
        rol: "OPERADOR",
        departamento: "TRAFICO",
      });
      await load();
    }
  }

  async function handleDelete(u: U) {
    const id = Number(u.id_usuario);
    if (!window.confirm(`¿Eliminar al usuario "${u.nombre_completo}"?`)) return;

    const current = getSessionUser();
    setBusyId(id);
    setMsg("");
    try {
      const r = await fetch("/api/operaciones/usuarios", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_usuario: id,
          actor_nombre: current?.nombre_completo || "Administrador",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo eliminar el usuario.");
      setMsg(
        d.softDeleted
          ? `Usuario ${u.nombre_completo} desactivado (tiene aprobaciones registradas) y auditado en MongoDB.`
          : `Usuario ${u.nombre_completo} eliminado y registrado en Auditoría.`
      );
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al eliminar.");
    } finally {
      setBusyId(null);
    }
  }

  const isAutoDept = f.rol === "SUPERVISOR" || f.rol === "AUDITOR";

  return (
    <section>
      <header>
        <h1>Usuarios</h1>
        <button type="button" onClick={() => setShow(!show)}>
          {show ? "Cerrar formulario" : "+ Crear usuario"}
        </button>
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

      {show && (
        <form className="panel" onSubmit={save}>
          <div className="formgrid">
            <label className="field">
              Nombre
              <input
                required
                name="nombre_completo"
                value={f.nombre_completo}
                onChange={change}
              />
            </label>
            <label className="field">
              Correo
              <input
                required
                type="email"
                name="correo"
                value={f.correo}
                onChange={change}
              />
            </label>
            <label className="field">
              Contraseña inicial
              <input
                required
                minLength={8}
                type="password"
                name="clave"
                value={f.clave}
                onChange={change}
              />
            </label>
            <label className="field">
              Rol
              <select name="rol" value={f.rol} onChange={change}>
                {ROLES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Departamento
              {isAutoDept ? (
                <input name="departamento" value={f.departamento} readOnly />
              ) : (
                <select
                  name="departamento"
                  value={f.departamento}
                  onChange={change}
                >
                  {OPERATOR_DEPS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>
          <p>
            <button type="submit">Guardar usuario</button>
          </p>
        </form>
      )}

      <div className="panel responsive-table">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Departamento</th>
              <th>Activo</th>
              <th>Creación</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = Number(r.id_usuario);
              return (
                <tr key={String(id)}>
                  <td>{id}</td>
                  <td>{String(r.nombre_completo ?? "")}</td>
                  <td>{String(r.correo ?? "")}</td>
                  <td>{String(r.rol ?? "")}</td>
                  <td>{String(r.departamento ?? "")}</td>
                  <td>
                    {Number(r.activo) === 1 || r.activo === true ? "Sí" : "No"}
                  </td>
                  <td>{fmtDateTime(r.fecha_creacion)}</td>
                  <td>
                    <button
                      type="button"
                      className="button-reject"
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                      disabled={busyId === id}
                      onClick={() => handleDelete(r)}
                    >
                      {busyId === id ? "Eliminando..." : "Eliminar"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="muted">
                  Sin usuarios registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
