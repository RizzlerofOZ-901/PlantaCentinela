import { NextRequest, NextResponse } from "next/server";
import { initializeTracking } from "@/app/lib/tracking";
import { logAuditEvent } from "@/app/lib/mongodb";
import pool from "@/app/lib/db";
import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

type RequestBody = Record<string, unknown>;
type RouteContext = { params: Promise<{ tipo: string }> };
type SqlScalar = string | number | boolean | null;

type TableConfig = {
  table: string;
  pk: string;
  fields: string[];
};

const config: Record<string, TableConfig> = {
  envios: {
    table: "envios",
    pk: "id_envio",
    fields: [
      "nombre_cliente",
      "direccion_destino",
      "distancia_km",
      "nombre_material",
      "cantidad",
      "unidad_medida",
      "peso_kg",
      "fecha_pedido",
      "fecha_carga_programada",
      "fecha_carga_real",
      "fecha_despacho_programada",
      "fecha_despacho_real",
      "fecha_entrega_estimada",
      "fecha_entrega_real",
      "creado_por",
    ],
  },
  documentos: {
    table: "documentos",
    pk: "id_documento",
    fields: [
      "id_envio",
      "tipo_documento",
      "estatus_documento",
      "codigo_referencia",
      "actualizado_por",
      "observaciones",
    ],
  },
  riesgo: {
    table: "riesgos_ruta",
    pk: "id_riesgo",
    fields: [
      "id_envio",
      "id_evaluador",
      "destino_evaluado",
      "distancia_km",
      "carretera_danada",
      "clima_adverso",
      "trafico_intenso",
      "incidente_reportado",
      "retraso_probable",
      "observaciones",
    ],
  },
  inspeccion: {
    table: "inspecciones_carga",
    pk: "id_inspeccion",
    fields: [
      "id_envio",
      "id_inspector",
      "material_coincide",
      "embalaje_adecuado",
      "distribucion_correcta",
      "carga_asegurada",
      "observaciones",
    ],
  },
  aprobaciones: {
    table: "aprobaciones",
    pk: "id_aprobacion",
    fields: ["id_envio", "id_supervisor", "decision", "comentarios"],
  },
  usuarios: {
    table: "usuarios",
    pk: "id_usuario",
    fields: [
      "nombre_completo",
      "correo",
      "hash_clave",
      "rol",
      "departamento",
      "activo",
    ],
  },
};

const TRAILERS = Array.from(
  { length: 10 },
  (_, index) => `TRL-${String(index + 1).padStart(3, "0")}`
);

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function pickFields(body: RequestBody, allowed: string[]) {
  return Object.fromEntries(
    allowed.filter((field) => field in body).map((field) => [field, body[field]])
  );
}

function sqlValue(value: unknown): SqlScalar {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) return null;
  throw new Error("Invalid SQL parameter value");
}

function valuesFor(data: Record<string, unknown>, keys: string[]) {
  return keys.map((key) => sqlValue(data[key]));
}

function toDateTime(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value);
  return raw.length === 10 ? `${raw} 00:00:00` : raw.replace("T", " ");
}

function parseSqlDate(value: string | null): number | null {
  if (!value) return null;
  const dt = new Date(value.replace(" ", "T"));
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

async function getUserName(
  userId: number | null | undefined,
  fallbackName?: unknown
): Promise<string> {
  if (typeof fallbackName === "string" && fallbackName.trim()) {
    return fallbackName.trim();
  }
  if (!userId || userId <= 0) return "Sistema";
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT nombre_completo FROM usuarios WHERE id_usuario = ? LIMIT 1",
    [userId]
  );
  return rows.length ? String(rows[0].nombre_completo) : `Usuario #${userId}`;
}

