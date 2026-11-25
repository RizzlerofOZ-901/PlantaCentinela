export type SessionUser = {
  id_usuario: number;
  nombre_completo: string;
  rol: "ADMINISTRADOR" | "OPERADOR" | "SUPERVISOR" | "AUDITOR";
  departamento: string;
  isAdmin?: boolean;
};

const STORAGE_KEY = "planta_centinela_user";

export function getSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function setSessionUser(user: SessionUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearSessionUser() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function getAllowedRoutes(user: SessionUser | null): string[] {
  if (!user) return [];
  const rol = user.rol.toUpperCase();
  const dep = user.departamento.toUpperCase();

  if (user.isAdmin || rol === "ADMINISTRADOR") {
    return [
      "/inicio",
      "/envios",
      "/documentos",
      "/riesgo-rutas",
      "/inspeccion",
      "/inspeccion-mercancia",
      "/aprobaciones",
      "/usuarios",
      "/tracking",
      "/auditoria",
    ];
  }

  if (rol === "AUDITOR") {
    return [
      "/inicio",
      "/envios",
      "/documentos",
      "/riesgo-rutas",
      "/inspeccion",
      "/inspeccion-mercancia",
      "/aprobaciones",
      "/tracking",
      "/auditoria",
    ];
  }

  if (rol === "SUPERVISOR") {
    return [
      "/inicio",
      "/envios",
      "/documentos",
      "/riesgo-rutas",
      "/inspeccion",
      "/inspeccion-mercancia",
      "/aprobaciones",
      "/tracking",
    ];
  }

  if (rol === "OPERADOR") {
    if (dep === "TRAFICO") {
      return ["/inicio", "/envios", "/documentos"];
    }
    if (dep === "TRACKING") {
      return ["/inicio", "/envios", "/riesgo-rutas", "/tracking"];
    }
    if (dep === "INSPECCION") {
      return [
        "/inicio",
        "/envios",
        "/riesgo-rutas",
        "/inspeccion",
        "/inspeccion-mercancia",
      ];
    }
  }

  return ["/inicio"];
}

export function canCreateShipment(user: SessionUser | null): boolean {
  if (!user) return false;
  const rol = user.rol.toUpperCase();
  const dep = user.departamento.toUpperCase();
  if (
    user.isAdmin ||
    rol === "ADMINISTRADOR" ||
    rol === "SUPERVISOR" ||
    rol === "AUDITOR"
  ) {
    return true;
  }
  return rol === "OPERADOR" && dep === "TRAFICO";
}

/**
 * Standard format: "25 nov 2026 12:00 p.m."
 */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    const s = String(value).trim();
    const normalized = s.includes("T") ? s : s.replace(" ", "T");
    date = new Date(normalized);
  }
  if (Number.isNaN(date.getTime())) return "—";

  const formatted = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  return formatted
    .replace(",", "")
    .replace(/\u00a0|\u202f/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function statusClass(value: unknown): string {
  const s = String(value ?? "").toUpperCase().replaceAll(" ", "_");
  if (
    [
      "ENTREGADO",
      "LISTO",
      "COMPLETA",
      "APROBADO",
      "BUENO",
      "EXCELENTE",
      "ALCANZADO",
      "ACTIVO",
    ].includes(s)
  ) {
    return "status-pill status-green";
  }
  if (
    [
      "EN_TRANSITO",
      "CARGANDO",
      "EN_ORIGEN",
      "EN_PROGRESO",
      "EN_PROCESO",
      "PENDIENTE",
      "ACEPTABLE",
    ].includes(s)
  ) {
    return "status-pill status-yellow";
  }
  if (["CREADO"].includes(s)) {
    return "status-pill status-blue";
  }
  if (
    [
      "RECHAZADO",
      "CANCELADO",
      "NO_ENTREGADO",
      "RETRASADO",
      "MALO",
      "RETRABAJO",
      "BLOQUEADO",
      "ELIMINADO",
    ].includes(s)
  ) {
    return "status-pill status-red";
  }
  if (["REGULAR", "OBSERVACIONES", "DESVIO"].includes(s)) {
    return "status-pill status-orange";
  }
  return "status-pill status-neutral";
}
