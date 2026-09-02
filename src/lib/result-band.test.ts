import { describe, expect, it } from "vitest";

import { resultBand, type ResultBandInput } from "./result-band";

const AHORA = new Date("2026-09-02T12:00:00Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);

function resultado(over: Partial<ResultBandInput> = {}): ResultBandInput {
  return {
    status: "active",
    freshness: "fresh",
    verificationLevel: "community_unverified",
    noLongerListed: false,
    sourceUpdatedAt: hace(30),
    observedAt: hace(5),
    lastSeenAt: hace(2),
    ...over,
  };
}

describe("resultBand — el orden importa", () => {
  it('"la fuente lo quitó" gana incluso sobre oficial', () => {
    // Da igual quién lo publicó: si la fuente leyó bien y ya no lo lista,
    // nadie responde por ese dato, y eso es lo primero que necesita saber
    // quien está por manejar hasta allá.
    const b = resultBand(
      resultado({ noLongerListed: true, verificationLevel: "official", status: "active" }),
      AHORA,
    );
    expect(b.tone).toBe("no_longer_listed");
    expect(b.label).toContain("eliminada por la fuente");
  });

  it('"sin dato" gana sobre la frescura', () => {
    // El bug que motivó separar esto: la banda de frescura dice "Confirmado"
    // por lo reciente que es NUESTRA lectura, no porque el sitio opere.
    const b = resultBand(resultado({ status: "unknown", freshness: "fresh" }), AHORA);
    expect(b.tone).toBe("unknown");
    expect(b.label).toContain("Sin dato");
    expect(b.label).not.toContain("Confirmado");
  });

  it("cerrado gana sobre la frescura, pero no sobre oficial", () => {
    expect(resultBand(resultado({ status: "closed" }), AHORA).tone).toBe("closed");
    expect(
      resultBand(resultado({ status: "closed", verificationLevel: "official" }), AHORA).tone,
    ).toBe("official");
  });
});

describe("resultBand — qué dice cada estado", () => {
  it("trata atendido como cerrado", () => {
    // No es lo mismo, pero para quien lleva una caja significan lo mismo: no
    // manejes hasta allá esperando entregarla.
    for (const status of ["closed", "fulfilled"] as const) {
      expect(resultBand(resultado({ status }), AHORA).tone, status).toBe("closed");
    }
  });

  it("nombra a la fuente oficial antes que a la frescura", () => {
    const b = resultBand(resultado({ verificationLevel: "official" }), AHORA);
    expect(b.tone).toBe("official");
    expect(b.label).toContain("Fuente oficial");
  });

  it("confirma lo fresco y no lo que no se reconfirmó", () => {
    expect(resultBand(resultado({ freshness: "fresh" }), AHORA).tone).toBe("fresh");
    for (const freshness of ["needs_reconfirmation", "stale"] as const) {
      const b = resultBand(resultado({ freshness }), AHORA);
      expect(b.tone, freshness).toBe("unconfirmed");
      expect(b.label, freshness).toContain("Sin confirmar");
    }
  });
});

describe("resultBand — de qué reloj sale cada fecha", () => {
  it("usa la fecha de la fuente cuando la publica", () => {
    const b = resultBand(
      resultado({ freshness: "fresh", sourceUpdatedAt: hace(120), observedAt: hace(1) }),
      AHORA,
    );
    expect(b.label).toContain("hace 2 horas");
  });

  it("cae en la observación solo cuando la fuente no publica fecha", () => {
    const b = resultBand(
      resultado({ freshness: "fresh", sourceUpdatedAt: null, observedAt: hace(45) }),
      AHORA,
    );
    expect(b.label).toContain("hace 45 min");
  });

  it('"sin dato" dice cuándo lo vimos, no cuándo lo observamos', () => {
    // `observedAt` se mueve cada vez que NOSOTROS releemos un registro cuya
    // fuente no sella fecha, y eso se lee como que alguien lo confirmó.
    // "Visto" es lo que de verdad pasó.
    const b = resultBand(
      resultado({
        status: "unknown",
        sourceUpdatedAt: null,
        observedAt: hace(1),
        lastSeenAt: hace(90),
      }),
      AHORA,
    );
    expect(b.label).toContain("visto hace 2 horas");
  });

  it("lo retirado también se fecha por cuándo se vio", () => {
    const b = resultBand(
      resultado({ noLongerListed: true, observedAt: hace(1), lastSeenAt: hace(180) }),
      AHORA,
    );
    expect(b.label).toContain("vista hace 3 horas");
  });
});
