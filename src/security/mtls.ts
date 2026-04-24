import { readFileSync } from "node:fs";
import type { PathGuard } from "./PathGuard";

export interface MtlsPaths {
  ca: string;
  cert: string;
  key: string;
}

export interface MtlsMaterial {
  ca: Buffer;
  cert: Buffer;
  key: Buffer;
  rejectUnauthorized: true;
  minVersion: "TLSv1.3";
  maxVersion: "TLSv1.3";
  servername?: string;
}

export interface LoadMtlsOptions {
  paths: MtlsPaths;
  servername?: string;
  pathGuard?: PathGuard;
}

export function loadMtls(opts: LoadMtlsOptions): MtlsMaterial {
  const { paths, pathGuard } = opts;
  const resolvePath = (p: string): string => (pathGuard ? pathGuard.resolve(p) : p);
  return {
    ca: readFileSync(resolvePath(paths.ca)),
    cert: readFileSync(resolvePath(paths.cert)),
    key: readFileSync(resolvePath(paths.key)),
    rejectUnauthorized: true,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    servername: opts.servername,
  };
}

// The fields that `pg`'s PoolConfig.ssl accepts. Kept narrow here so we don't
// pull a runtime dependency on @types/node TlsOptions into the security module.
export type TlsSecureVersion = "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3";

export interface PgSslOptions {
  ca: Buffer;
  cert: Buffer;
  key: Buffer;
  rejectUnauthorized: boolean;
  minVersion?: TlsSecureVersion;
  maxVersion?: TlsSecureVersion;
  servername?: string;
}

export function toPgSsl(material: MtlsMaterial): PgSslOptions {
  return {
    ca: material.ca,
    cert: material.cert,
    key: material.key,
    rejectUnauthorized: material.rejectUnauthorized,
    minVersion: material.minVersion,
    maxVersion: material.maxVersion,
    servername: material.servername,
  };
}
