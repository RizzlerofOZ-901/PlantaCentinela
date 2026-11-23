import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/app/lib/db";
import {
  getPositionOnRoute,
  recalculateAvoiding,
  type LatLng,
} from "@/app/lib/tracking";

type Context = { params: Promise<{ id: string }> };

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parseRoute(value: unknown): LatLng[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error("Geometría de ruta inválida.");
  return parsed as LatLng[];
}

export async function GET(_request: NextRequest, { params }: Context) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("ID de envío inválido.");
  }

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT s.*, e.codigo_envio, e.nombre_cliente, e.codigo_trailer,
              e.estatus_general, e.fecha_despacho_real,
              e.fecha_despacho_programada, e.fecha_entrega_estimada,
              e.fecha_entrega_real
       FROM tracking_sessions s
       INNER JOIN envios e ON e.id_envio = s.id_envio
       WHERE s.id_envio = ? LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return jsonError("Este envío no tiene una sesión de tracking inicializada.", 404);
    }

    const session = rows[0];
    const activeRoute = parseRoute(session.ruta_activa);
    const originalRoute = parseRoute(session.ruta_original);
    const progress = Number(session.distancia_avance_km);

    const [checkpointRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id_checkpoint, numero_checkpoint, distancia_acumulada_km,
              latitud, longitud, ubicacion, estatus, fecha_registro, observaciones
       FROM tracking_checkpoints
       WHERE id_envio = ?
       ORDER BY numero_checkpoint`,
      [id]
    );

    const position = getPositionOnRoute(
      activeRoute,
      Math.min(progress, Number(session.distancia_total_km))
    );

    return NextResponse.json({
      shipment: {
        id_envio: id,
        codigo_envio: session.codigo_envio,
        nombre_cliente: session.nombre_cliente,
        codigo_trailer: session.codigo_trailer,
        estatus_general: session.estatus_general,
        fecha_despacho_real: session.fecha_despacho_real,
        fecha_despacho_programada: session.fecha_despacho_programada,
        fecha_entrega_estimada: session.fecha_entrega_estimada,
        fecha_entrega_real: session.fecha_entrega_real,
      },
      session: {
        route: activeRoute,
        originalRoute,
        distanceKm: Number(session.distancia_total_km),
        progressKm: progress,
        durationMinutes: Number(session.duracion_estimada_min ?? 0),
        state: session.estado,
        currentPosition: position,
        incident: session.incidente_actual,
      },
      checkpoints: checkpointRows,
    });
  } catch (error) {
    console.error("Tracking GET error:", error);
    return jsonError(
      error instanceof Error ? error.message : "No se pudo consultar el tracking.",
      500
    );
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("ID de envío inválido.");
  }

  let body: { action?: string; checkpointId?: number; incident?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido.");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT s.*, e.nombre_cliente, e.estatus_general
       FROM tracking_sessions s
       INNER JOIN envios e ON e.id_envio = s.id_envio
       WHERE s.id_envio = ? FOR UPDATE`,
      [id]
    );

    if (!rows.length) {
      await connection.rollback();
      return jsonError("No existe una sesión de tracking para este envío.", 404);
    }

    const session = rows[0];

    if (session.estado !== "ACTIVO" || session.estatus_general !== "EN_TRANSITO") {
      await connection.commit();
      return NextResponse.json({ finished: true });
    }

    if (body.action === "block") {
      const checkpointId = Number(body.checkpointId);

      const [cpRows] = await connection.execute<RowDataPacket[]>(
        `SELECT latitud, longitud
         FROM tracking_checkpoints
         WHERE id_checkpoint = ? AND id_envio = ?`,
        [checkpointId, id]
      );

      if (!cpRows.length) {
        await connection.rollback();
        return jsonError("Checkpoint no válido.");
      }

      const oldRoute = parseRoute(session.ruta_activa);
      const currentKm = Number(session.distancia_avance_km);
      const currentPosition = getPositionOnRoute(oldRoute, currentKm);
      const blockedPoint: LatLng = [
        Number(cpRows[0].latitud),
        Number(cpRows[0].longitud),
      ];

      const destinationMap: Record<string, LatLng> = {
        "JOHNSON CONTROLS": [25.772584, -100.191632],
        NIDEC: [25.778848, -100.198305],
        NEMAK: [25.7331043, -100.5371376],
        METALSA: [25.7674251, -100.1911475],
      };

      const client = String(session.nombre_cliente).toUpperCase();
      const destinationEntry = Object.entries(destinationMap).find(([name]) =>
        client.includes(name)
      );

      if (!destinationEntry) {
        await connection.rollback();
        return jsonError("No hay destino configurado para este cliente.");
      }

      // El nuevo tramo comienza en la posición actual del camión.
      const detour = await recalculateAvoiding(
        currentPosition,
        destinationEntry[1],
        blockedPoint
      );

      await connection.execute(
        `UPDATE tracking_sessions
         SET ruta_activa = ?, distancia_total_km = ?,
             distancia_avance_km = 0, duracion_estimada_min = ?,
             incidente_actual = ?, ultimo_avance = NOW()
         WHERE id_envio = ?`,
        [
          JSON.stringify(detour.coordinates),
          detour.distanceKm,
          detour.durationMinutes,
          String(body.incident || "Carretera bloqueada").slice(0, 120),
          id,
        ]
      );

      await connection.execute(
        `UPDATE tracking_checkpoints
         SET estatus = 'OMITIDO'
         WHERE id_envio = ? AND estatus = 'PENDIENTE'
           AND distancia_acumulada_km <= ?`,
        [id, currentKm]
      );

      await connection.commit();
      return NextResponse.json({ recalculated: true });
    }

    if (body.action !== "advance") {
      await connection.rollback();
      return jsonError("Acción no válida.");
    }

    // Máximo un avance por ventana de 4 segundos entre todas las pestañas.
    const [tickRows] = await connection.execute<RowDataPacket[]>(
      `SELECT TIMESTAMPDIFF(SECOND, ultimo_avance, NOW()) AS elapsed
      FROM tracking_sessions
      WHERE id_envio = ?`,
      [id]
    );

    if (Number(tickRows[0]?.elapsed ?? 0) < 4) {
      await connection.commit();
      return NextResponse.json({ advanced: false });
    }

    const total = Number(session.distancia_total_km);
    const nextProgress = Math.min(
      Number(session.distancia_avance_km) + 1,
      total
    );

    await connection.execute(
      `UPDATE tracking_sessions
       SET distancia_avance_km = ?, ultimo_avance = NOW(),
           estado = IF(? >= distancia_total_km, 'ENTREGADO', 'ACTIVO')
       WHERE id_envio = ?`,
      [nextProgress, nextProgress, id]
    );

    await connection.execute(
      `UPDATE tracking_checkpoints
       SET estatus = 'ALCANZADO', fecha_registro = NOW(),
           observaciones = 'Checkpoint alcanzado por simulación de recorrido'
       WHERE id_envio = ? AND estatus = 'PENDIENTE'
         AND distancia_acumulada_km <= ?`,
      [id, nextProgress]
    );

    if (nextProgress >= total) {
      await connection.execute(
        `UPDATE envios
         SET estatus_general = 'ENTREGADO',
             fecha_entrega_real = COALESCE(fecha_entrega_real, NOW())
         WHERE id_envio = ? AND estatus_general = 'EN_TRANSITO'`,
        [id]
      );
    }

    await connection.commit();

    return NextResponse.json({
      advanced: true,
      progressKm: nextProgress,
      delivered: nextProgress >= total,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Tracking POST error:", error);
    return jsonError(
      error instanceof Error ? error.message : "No se pudo actualizar el tracking.",
      500
    );
  } finally {
    connection.release();
  }
}