async function getShipmentCode(shipmentId: number): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT codigo_envio FROM envios WHERE id_envio = ? LIMIT 1",
    [shipmentId]
  );
  return rows.length ? String(rows[0].codigo_envio) : `ENV-${shipmentId}`;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { tipo } = await params;
  const table = config[tipo];
  if (!table) return fail("Recurso no válido", 404);

  try {
    let sql = `SELECT * FROM ${table.table} ORDER BY ${table.pk} DESC LIMIT 500`;

    if (tipo === "envios") {
      sql = `
        SELECT e.*, u.nombre_completo AS creador_nombre
        FROM envios e
        LEFT JOIN usuarios u ON u.id_usuario = e.creado_por
        ORDER BY e.id_envio DESC
        LIMIT 500`;
    }

    if (tipo === "usuarios") {
      sql = `
        SELECT id_usuario, nombre_completo, correo, rol, departamento, activo, fecha_creacion
        FROM usuarios
        ORDER BY id_usuario DESC
        LIMIT 500`;
    }

    if (tipo === "documentos") {
      sql = `
        SELECT d.*, e.codigo_envio, e.nombre_cliente
        FROM documentos d
        INNER JOIN envios e ON e.id_envio = d.id_envio
        ORDER BY e.id_envio DESC, d.id_documento ASC
        LIMIT 1000`;
    }

    if (tipo === "riesgo") {
      sql = `
        SELECT r.*, e.codigo_envio, e.nombre_cliente
        FROM riesgos_ruta r
        INNER JOIN envios e ON e.id_envio = r.id_envio
        ORDER BY e.id_envio DESC, r.id_riesgo DESC
        LIMIT 500`;
    }

    if (tipo === "inspeccion") {
      sql = `
        SELECT i.*, e.codigo_envio, e.nombre_cliente
        FROM inspecciones_carga i
        INNER JOIN envios e ON e.id_envio = i.id_envio
        ORDER BY e.id_envio DESC, i.id_inspeccion DESC
        LIMIT 500`;
    }

    if (tipo === "aprobaciones") {
      sql = `
        SELECT a.*, e.codigo_envio, e.nombre_cliente, u.nombre_completo AS supervisor
        FROM aprobaciones a
        INNER JOIN envios e ON e.id_envio = a.id_envio
        INNER JOIN usuarios u ON u.id_usuario = a.id_supervisor
        ORDER BY a.id_aprobacion DESC
        LIMIT 500`;
    }

    const [rows] = await pool.query<RowDataPacket[]>(sql);
    return NextResponse.json(rows);
  } catch (error) {
    console.error("GET database error:", error);
    return fail("Error consultando MariaDB. Revisa la terminal de Next.js.", 500);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { tipo } = await params;
  const table = config[tipo];
  if (!table) return fail("Recurso no válido", 404);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return fail("El cuerpo de la solicitud no contiene JSON válido.");
  }

  try {
    if (tipo === "usuarios") {
      if (
        !body.nombre_completo ||
        !body.correo ||
        !body.clave ||
        !body.rol ||
        !body.departamento
      ) {
        return fail("Completa nombre, correo, contraseña, rol y departamento.");
      }

      const roles = ["OPERADOR", "SUPERVISOR", "AUDITOR"];
      const departments = [
        "ALMACEN",
        "TRAFICO",
        "TRACKING",
        "EMBARQUES",
        "INSPECCION",
        "ADMINISTRACION",
      ];

      if (!roles.includes(String(body.rol))) return fail("Rol no válido.");
      if (!departments.includes(String(body.departamento)))
        return fail("Departamento no válido.");

      const passwordHash = await bcrypt.hash(String(body.clave), 12);
      const activoVal = body.activo === false ? 0 : 1;

      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO usuarios (nombre_completo, correo, hash_clave, rol, departamento, activo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          String(body.nombre_completo),
          String(body.correo),
          passwordHash,
          String(body.rol),
          String(body.departamento),
          activoVal,
        ]
      );

      await logAuditEvent({
        modulo: "USUARIOS",
        accion: "USUARIO_CREADO",
        actor: String(body.actor_nombre || "Administrador"),
        estatus: activoVal === 1 ? "ACTIVO" : "INACTIVO",
        actualizacion: `Usuario creado: ${String(body.nombre_completo)} (${String(body.rol)} - ${String(body.departamento)})`,
        detalles: {
          id_usuario: result.insertId,
          nombre_completo: String(body.nombre_completo),
          correo: String(body.correo),
          rol: String(body.rol),
          departamento: String(body.departamento),
          activo: activoVal,
          fecha_creacion: new Date().toISOString(),
        },
      });

      return NextResponse.json({ id: result.insertId }, { status: 201 });
    }

    if (tipo === "envios") {
      const required = [
        "nombre_cliente",
        "direccion_destino",
        "distancia_km",
        "fecha_pedido",
      ];
      if (
        required.some(
          (field) =>
            body[field] === undefined ||
            body[field] === null ||
            body[field] === ""
        )
      ) {
        return fail(
          "Cliente, destino, distancia y fecha del pedido son obligatorios."
        );
      }

      const distance = Number(body.distancia_km);
      const rawCreator = body.creado_por ? Number(body.creado_por) : null;
      const creatorId =
        rawCreator && Number.isInteger(rawCreator) && rawCreator > 0
          ? rawCreator
          : null;

      if (!Number.isFinite(distance) || distance < 0)
        return fail("La distancia debe ser un número igual o mayor que cero.");

      // Date sequence validation
      const cargaSql = toDateTime(body.fecha_carga_programada);
      const despachoSql = toDateTime(body.fecha_despacho_programada);
      const entregaSql = toDateTime(body.fecha_entrega_estimada);

      const cargaMs = parseSqlDate(cargaSql);
      const despachoMs = parseSqlDate(despachoSql);
      const entregaMs = parseSqlDate(entregaSql);

      if (cargaMs !== null && despachoMs !== null && despachoMs < cargaMs) {
        return fail(
          "El despacho programado no puede ser anterior a la carga programada."
        );
      }
      if (cargaMs !== null && entregaMs !== null && entregaMs < cargaMs) {
        return fail(
          "La entrega programada no puede ser anterior a la carga programada."
        );
      }
      if (despachoMs !== null && entregaMs !== null && entregaMs < despachoMs) {
        return fail(
          "La entrega programada no puede ser anterior al despacho programado."
        );
      }

      const connection = await pool.getConnection();
      let trailerLockAcquired = false;

      try {
        await connection.beginTransaction();

        const [lockRows] = await connection.query<RowDataPacket[]>(
          "SELECT GET_LOCK('planta_centinela_shipment_allocation', 8) AS acquired"
        );
        trailerLockAcquired = Number(lockRows[0]?.acquired) === 1;
        if (!trailerLockAcquired) {
          throw new Error(
            "No fue posible reservar el inventario de trailers. Intenta nuevamente."
          );
        }

        const [activeRows] = await connection.query<RowDataPacket[]>(
          `SELECT codigo_trailer FROM envios
           WHERE codigo_trailer IS NOT NULL
             AND estatus_general NOT IN ('ENTREGADO', 'CANCELADO', 'RECHAZADO')`
        );
        const occupied = new Set(
          activeRows.map((row) => String(row.codigo_trailer))
        );
        const trailer = TRAILERS.find((item) => !occupied.has(item)) ?? null;

        // Enforce 10-trailer capacity limit
        if (!trailer) {
          await connection.rollback();
          return fail(
            "No se puede crear el envío, no hay trailers disponibles",
            400
          );
        }

        const year = new Date().getFullYear();
        const [sequenceRows] = await connection.query<RowDataPacket[]>(
          `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(codigo_envio, '-', -1) AS UNSIGNED)), 0) + 1 AS next_number
           FROM envios WHERE codigo_envio LIKE ?`,
          [`PC-${year}-%`]
        );
        const code = `PC-${year}-${String(
          Number(sequenceRows[0]?.next_number ?? 1)
        ).padStart(3, "0")}`;

        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO envios (
            codigo_envio, nombre_cliente, direccion_destino, distancia_km,
            codigo_trailer, estatus_general, fecha_pedido,
            fecha_carga_programada, fecha_despacho_programada,
            fecha_entrega_estimada, creado_por
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            code,
            String(body.nombre_cliente).trim(),
            String(body.direccion_destino).trim(),
            distance,
            trailer,
            "CREADO",
            toDateTime(body.fecha_pedido),
            cargaSql,
            despachoSql,
            entregaSql,
            creatorId,
          ]
        );

        await connection.commit();

        const creatorName = await getUserName(creatorId, body.actor_nombre);
        await logAuditEvent({
          modulo: "ENVIO",
          accion: "ENVIO_CREADO",
          id_envio: result.insertId,
          codigo_envio: code,
          actor: creatorName,
          estatus: "CREADO",
          actualizacion: `Envío ${code} creado para ${String(body.nombre_cliente).trim()} (Trailer ${trailer})`,
        });

        return NextResponse.json(
          { id: result.insertId, codigo_envio: code, codigo_trailer: trailer },
          { status: 201 }
        );
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        if (trailerLockAcquired) {
          await connection.query(
            "SELECT RELEASE_LOCK('planta_centinela_shipment_allocation')"
          );
        }
        connection.release();
      }
    }

    const data = pickFields(body, table.fields);

    // Clean zero/invalid optional FK IDs to null for riesgo / inspeccion
    if (tipo === "riesgo" && (!data.id_evaluador || Number(data.id_evaluador) <= 0)) {
      data.id_evaluador = null;
    }
    if (tipo === "inspeccion" && (!data.id_inspector || Number(data.id_inspector) <= 0)) {
      data.id_inspector = null;
    }

    if (tipo === "documentos") {
      const validDocuments = ["BOL", "FACTURA", "CARTA_PORTE", "LISTA_EMPAQUE"];
      const validStatuses = ["NO_ENTREGADO", "EN_PROCESO", "LISTO", "CANCELADO"];
      if (!validDocuments.includes(String(data.tipo_documento)))
        return fail("Tipo de documento inválido.");
      if (
        data.estatus_documento !== undefined &&
        !validStatuses.includes(String(data.estatus_documento))
      ) {
        return fail("Estatus de documento inválido.");
      }
    }

    if (tipo === "riesgo") {
      if (
        !data.id_envio ||
        !data.destino_evaluado ||
        data.distancia_km === undefined
      ) {
        return fail(
          "Selecciona un envío e indica destino y distancia evaluados."
        );
      }
    }

    if (tipo === "inspeccion" && !data.id_envio) {
      return fail("Selecciona un envío para registrar la inspección.");
    }

    if (tipo === "aprobaciones") {
      const isAdmin = body.is_admin === true;
      let supervisorId = Number(data.id_supervisor || 0);
      const shipmentId = Number(data.id_envio);

      if (isAdmin) {
        // Ensure a valid FK user ID exists for MariaDB aprobaciones.id_supervisor
        if (supervisorId <= 0) {
          const [anyUser] = await pool.execute<RowDataPacket[]>(
            "SELECT id_usuario FROM usuarios WHERE activo = 1 ORDER BY (rol = 'SUPERVISOR') DESC, id_usuario ASC LIMIT 1"
          );
          if (!anyUser.length) {
            return fail("No hay usuarios activos en la base de datos.", 400);
          }
          supervisorId = Number(anyUser[0].id_usuario);
        }
        data.id_supervisor = supervisorId;
      } else {
        const [supervisors] = await pool.execute<RowDataPacket[]>(
          "SELECT rol, activo FROM usuarios WHERE id_usuario = ?",
          [supervisorId]
        );
        if (
          !supervisors.length ||
          !["SUPERVISOR", "AUDITOR"].includes(String(supervisors[0].rol).toUpperCase()) ||
          !supervisors[0].activo
        ) {
          return fail("Solo un supervisor o administrador activo puede decidir.", 403);
        }
      }

      const [shipments] = await pool.execute<RowDataPacket[]>(
        `SELECT e.id_envio,
          (SELECT COUNT(*) FROM documentos d WHERE d.id_envio=e.id_envio AND d.estatus_documento='LISTO') AS docs_ready,
          (SELECT COUNT(*) FROM documentos d WHERE d.id_envio=e.id_envio) AS docs_total,
          (SELECT i.resultado_carga FROM inspecciones_carga i WHERE i.id_envio=e.id_envio ORDER BY i.fecha_inspeccion DESC, i.id_inspeccion DESC LIMIT 1) AS cargo_resultado
         FROM envios e WHERE e.id_envio = ?`,
        [shipmentId]
      );
      if (!shipments.length) return fail("Envío no encontrado.");

      if (
        data.decision === "APROBADO" &&
        (Number(shipments[0].docs_total) !== 4 ||
          Number(shipments[0].docs_ready) !== 4 ||
          !["EXCELENTE", "BUENO"].includes(String(shipments[0].cargo_resultado)))
      ) {
        return fail(
          "Se requieren los cuatro documentos listos y una inspección de carga BUENO o EXCELENTE."
        );
      }

      if (!["APROBADO", "RECHAZADO"].includes(String(data.decision)))
        return fail("Decisión inválida.");
    }

    const keys = Object.keys(data);
    if (!keys.length) return fail("No hay campos válidos para guardar.");

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO ${table.table} (${keys.join(", ")}) VALUES (${keys
        .map(() => "?")
        .join(", ")})`,
      valuesFor(data, keys)
    );

    if (["riesgo", "inspeccion"].includes(tipo)) {
      await pool.execute(
        `UPDATE envios SET estatus_general = 'CARGANDO'
         WHERE id_envio = ? AND estatus_general NOT IN ('EN_TRANSITO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO')`,
        [Number(data.id_envio)]
      );
    }

    if (tipo === "riesgo") {
      const shipmentId = Number(data.id_envio);
      const [code, inspectorName, [riskRows]] = await Promise.all([
        getShipmentCode(shipmentId),
        getUserName(
          data.id_evaluador ? Number(data.id_evaluador) : null,
          body.actor_nombre
        ),
        pool.execute<RowDataPacket[]>(
          "SELECT resultado_ruta FROM riesgos_ruta WHERE id_riesgo = ? LIMIT 1",
          [result.insertId]
        ),
      ]);

      const riskLabels: [string, string][] = [
        ["carretera_danada", "Carretera dañada"],
        ["clima_adverso", "Clima adverso"],
        ["trafico_intenso", "Tráfico intenso"],
        ["incidente_reportado", "Incidente reportado"],
        ["retraso_probable", "Retraso probable"],
      ];
      const selected = riskLabels
        .filter(([k]) => Number(data[k]) === 1)
        .map(([, label]) => label);

      await logAuditEvent({
        modulo: "RIESGO_RUTA",
        accion: "EVALUACION_RUTA",
        id_envio: shipmentId,
        codigo_envio: code,
        actor: inspectorName,
        estatus: String(riskRows[0]?.resultado_ruta || "PENDIENTE"),
        actualizacion: selected.length
          ? `${selected.join(", ")} seleccionado`
          : "Sin riesgos seleccionados",
      });
    }

    if (tipo === "inspeccion") {
      const shipmentId = Number(data.id_envio);
      const [code, inspectorName, [inspRows]] = await Promise.all([
        getShipmentCode(shipmentId),
        getUserName(
          data.id_inspector ? Number(data.id_inspector) : null,
          body.actor_nombre
        ),
        pool.execute<RowDataPacket[]>(
          "SELECT resultado_carga FROM inspecciones_carga WHERE id_inspeccion = ? LIMIT 1",
          [result.insertId]
        ),
      ]);

      const cargoLabels: [string, string][] = [
        ["material_coincide", "Material coincide"],
        ["distribucion_correcta", "Distribución correcta"],
        ["embalaje_adecuado", "Embalaje adecuado"],
        ["carga_asegurada", "Carga asegurada"],
      ];
      const selected = cargoLabels
        .filter(([k]) => Number(data[k]) === 1)
        .map(([, label]) => label);

      await logAuditEvent({
        modulo: "INSPECCION_CARGA",
        accion: "INSPECCION_MERCANCIA",
        id_envio: shipmentId,
        codigo_envio: code,
        actor: inspectorName,
        estatus: String(inspRows[0]?.resultado_carga || "PENDIENTE"),
        actualizacion: selected.length
          ? selected.join(", ")
          : "Ningún criterio marcado",
      });
    }

    if (tipo === "aprobaciones") {
      const shipmentId = Number(data.id_envio);
      const nextStatus =
        data.decision === "APROBADO" ? "EN_TRANSITO" : "RECHAZADO";

      if (nextStatus === "EN_TRANSITO") {
        await pool.execute(
          `UPDATE envios
           SET estatus_general = 'EN_TRANSITO',
               fecha_despacho_real = COALESCE(fecha_despacho_real, NOW())
           WHERE id_envio = ?`,
          [shipmentId]
        );
      } else {
        await pool.execute(
          "UPDATE envios SET estatus_general = ? WHERE id_envio = ?",
          [nextStatus, shipmentId]
        );
      }

      if (nextStatus === "EN_TRANSITO") {
        try {
          await initializeTracking(shipmentId);
        } catch (trackingError) {
          console.error("No se pudo inicializar tracking:", trackingError);
        }
      }

      const [code, supervisorName] = await Promise.all([
        getShipmentCode(shipmentId),
        getUserName(Number(data.id_supervisor), body.actor_nombre),
      ]);
      const decision = String(data.decision);

      await logAuditEvent({
        modulo: "APROBACIONES",
        accion: decision,
        id_envio: shipmentId,
        codigo_envio: code,
        actor: supervisorName,
        estatus: decision,
        actualizacion: data.comentarios
          ? `${decision} — ${String(data.comentarios)}`
          : decision,
      });
    }

    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (error) {
    console.error("POST database error:", {
      tipo,
      error,
      code: (error as any)?.code,
      errno: (error as any)?.errno,
      sqlMessage: (error as any)?.sqlMessage,
      sqlState: (error as any)?.sqlState,
    });

    return fail(
      "No se pudo guardar. Revisa los registros de la función en Vercel.",
      500
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { tipo } = await params;
  const table = config[tipo];
  if (!table) return fail("Recurso no válido", 404);

  try {
    const body = (await request.json()) as RequestBody;
    const recordId = Number(body[table.pk]);
    if (!Number.isInteger(recordId) || recordId <= 0)
      return fail(`Falta un ${table.pk} válido.`);

    const data = pickFields(body, table.fields);
    if (
      tipo === "documentos" &&
      "actualizado_por" in data &&
      (!data.actualizado_por || Number(data.actualizado_por) <= 0)
    ) {
      data.actualizado_por = null;
    }

    const keys = Object.keys(data);
    if (!keys.length) return fail("No hay campos válidos para actualizar.");

    let shipmentId: number | null = null;
    let docType = "";

    if (tipo === "documentos") {
      const [docRows] = await pool.execute<RowDataPacket[]>(
        "SELECT id_envio, tipo_documento FROM documentos WHERE id_documento = ?",
        [recordId]
      );
      if (!docRows.length) return fail("Documento no encontrado.", 404);
      shipmentId = Number(docRows[0].id_envio);
      docType = String(docRows[0].tipo_documento).replaceAll("_", " ");
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE ${table.table} SET ${keys
        .map((key) => `${key} = ?`)
        .join(", ")} WHERE ${table.pk} = ?`,
      [...valuesFor(data, keys), recordId]
    );

    if (tipo === "documentos" && shipmentId !== null) {
      await pool.execute(
        `UPDATE envios SET estatus_general = 'CARGANDO'
         WHERE id_envio = ? AND estatus_general NOT IN ('EN_TRANSITO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO')`,
        [shipmentId]
      );

      const [statusRows] = await pool.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) AS total_docs,
           SUM(CASE WHEN estatus_documento = 'LISTO' THEN 1 ELSE 0 END) AS ready_docs
         FROM documentos WHERE id_envio = ?`,
        [shipmentId]
      );
      const allReady =
        Number(statusRows[0]?.total_docs) === 4 &&
        Number(statusRows[0]?.ready_docs) === 4;
      const docStatus = allReady ? "LISTO" : "EN PROGRESO";

      const [code, actorName] = await Promise.all([
        getShipmentCode(shipmentId),
        getUserName(
          data.actualizado_por ? Number(data.actualizado_por) : null,
          body.actor_nombre
        ),
      ]);

      await logAuditEvent({
        modulo: "DOCUMENTOS",
        accion: allReady ? "DOCUMENTACION_LISTA" : "DOCUMENTO_ACTUALIZADO",
        id_envio: shipmentId,
        codigo_envio: code,
        actor: actorName,
        estatus: docStatus,
        actualizacion: allReady
          ? `${docType} actualizado — Estatus documental: LISTO`
          : `${docType} actualizado — Estatus documental: EN PROGRESO`,
      });
    }

    return NextResponse.json({ affectedRows: result.affectedRows });
  } catch (error) {
    console.error("PUT database error:", error);
    return fail(
      "No se pudo actualizar el registro. Revisa la terminal de Next.js.",
      500
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { tipo } = await params;
  if (tipo !== "usuarios") {
    return fail("Eliminación solo habilitada para usuarios.", 405);
  }

  const connection = await pool.getConnection();

  try {
    const body = (await request.json()) as RequestBody;
    const userId = Number(body.id_usuario);
    if (!Number.isInteger(userId) || userId <= 0) {
      return fail("id_usuario inválido.");
    }

    await connection.beginTransaction();

    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT id_usuario, nombre_completo, correo, rol, departamento, activo, fecha_creacion FROM usuarios WHERE id_usuario = ?",
      [userId]
    );
    if (!rows.length) {
      await connection.rollback();
      return fail("Usuario no encontrado.", 404);
    }

    const u = rows[0];

    // Check if user has historical approvals (id_supervisor is NOT NULL)
    const [approvalRows] = await connection.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM aprobaciones WHERE id_supervisor = ?",
      [userId]
    );
    const hasApprovals = Number(approvalRows[0]?.cnt ?? 0) > 0;

    let softDeleted = false;

    if (hasApprovals) {
      // Deactivate instead of hard delete to preserve approval history
      await connection.execute(
        "UPDATE usuarios SET activo = 0 WHERE id_usuario = ?",
        [userId]
      );
      softDeleted = true;
    } else {
      // Detach nullable references so hard delete succeeds cleanly
      await connection.execute(
        "UPDATE envios SET creado_por = NULL WHERE creado_por = ?",
        [userId]
      );
      await connection.execute(
        "UPDATE documentos SET actualizado_por = NULL WHERE actualizado_por = ?",
        [userId]
      );
      await connection.execute(
        "UPDATE riesgos_ruta SET id_evaluador = NULL WHERE id_evaluador = ?",
        [userId]
      );
      await connection.execute(
        "UPDATE inspecciones_carga SET id_inspector = NULL WHERE id_inspector = ?",
        [userId]
      );
      await connection.execute("DELETE FROM usuarios WHERE id_usuario = ?", [
        userId,
      ]);
    }

    await connection.commit();

    // Always log to MongoDB after commit
    await logAuditEvent({
      modulo: "USUARIOS",
      accion: softDeleted ? "USUARIO_DESACTIVADO" : "USUARIO_ELIMINADO",
      actor: String(body.actor_nombre || "Administrador"),
      estatus: "ELIMINADO",
      actualizacion: softDeleted
        ? `Usuario desactivado (con historial de aprobaciones): ${u.nombre_completo} (${u.rol} - ${u.departamento})`
        : `Usuario eliminado: ${u.nombre_completo} (${u.rol} - ${u.departamento})`,
      detalles: {
        id_usuario: u.id_usuario,
        nombre_completo: u.nombre_completo,
        correo: u.correo,
        rol: u.rol,
        departamento: u.departamento,
        activo: 0,
        fecha_creacion: u.fecha_creacion,
      },
    });

    return NextResponse.json({ deleted: true, softDeleted });
  } catch (error) {
    await connection.rollback();
    console.error("DELETE user error:", error);
    return fail("No se pudo eliminar el usuario.", 500);
  } finally {
    connection.release();
  }
}
