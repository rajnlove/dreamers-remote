import { ValidationError } from "./errors.js";
import type { WorkstationInput, WorkstationUpdateInput } from "./types.js";

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export function isValidIPv4(value: string): boolean {
  if (!IPV4_RE.test(value)) return false;
  return value.split(".").every((octet) => {
    const n = Number(octet);
    return n >= 0 && n <= 255 && String(n) === octet;
  });
}

export function isValidMacAddress(value: string): boolean {
  return MAC_RE.test(value);
}

export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required and must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, field);
}

export function validateCreateInput(body: unknown): WorkstationInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be an object");
  }
  const b = body as Record<string, unknown>;

  const name = requireString(b.name, "name");
  const hostname = requireString(b.hostname, "hostname");

  const ip = requireString(b.ip, "ip");
  if (!isValidIPv4(ip)) {
    throw new ValidationError("ip must be a valid IPv4 address");
  }

  const mac_address = requireString(b.mac_address, "mac_address");
  if (!isValidMacAddress(mac_address)) {
    throw new ValidationError("mac_address must be in the form XX:XX:XX:XX:XX:XX");
  }

  const vnc_port = b.vnc_port === undefined ? 5900 : Number(b.vnc_port);
  if (!isValidPort(vnc_port)) {
    throw new ValidationError("vnc_port must be an integer between 1 and 65535");
  }

  return {
    name,
    hostname,
    ip,
    mac_address,
    vnc_port,
    location: optionalString(b.location, "location"),
    description: optionalString(b.description, "description"),
    enabled: b.enabled === undefined ? true : Boolean(b.enabled),
  };
}

export function validateUpdateInput(body: unknown): WorkstationUpdateInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be an object");
  }
  const b = body as Record<string, unknown>;
  const result: WorkstationUpdateInput = {};

  if (b.name !== undefined) {
    result.name = requireString(b.name, "name");
  }
  if (b.hostname !== undefined) {
    result.hostname = requireString(b.hostname, "hostname");
  }
  if (b.ip !== undefined) {
    const ip = requireString(b.ip, "ip");
    if (!isValidIPv4(ip)) {
      throw new ValidationError("ip must be a valid IPv4 address");
    }
    result.ip = ip;
  }
  if (b.mac_address !== undefined) {
    const mac = requireString(b.mac_address, "mac_address");
    if (!isValidMacAddress(mac)) {
      throw new ValidationError("mac_address must be in the form XX:XX:XX:XX:XX:XX");
    }
    result.mac_address = mac;
  }
  if (b.vnc_port !== undefined) {
    const port = Number(b.vnc_port);
    if (!isValidPort(port)) {
      throw new ValidationError("vnc_port must be an integer between 1 and 65535");
    }
    result.vnc_port = port;
  }
  if (b.location !== undefined) {
    result.location = optionalString(b.location, "location");
  }
  if (b.description !== undefined) {
    result.description = optionalString(b.description, "description");
  }
  if (b.enabled !== undefined) {
    result.enabled = Boolean(b.enabled);
  }

  if (Object.keys(result).length === 0) {
    throw new ValidationError("At least one field must be provided");
  }

  return result;
}
