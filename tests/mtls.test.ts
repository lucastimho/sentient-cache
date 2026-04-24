import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMtls, toPgSsl } from "../src/security/mtls";
import { PathGuard } from "../src/security/PathGuard";

function seedMaterial(): { dir: string; ca: string; cert: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), "sg-mtls-"));
  const ca = join(dir, "ca.pem");
  const cert = join(dir, "client.crt");
  const key = join(dir, "client.key");
  writeFileSync(ca, "----- FAKE CA -----\n");
  writeFileSync(cert, "----- FAKE CERT -----\n");
  writeFileSync(key, "----- FAKE KEY -----\n");
  return { dir, ca, cert, key };
}

describe("loadMtls", () => {
  test("reads CA, cert, and key; pins TLS 1.3; requires auth", () => {
    const { dir, ca, cert, key } = seedMaterial();
    try {
      const material = loadMtls({ paths: { ca, cert, key }, servername: "central.internal" });
      expect(material.ca.toString()).toMatch(/FAKE CA/);
      expect(material.cert.toString()).toMatch(/FAKE CERT/);
      expect(material.key.toString()).toMatch(/FAKE KEY/);
      expect(material.rejectUnauthorized).toBe(true);
      expect(material.minVersion).toBe("TLSv1.3");
      expect(material.maxVersion).toBe("TLSv1.3");
      expect(material.servername).toBe("central.internal");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("toPgSsl projects a shape compatible with pg PoolConfig.ssl", () => {
    const { dir, ca, cert, key } = seedMaterial();
    try {
      const material = loadMtls({ paths: { ca, cert, key } });
      const ssl = toPgSsl(material);
      expect(ssl).toHaveProperty("ca");
      expect(ssl).toHaveProperty("cert");
      expect(ssl).toHaveProperty("key");
      expect(ssl.rejectUnauthorized).toBe(true);
      expect(ssl.minVersion).toBe("TLSv1.3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses to read material from outside the PathGuard root", () => {
    const { dir, ca, cert, key } = seedMaterial();
    try {
      const guard = new PathGuard("/tmp/sg-mtls-locked");
      expect(() =>
        loadMtls({ paths: { ca, cert, key }, pathGuard: guard }),
      ).toThrow(/escapes data volume/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
