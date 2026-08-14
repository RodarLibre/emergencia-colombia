import { describe, expect, it } from "vitest";

import { CALI_AYUDA_SOURCE } from "./adapters/cali-ayuda";
import { DONDE_AYUDO_SOURCE } from "./adapters/donde-ayudo";
import { MAPA_EMERGENCIA_SOURCE } from "./adapters/mapa-emergencia";
import { redactContact } from "./types";

/**
 * Espejar contactos es la excepcion, no la regla.
 *
 * El invariante cambio —de "no se copian" a "se espejan solo desde fuentes
 * que recogen consentimiento"— pero el valor por defecto sigue siendo no
 * publicarlos. Una fuente que no lo declare explicitamente no puede empezar a
 * traer telefonos porque cambie su formato.
 */

describe("por defecto no se espejan contactos", () => {
  for (const fuente of [CALI_AYUDA_SOURCE, DONDE_AYUDO_SOURCE, MAPA_EMERGENCIA_SOURCE]) {
    it(`${fuente.slug} no los espeja`, () => {
      expect((fuente as { mirrorsContacts?: boolean }).mirrorsContacts ?? false).toBe(false);
    });
  }
});

describe("la redaccion sigue aplicando a todo texto libre", () => {
  it("borra un celular colombiano", () => {
    expect(redactContact("Acopio Palmira, llamar al 3153591165")).not.toContain("3153591165");
  });

  it("borra un fijo de siete cifras", () => {
    expect(redactContact("Llamar al 5551234")).not.toContain("5551234");
  });

  it("deja el resto del texto intacto", () => {
    expect(redactContact("Acopio Palmira, Calle 27 #35-00")).toContain("Calle 27 #35-00");
  });
});
