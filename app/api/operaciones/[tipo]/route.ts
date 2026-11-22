import { NextRequest, NextResponse } from "next/server";

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

      "id_envio", "tipo_documento", "estatus_documento",

      "codigo_referencia", "actualizado_por", "observaciones",

    ],

  },

  riesgo: {

    table: "riesgos_ruta",

    pk: "id_riesgo",

    fields: [

      "id_envio", "id_evaluador", "destino_evaluado", "distancia_km",

      "carretera_danada", "clima_adverso", "trafico_intenso",

      "incidente_reportado", "retraso_probable", "observaciones",

    ],

  },

  inspeccion: {

    table: "inspecciones_carga",

    pk: "id_inspeccion",

    fields: [

      "id_envio", "id_inspector", "material_coincide",

      "embalaje_adecuado", "distribucion_correcta", "carga_asegurada",

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

    fields: ["nombre_completo", "correo", "hash_clave", "rol", "departamento", "activo"],

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

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {

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

      if (!body.nombre_completo || !body.correo || !body.clave || !body.rol || !body.departamento) {

        return fail("Completa nombre, correo, contraseña, rol y departamento.");

      }

      const roles = ["OPERADOR", "SUPERVISOR", "AUDITOR"];

      const departments = ["ALMACEN", "TRAFICO", "EMBARQUES", "INSPECCION", "ADMINISTRACION"];

      if (!roles.includes(String(body.rol))) return fail("Rol no válido.");

      if (!departments.includes(String(body.departamento))) return fail("Departamento no válido.");

      const passwordHash = await bcrypt.hash(String(body.clave), 12);

      const [result] = await pool.execute<ResultSetHeader>(

        `INSERT INTO usuarios (nombre_completo, correo, hash_clave, rol, departamento, activo)

         VALUES (?, ?, ?, ?, ?, ?)`,

        [String(body.nombre_completo), String(body.correo), passwordHash,

          String(body.rol), String(body.departamento), body.activo === false ? 0 : 1]

      );

      return NextResponse.json({ id: result.insertId }, { status: 201 });

    }

    if (tipo === "envios") {

      const required = ["nombre_cliente", "direccion_destino", "distancia_km", "fecha_pedido", "creado_por"];

      if (required.some((field) => body[field] === undefined || body[field] === null || body[field] === "")) {

        return fail("Cliente, destino, distancia, fecha del pedido y creador son obligatorios.");

      }

      const distance = Number(body.distancia_km);

      const creator = Number(body.creado_por);

      if (!Number.isFinite(distance) || distance < 0) return fail("La distancia debe ser un número igual o mayor que cero.");

      if (!Number.isInteger(creator) || creator <= 0) return fail("Selecciona un usuario creador válido.");

      const connection = await pool.getConnection();

      let trailerLockAcquired = false;

      try {

        await connection.beginTransaction();

        // Keep the named lock until after the INSERT so two requests cannot claim the same trailer.

        const [lockRows] = await connection.query<RowDataPacket[]>(

          "SELECT GET_LOCK('planta_centinela_shipment_allocation', 8) AS acquired"

        );

        trailerLockAcquired = Number(lockRows[0]?.acquired) === 1;

        if (!trailerLockAcquired) {

          throw new Error("No fue posible reservar el inventario de trailers. Intenta nuevamente.");

        }

        const [activeRows] = await connection.query<RowDataPacket[]>(

          `SELECT codigo_trailer FROM envios

           WHERE codigo_trailer IS NOT NULL

             AND estatus_general NOT IN ('ENTREGADO', 'CANCELADO', 'RECHAZADO')`

        );

        const occupied = new Set(activeRows.map((row) => String(row.codigo_trailer)));

        const trailer = TRAILERS.find((item) => !occupied.has(item)) ?? null;

        // The named lock also protects the yearly sequential code from concurrent inserts.

        const year = new Date().getFullYear();

        const [sequenceRows] = await connection.query<RowDataPacket[]>(

          `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(codigo_envio, '-', -1) AS UNSIGNED)), 0) + 1 AS next_number

           FROM envios WHERE codigo_envio LIKE ?`, [`PC-${year}-%`]

        );

        const code = `PC-${year}-${String(Number(sequenceRows[0]?.next_number ?? 1)).padStart(3, "0")}`;

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

            "EN_ORIGEN",

            toDateTime(body.fecha_pedido),

            toDateTime(body.fecha_carga_programada),

            toDateTime(body.fecha_despacho_programada),

            toDateTime(body.fecha_entrega_estimada),

            creator,

          ]

        );

        await connection.commit();

        return NextResponse.json(

          { id: result.insertId, codigo_envio: code, codigo_trailer: trailer },

          { status: 201 }

        );

      } catch (error) {

        await connection.rollback();

        throw error;

      } finally {

        if (trailerLockAcquired) {

          await connection.query("SELECT RELEASE_LOCK('planta_centinela_shipment_allocation')");

        }

        connection.release();

      }

    }

    const data = pickFields(body, table.fields);

    if (tipo === "documentos") {

      const validDocuments = ["BOL", "FACTURA", "CARTA_PORTE", "LISTA_EMPAQUE"];

      const validStatuses = ["NO_ENTREGADO", "EN_PROCESO", "LISTO", "CANCELADO"];

      if (!validDocuments.includes(String(data.tipo_documento))) return fail("Tipo de documento inválido.");

      if (data.estatus_documento !== undefined && !validStatuses.includes(String(data.estatus_documento))) {

        return fail("Estatus de documento inválido.");

      }

    }

    if (tipo === "riesgo") {

      if (!data.id_envio || !data.destino_evaluado || data.distancia_km === undefined) {

        return fail("Selecciona un envío e indica destino y distancia evaluados.");

      }

    }

    if (tipo === "inspeccion" && !data.id_envio) {

      return fail("Selecciona un envío para registrar la inspección.");

    }

    if (tipo === "aprobaciones") {

      const supervisorId = Number(data.id_supervisor);

      const shipmentId = Number(data.id_envio);

      const [supervisors] = await pool.execute<RowDataPacket[]>(

        "SELECT rol, activo FROM usuarios WHERE id_usuario = ?", [supervisorId]

      );

      if (!supervisors.length || supervisors[0].rol !== "SUPERVISOR" || !supervisors[0].activo) {

        return fail("Solo un supervisor activo puede decidir.", 403);

      }

      const [shipments] = await pool.execute<RowDataPacket[]>(

        `SELECT e.id_envio,

          (SELECT COUNT(*) FROM documentos d WHERE d.id_envio=e.id_envio AND d.estatus_documento='LISTO') AS docs_ready,

          (SELECT COUNT(*) FROM documentos d WHERE d.id_envio=e.id_envio) AS docs_total,

          (SELECT i.resultado_carga FROM inspecciones_carga i WHERE i.id_envio=e.id_envio ORDER BY i.fecha_inspeccion DESC, i.id_inspeccion DESC LIMIT 1) AS cargo_resultado

         FROM envios e WHERE e.id_envio = ?`, [shipmentId]

      );

      if (!shipments.length) return fail("Envío no encontrado.");

      if (data.decision === "APROBADO" &&

        (Number(shipments[0].docs_total) !== 4 || Number(shipments[0].docs_ready) !== 4 ||

          !["EXCELENTE", "BUENO"].includes(String(shipments[0].cargo_resultado)))) {

        return fail("Se requieren los cuatro documentos listos y una inspección de carga BUENO o EXCELENTE.");

      }

      if (!["APROBADO", "RECHAZADO"].includes(String(data.decision))) return fail("Decisión inválida.");

    }

    const keys = Object.keys(data);

    if (!keys.length) return fail("No hay campos válidos para guardar.");

    const [result] = await pool.execute<ResultSetHeader>(

      `INSERT INTO ${table.table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,

      valuesFor(data, keys)

    );

    // Operational activity moves a shipment into loading, but never rolls back
    // a shipment that has already been approved and dispatched.
    if (["riesgo", "inspeccion"].includes(tipo)) {
      await pool.execute(
        `UPDATE envios SET estatus_general = 'CARGANDO'
         WHERE id_envio = ? AND estatus_general NOT IN ('EN_TRANSITO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO')`,
        [Number(data.id_envio)]
      );
    }

    if (tipo === "aprobaciones") {
      const nextStatus = data.decision === "APROBADO" ? "EN_TRANSITO" : "RECHAZADO";
      await pool.execute(
        "UPDATE envios SET estatus_general = ? WHERE id_envio = ?",
        [nextStatus, Number(data.id_envio)]
      );
    }

    return NextResponse.json({ id: result.insertId }, { status: 201 });

  } catch (error) {

    console.error("POST database error:", error);

    return fail("No se pudo guardar. Revisa la terminal de Next.js y valida los datos y claves foráneas.", 500);

  }

}

export async function PUT(request: NextRequest, { params }: RouteContext) {

  const { tipo } = await params;

  const table = config[tipo];

  if (!table) return fail("Recurso no válido", 404);

  try {

    const body = (await request.json()) as RequestBody;

    const recordId = Number(body[table.pk]);

    if (!Number.isInteger(recordId) || recordId <= 0) return fail(`Falta un ${table.pk} válido.`);

    const data = pickFields(body, table.fields);

    // Status fields are intentionally excluded from envios PUT; shipment status
    // is changed only by lifecycle events in this API.
    const keys = Object.keys(data);

    if (!keys.length) return fail("No hay campos válidos para actualizar.");

    let shipmentId: number | null = null;
    if (tipo === "documentos") {
      const [docRows] = await pool.execute<RowDataPacket[]>(
        "SELECT id_envio FROM documentos WHERE id_documento = ?", [recordId]
      );
      if (!docRows.length) return fail("Documento no encontrado.", 404);
      shipmentId = Number(docRows[0].id_envio);
    }

    const [result] = await pool.execute<ResultSetHeader>(

      `UPDATE ${table.table} SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE ${table.pk} = ?`,

      [...valuesFor(data, keys), recordId]

    );

    if (tipo === "documentos" && shipmentId !== null) {
      await pool.execute(
        `UPDATE envios SET estatus_general = 'CARGANDO'
         WHERE id_envio = ? AND estatus_general NOT IN ('EN_TRANSITO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO')`,
        [shipmentId]
      );
    }

    return NextResponse.json({ affectedRows: result.affectedRows });

  } catch (error) {

    console.error("PUT database error:", error);

    return fail("No se pudo actualizar el registro. Revisa la terminal de Next.js.", 500);

  }

}
