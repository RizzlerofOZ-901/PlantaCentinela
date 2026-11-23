import { NextRequest, NextResponse } from "next/server";
import { getAuditDb } from "@/app/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const idEnvioParam = request.nextUrl.searchParams.get("id_envio");
  const moduloParam = request.nextUrl.searchParams.get("modulo");

  try {
    const db = await getAuditDb();
    const filter: Record<string, unknown> = {};

    if (idEnvioParam) {
      const idEnvio = Number(idEnvioParam);
      if (!Number.isInteger(idEnvio) || idEnvio <= 0) {
        return NextResponse.json(
          { error: "id_envio inválido." },
          { status: 400 }
        );
      }
      filter.id_envio = idEnvio;
    }

    if (moduloParam) {
      filter.modulo = moduloParam.toUpperCase();
    }

    const events = await db
      .collection("auditorias")
      .find(filter)
      .sort({ fecha_evento: 1 })
      .limit(500)
      .toArray();

    return NextResponse.json(events);
  } catch (error) {
    console.error("GET /api/auditoria error:", error);
    return NextResponse.json(
      {
        error: "No se pudo consultar la auditoría en MongoDB.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}