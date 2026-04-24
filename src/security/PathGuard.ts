import { resolve, sep } from "node:path";

export class PathGuardViolation extends Error {
  readonly attempted: string;
  readonly root: string;
  constructor(attempted: string, root: string) {
    super(`Path "${attempted}" escapes data volume ${root}`);
    this.name = "PathGuardViolation";
    this.attempted = attempted;
    this.root = root;
  }
}

export class PathGuard {
  readonly root: string;

  constructor(dataDir: string) {
    const resolved = resolve(dataDir);
    this.root = resolved.endsWith(sep) ? resolved.slice(0, -sep.length) : resolved;
  }

  resolve(relativeOrAbsolute: string): string {
    if (relativeOrAbsolute === "" || relativeOrAbsolute == null) {
      throw new PathGuardViolation(String(relativeOrAbsolute), this.root);
    }
    const abs = resolve(this.root, relativeOrAbsolute);
    const rootPrefix = this.root + sep;
    if (abs !== this.root && !abs.startsWith(rootPrefix)) {
      throw new PathGuardViolation(relativeOrAbsolute, this.root);
    }
    return abs;
  }

  isInside(candidate: string): boolean {
    try {
      this.resolve(candidate);
      return true;
    } catch {
      return false;
    }
  }
}

export function pathGuardFromEnv(envVar = "SG_DATA_DIR", fallback = "/data"): PathGuard {
  return new PathGuard(process.env[envVar] ?? fallback);
}
