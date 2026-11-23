import { MongoClient, type Db } from "mongodb";

export type AuditModule =
  | "ENVIO"
  | "DOCUMENTOS"
  | "RIESGO_RUTA"
  | "INSPECCION_CARGA"
  | "APROBACIONES"
  | "TRACKING"
  | "USUARIOS";

export type AuditEventInput = {
  modulo: AuditModule;
  accion: string;
  id_envio?: number | null;
  codigo_envio?: string | null;
  actor?: string | null;
  estatus?: string | null;
  actualizacion: string;
  detalles?: Record<string, unknown>;
};

const globalForMongo = globalThis as unknown as {
  _mongoClientPromise?: Promise<MongoClient>;
};

function getClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Falta configurar la variable MONGODB_URI.");
  }
  if (!globalForMongo._mongoClientPromise) {
    const client = new MongoClient(uri);
    globalForMongo._mongoClientPromise = client.connect();
  }
  return globalForMongo._mongoClientPromise;
}

export async function getAuditDb(): Promise<Db> {
  const client = await getClientPromise();
  const dbName = process.env.MONGODB_DB || "planta_centinela_auditoria";
  return client.db(dbName);
}

/**
 * Saves an audit event to MongoDB without breaking the main MariaDB flow.
 */
export async function logAuditEvent(event: AuditEventInput): Promise<void> {
  if (!process.env.MONGODB_URI) return;
  try {
    const db = await getAuditDb();
    await db.collection("auditorias").insertOne({
      ...event,
      fecha_evento: new Date(),
    });
  } catch (error) {
    console.error("MongoDB audit log error:", error);
  }
}