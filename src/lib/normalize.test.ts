import { describe, expect, it } from "vitest";

import {
  buildTextQuery,
  extractCategories,
  findMunicipalityInText,
  fold,
  resolveMunicipality,
} from "./normalize";

describe("fold", () => {
  it.each([
    ["Tuluá", "tulua"],
    ["Jamundí", "jamundi"],
    ["BUENAVENTURA", "buenaventura"],
    ["Cañón", "canon"],
    ["  Palmira  ", "palmira"],
  ])("folds %s to %s", (input, expected) => {
    expect(fold(input)).toBe(expected);
  });
});

describe("resolveMunicipality", () => {
  it.each([
    ["Palmira", "76520"],
    ["palmira", "76520"],
    ["PALMIRA", "76520"],
    ["Tuluá", "76834"],
    ["tulua", "76834"],
  ])("resolves %s to %s", (input, code) => {
    expect(resolveMunicipality(input)?.code).toBe(code);
  });

  it("resolves a partial match within the operating department", () => {
    // "buga" -> Guadalajara de Buga
    expect(resolveMunicipality("buga")?.code).toBe("76111");
  });

  it("prefers the operating department for a name shared with Atlántico", () => {
    expect(resolveMunicipality("Candelaria")?.code).toBe("76130");
  });

  it("prefers the operating department for a name shared with Antioquia/Nariño/Sucre", () => {
    expect(resolveMunicipality("La Unión")?.code).toBe("76400");
  });

  it("prefers the operating department for a name shared with Meta", () => {
    expect(resolveMunicipality("Restrepo")?.code).toBe("76606");
  });

  it("resolves a nationally unique name", () => {
    expect(resolveMunicipality("Medellín")?.code).toBe("05001");
  });

  it("resolves the short form of a DANE name with an administrative suffix", () => {
    // DANE calls it "Bogotá, D.C."
    expect(resolveMunicipality("Bogotá")?.code).toBe("11001");
  });

  it("returns null for a name ambiguous outside the operating department", () => {
    // Villanueva exists in 4 departments, none of them Valle
    expect(resolveMunicipality("Villanueva")).toBeNull();
  });

  it.each(["la", "san"])("returns null for %s, too short to disambiguate", (input) => {
    expect(resolveMunicipality(input)).toBeNull();
  });

  it.each(["Xyzabc", "", null])("returns null for %s", (input) => {
    expect(resolveMunicipality(input)).toBeNull();
  });
});

describe("findMunicipalityInText — beneficiary is not location", () => {
  it("does not match a collection point in Cali gathering aid for Versalles", () => {
    expect(
      findMunicipalityInText("Campana de solidaridad con Versalles Norte del Valle"),
    ).toBeNull();
  });

  it("does not match 'para Tulua'", () => {
    expect(findMunicipalityInText("Recoleccion para Tulua")).toBeNull();
  });

  it("does not match 'hacia Buenaventura'", () => {
    expect(findMunicipalityInText("Donaciones hacia Buenaventura")).toBeNull();
  });
});

describe("findMunicipalityInText — proper nouns that match municipality names", () => {
  it("resolves Cali, not San Pedro, from a school named after a saint", () => {
    expect(findMunicipalityInText("Colegio San Pedro Claver de Cali")?.name).toBe("Cali");
  });

  it("resolves Palmira, not La Victoria, from a venue named after La Victoria", () => {
    expect(findMunicipalityInText("Centro La Victoria en Palmira")?.name).toBe("Palmira");
  });

  it("does not match a bare venue name with no locative preposition", () => {
    expect(findMunicipalityInText("Parque San Pedro")).toBeNull();
  });
});

describe("findMunicipalityInText — municipalities that are also neighborhoods", () => {
  it("matches San Pedro when preceded by a locative preposition", () => {
    expect(findMunicipalityInText("acopio en San Pedro")?.name).toBe("San Pedro");
  });

  it("does not match a bare mention of Versalles (a Cali neighborhood)", () => {
    expect(findMunicipalityInText("Barrio Versalles")).toBeNull();
  });

  it("does not match a bare mention of La Union (also an institution name)", () => {
    expect(findMunicipalityInText("Institucion Educativa La Union")).toBeNull();
  });
});

describe("findMunicipalityInText — word boundaries", () => {
  it("resolves the curated alias 'Buga' to Guadalajara de Buga", () => {
    expect(findMunicipalityInText("donde puedo llevar agua en Buga")?.name).toBe(
      "Guadalajara de Buga",
    );
  });

  it("does not let 'Buga' match inside 'Bugalagrande'", () => {
    expect(findMunicipalityInText("acopio en Bugalagrande")?.name).toBe("Bugalagrande");
  });

  it("does not let 'agua' match Dagua", () => {
    expect(findMunicipalityInText("donde llevo agua")).toBeNull();
  });

  it("matches Dagua with a locative preposition", () => {
    expect(findMunicipalityInText("punto en Dagua")?.name).toBe("Dagua");
  });

  it("matches Tulua with a locative preposition, without an accent in the input", () => {
    expect(findMunicipalityInText("albergue en Tulua")?.name).toBe("Tuluá");
  });
});

describe("extractCategories — donacion is deliberately unmapped", () => {
  it("does not map a request to donate goods to cash_or_donation", () => {
    // "donde recibo donaciones en Buga" was filtered to cash_or_donation and
    // returned 0 of Buga's 7 collection points. After an earthquake,
    // "donacion" almost always means bringing supplies, not money.
    expect(extractCategories("donde recibo donaciones en Buga")).not.toContain("cash_or_donation");
  });

  it("still maps unambiguous money words", () => {
    expect(extractCategories("quiero donar dinero")).toContain("cash_or_donation");
  });
});

describe("extractCategories", () => {
  it.each([
    ["donde llevo agua", "water"],
    ["necesito dejar comida", "food"],
    ["se necesitan cascos y guantes", "rescue_equipment"],
    ["pañales y toallas", "hygiene"],
    ["busco donde dormir", "shelter"],
  ])("extracts %s from %s", (input, category) => {
    expect(extractCategories(input)).toContain(category);
  });

  it("returns an empty array when nothing matches", () => {
    expect(extractCategories("xyz")).toEqual([]);
  });
});

describe("buildTextQuery", () => {
  it("joins terms with 'or' and drops stopwords", () => {
    const query = buildTextQuery("donde puedo llevar agua en Palmira");
    expect(query).toContain("agua");
    expect(query).toContain("palmira");
    expect(query).toContain(" or ");
    expect(query).not.toMatch(/\bdonde\b/);
    expect(query).not.toMatch(/\bpuedo\b/);
  });

  it("returns null for an empty string", () => {
    expect(buildTextQuery("")).toBeNull();
  });

  it("falls back to the folded text when every word is a stopword", () => {
    const query = buildTextQuery("de la el y");
    expect(query).not.toBeNull();
    expect(query).toBe(fold("de la el y"));
  });
});
