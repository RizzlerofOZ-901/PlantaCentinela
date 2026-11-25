import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/app/lib/db";
import { logAuditEvent } from "@/app/lib/mongodb";
import {
  destinationFor,
  getPositionOnRoute,
  initializeTracking,
  recalculateAvoidingZone,
  rebuildTrackingCheckpoints,
  resolveCityName,
  type LatLng,
} from "@/app/lib/tracking";

type Context = { params: Promise<{ id: string }> };

// Slower pace so users can click the map and observe real-time rerouting
const ADVANCE_INTERVAL_SECONDS = 6;
const ADVANCE_DISTANCE_KM = 15;
const NO_ROUTE_DELAY_SECONDS = 10;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parseRoute(value: unknown): LatLng[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) {
    throw new Error("Geometría de ruta inválida.");
  }
  return parsed as LatLng[];
}

export async function GET(_request: NextRequest, { params }: Context) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("ID de envío inválido.");
  }

  try {
    await initializeTracking(id);

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
      return jsonError(
        "Este envío no tiene una sesión de tracking inicializada.",
        404
      );
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

    const blockedCp = checkpointRows.find((c) => c.estatus === "BLOQUEADO");

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
        blockedCenter: blockedCp
          ? ([Number(blockedCp.latitud), Number(blockedCp.longitud)] as LatLng)
          : null,
      },
      checkpoints: checkpointRows,
    });
  } catch (error) {
    console.error("Tracking GET error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "No se pudo consultar el tracking.",
      500
    );
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("ID de envío inválido.");
  }

  let body: {
    action?: string;
    checkpointId?: number;
    lat?: number;
    lng?: number;
    incident?: string;
    actor_nombre?: string;
  };

  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido.");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT s.*, e.codigo_envio, e.nombre_cliente, e.estatus_general
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

    if (
      session.estado !== "ACTIVO" ||
      session.estatus_general !== "EN_TRANSITO"
    ) {
      await connection.commit();
      return NextResponse.json({ finished: true });
    }

    // =========================================================================
    // ACTION: BLOCK (from clicking the map OR clicking a checkpoint button)
    // =========================================================================
    if (body.action === "block_point" || body.action === "block") {
      let clickedPoint: LatLng | null = null;

      if (
        body.action === "block_point" &&
        Number.isFinite(body.lat) &&
        Number.isFinite(body.lng)
      ) {
        clickedPoint = [Number(body.lat), Number(body.lng)];
      } else if (body.checkpointId) {
        const [cpRows] = await connection.execute<RowDataPacket[]>(
          `SELECT latitud, longitud FROM tracking_checkpoints
           WHERE id_checkpoint = ? AND id_envio = ?`,
          [Number(body.checkpointId), id]
        );
        if (cpRows.length) {
          clickedPoint = [
            Number(cpRows[0].latitud),
            Number(cpRows[0].longitud),
          ];
        }
      }

      if (!clickedPoint) {
        await connection.rollback();
        return jsonError("Coordenadas de bloqueo inválidas.");
      }

      const oldRoute = parseRoute(session.ruta_activa);
      const currentKm = Number(session.distancia_avance_km);
      const totalKm = Number(session.distancia_total_km);
      const currentPosition = getPositionOnRoute(oldRoute, currentKm);
      const clientName = String(session.nombre_cliente);
      const destination = destinationFor(clientName);
      const blockedCity = resolveCityName(clickedPoint[0], clickedPoint[1]);
      const incidentReason = String(
        body.incident || "Carretera bloqueada (Zona 40 km)"
      ).slice(0, 90);
      const actor = String(body.actor_nombre || "Operador Tracking");

      // Attempt to calculate an alternative road route avoiding the 40 km zone
      const detourResult = await recalculateAvoidingZone(
        oldRoute,
        currentPosition,
        destination,
        clickedPoint,
        totalKm
      );

      if (detourResult) {
        const { route: detour, snappedPoint } = detourResult;
        const incidentText = `${incidentReason} — Desvío en ${blockedCity}`.slice(
          0,
          120
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
            incidentText,
            id,
          ]
        );

        // Remove unreached pending checkpoints and record the blocked zone marker
        await connection.execute(
          `DELETE FROM tracking_checkpoints
           WHERE id_envio = ? AND estatus IN ('PENDIENTE', 'BLOQUEADO')`,
          [id]
        );

        const [maxRows] = await connection.execute<RowDataPacket[]>(
          "SELECT COALESCE(MAX(numero_checkpoint), 0) AS max_num FROM tracking_checkpoints WHERE id_envio = ?",
          [id]
        );
        let nextNum = Number(maxRows[0]?.max_num ?? 0) + 1;

        await connection.execute(
          `INSERT INTO tracking_checkpoints
            (id_envio, numero_checkpoint, distancia_acumulada_km, latitud, longitud, ubicacion, estatus, fecha_registro, observaciones)
           VALUES (?, ?, ?, ?, ?, ?, 'BLOQUEADO', NOW(), ?)`,
          [
            id,
            nextNum++,
            Number(detourResult.blockedKm.toFixed(2)),
            snappedPoint[0],
            snappedPoint[1],
            `${blockedCity} (Bloqueo 40 km)`,
            incidentText,
          ]
        );

        await connection.commit();

        // Rebuild upcoming 30 km city checkpoints along the new detour route
        await rebuildTrackingCheckpoints(
          id,
          detour.coordinates,
          detour.distanceKm,
          clientName,
          `${resolveCityName(currentPosition[0], currentPosition[1])} (Desvío)`,
          nextNum,
          false
        );

        await logAuditEvent({
          modulo: "TRACKING",
          accion: "INCIDENTE_DESVIO",
          id_envio: id,
          codigo_envio: String(session.codigo_envio),
          actor,
          estatus: "DESVIO",
          actualizacion: `${incidentText} · Nueva ruta: ${detour.distanceKm.toFixed(1)} km`,
        });

        return NextResponse.json({
          recalculated: true,
          delayed: false,
          blockedCenter: snappedPoint,
          message: `Ruta alterna calculada evitando zona de 40 km en ${blockedCity}.`,
        });
      }

      // NO ALTERNATIVE ROUTE AVAILABLE -> Apply 10-second traffic delay
      const delayText = `Tráfico pesado / Sin vía alterna en ${blockedCity} (Retraso ${NO_ROUTE_DELAY_SECONDS}s)`.slice(
        0,
        120
      );

      await connection.execute(
        `UPDATE tracking_sessions
         SET incidente_actual = ?,
             duracion_estimada_min = COALESCE(duracion_estimada_min, 0) + 20,
             ultimo_avance = DATE_ADD(NOW(), INTERVAL ? SECOND)
         WHERE id_envio = ?`,
        [delayText, NO_ROUTE_DELAY_SECONDS, id]
      );

      const [maxRows] = await connection.execute<RowDataPacket[]>(
        "SELECT COALESCE(MAX(numero_checkpoint), 0) AS max_num FROM tracking_checkpoints WHERE id_envio = ?",
        [id]
      );
      const nextNum = Number(maxRows[0]?.max_num ?? 0) + 1;

      await connection.execute(
        `DELETE FROM tracking_checkpoints WHERE id_envio = ? AND estatus = 'BLOQUEADO'`,
        [id]
      );

      await connection.execute(
        `INSERT INTO tracking_checkpoints
          (id_envio, numero_checkpoint, distancia_acumulada_km, latitud, longitud, ubicacion, estatus, fecha_registro, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, 'BLOQUEADO', NOW(), ?)`,
        [
          id,
          nextNum,
          Number(currentKm.toFixed(2)),
          clickedPoint[0],
          clickedPoint[1],
          `${blockedCity} (Tráfico / Sin vía alterna)`,
          delayText,
        ]
      );

      await connection.commit();

      await logAuditEvent({
        modulo: "TRACKING",
        accion: "RETRASO_TRAFICO",
        id_envio: id,
        codigo_envio: String(session.codigo_envio),
        actor,
        estatus: "RETRASADO",
        actualizacion: delayText,
      });

      return NextResponse.json({
        recalculated: false,
        delayed: true,
        delaySeconds: NO_ROUTE_DELAY_SECONDS,
        blockedCenter: clickedPoint,
        message: `No se encontró vía alterna en ${blockedCity}. Unidad detenida ${NO_ROUTE_DELAY_SECONDS} segundos por tráfico pesado.`,
      });
    }

    // =========================================================================
    // ACTION: ADVANCE
    // =========================================================================
    if (body.action !== "advance") {
      await connection.rollback();
      return jsonError("Acción no válida.");
    }

    const [tickRows] = await connection.execute<RowDataPacket[]>(
      `SELECT TIMESTAMPDIFF(SECOND, ultimo_avance, NOW()) AS elapsed
       FROM tracking_sessions
       WHERE id_envio = ?`,
      [id]
    );

    const elapsed = Number(tickRows[0]?.elapsed ?? 0);
    if (elapsed < ADVANCE_INTERVAL_SECONDS) {
      await connection.commit();
      return NextResponse.json({
        advanced: false,
        waitingSeconds: Math.max(0, ADVANCE_INTERVAL_SECONDS - elapsed),
      });
    }

    const total = Number(session.distancia_total_km);
    const nextProgress = Math.min(
      Number(session.distancia_avance_km) + ADVANCE_DISTANCE_KM,
      total
    );

    await connection.execute(
      `UPDATE tracking_sessions
       SET distancia_avance_km = ?, ultimo_avance = NOW(),
           estado = IF(? >= distancia_total_km, 'ENTREGADO', 'ACTIVO')
       WHERE id_envio = ?`,
      [nextProgress, nextProgress, id]
    );

    const [reachedCheckpoints] = await connection.execute<RowDataPacket[]>(
      `SELECT numero_checkpoint, distancia_acumulada_km, ubicacion
       FROM tracking_checkpoints
       WHERE id_envio = ? AND estatus = 'PENDIENTE'
         AND distancia_acumulada_km <= ?
       ORDER BY numero_checkpoint ASC`,
      [id, nextProgress]
    );

    await connection.execute(
      `UPDATE tracking_checkpoints
       SET estatus = 'ALCANZADO', fecha_registro = NOW(),
           observaciones = 'Paso registrado por el simulador'
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

    // Log each reached city checkpoint to MongoDB
    for (const cp of reachedCheckpoints) {
      const kmText = Number(cp.distancia_acumulada_km).toFixed(1);
      const cityLabel = cp.ubicacion || `Checkpoint ${cp.numero_checkpoint}`;
      await logAuditEvent({
        modulo: "TRACKING",
        accion: "CHECKPOINT_ALCANZADO",
        id_envio: id,
        codigo_envio: String(session.codigo_envio),
        actor: "Simulador de Ruta",
        estatus: "ALCANZADO",
        actualizacion: `${cityLabel} · ${kmText} km`,
      });
    }

    if (nextProgress >= total) {
      await logAuditEvent({
        modulo: "TRACKING",
        accion: "ENVIO_ENTREGADO",
        id_envio: id,
        codigo_envio: String(session.codigo_envio),
        actor: "Simulador de Ruta",
        estatus: "ENTREGADO",
        actualizacion: `Entrega completada en ${session.nombre_cliente} (${total.toFixed(1)} km)`,
      });
    }

    return NextResponse.json({
      advanced: true,
      progressKm: nextProgress,
      delivered: nextProgress >= total,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Tracking POST error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "No se pudo actualizar el tracking.",
      500
    );
  } finally {
    connection.release();
  }
}