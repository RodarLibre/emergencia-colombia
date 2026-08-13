/**
 * Out-of-scope policy: which questions this site refuses to answer, and why.
 *
 * Its own module, with no imports. Detection is pure and deterministic, so it
 * must be testable without a database or an inference provider — and keeping
 * it dependency-free is what makes that true.
 */

/**
 * Out-of-scope detection. ONLY deterministic: the model doesn't participate.
 *
 * At first the model could also flag a question as out of scope. It was
 * removed because with reasoning_effort low it did so at random: "donde
 * puedo llevar agua en Palmira" came back flagged as out of scope on one run
 * and normal on the next.
 *
 * The costs are very asymmetric and point the same way:
 *
 * - A false positive BLOCKS the answer for someone who just wants to know
 *   where to donate water. It's the worst possible outcome for the site.
 * - A false negative only means a search runs; the 123 notice is fixed at
 *   the top of every page and doesn't depend on this detection.
 *
 * Between failing by blocking and failing by searching, it fails by searching.
 */
/**
 * Why a question is out of scope. The reason decides which answer is given:
 * being told "this site can't help you" is useless without being told who can.
 */
export type OutOfScopeReason = "medical_emergency" | "person_safety" | "structure";

const MEDICAL_EMERGENCY_PATTERNS: RegExp[] = [
  // `sangr` used to be the stem here, which blocked "donde donar sangre para
  // los heridos" — a blood donor turned away as a medical emergency. Bleeding
  // is a verb form or a noun of its own; "sangre" alone is not.
  /\b(me\s+duele|dolor\s+de\s+pecho|no\s+puedo\s+respirar|sangrand|sangrado|me\s+sangra|hemorragia|convuls|desmay|infarto|inconsciente)/i,
  // Conjugations are accepted ("necesito", "necesitamos") rather than an exact form.
  /\b(envi\w*|mand\w*|necesit\w*|manden)\s+(una?\s+)?(ambulancia|rescate|bomberos|ayuda\s+urgente)/i,
  /\bambulancia\b/i,
  /\b(atrapad|sepultad|bajo\s+los\s+escombros)/i,
];

const STRUCTURE_PATTERNS: RegExp[] = [
  /\b(es\s+seguro|puedo\s+(volver|entrar|regresar))\b.*\b(casa|edificio|apartamento|vivienda|construccion|construcción)\b/i,
  /\b(mi\s+(casa|edificio|apartamento))\b.*\b(agrietad|fisurad|se\s+va\s+a\s+caer|colaps)/i,
];

/**
 * Questions about a specific person: whether they are hurt, where they are,
 * whether they survived.
 *
 * Detected COMPOSITIONALLY — a reference to a person AND a question about
 * their condition — instead of by listing phrasings. A list of exact sentences
 * is always one phrasing behind: "donde puedo saber si mi familiar esta
 * herido" reached the search, matched nothing, was widened until the filters
 * were gone, and answered a person asking about an injured relative with a
 * notice about schools being suspended.
 *
 * The two halves must BOTH be present, which is what keeps legitimate
 * questions working. "Donde consigo agua para mi hijo" names a person but
 * asks nothing about his condition, so it searches normally.
 */
// No trailing \b: in JavaScript \b is ASCII-only, so there is no word
// boundary after an accented vowel and /mam[áa]\b/ never matches "mamá".
const PERSON_REFERENCE =
  /\b(mi|mis|nuestr[oa]s?|un|una|alg[uú]n[ao]?)\s+(familiar\w*|pariente\w*|mam[áa]|madre|pap[áa]|padre|padres|hij[oa]s?|herman[oa]s?|espos[oa]s?|marido|abuel[oa]s?|t[íi][oa]s?|prim[oa]s?|sobrin[oa]s?|niet[oa]s?|vecin[oa]s?|amig[oa]s?|novi[oa]s?|pareja|suegr[oa]s?|cuñad[oa]s?|compañer[oa]s?|conocid[oa]s?|persona\w*|seres\s+querid\w*|desaparecid\w*|herid\w*|v[íi]ctima\w*|fallecid\w*)/i;

/**
 * A question about someone's physical condition or whereabouts. Deliberately
 * excludes bare "encontrar"/"buscar": those are handled below, and only with
 * the personal "a", because "donde puedo encontrar agua" must keep working.
 */
const PERSON_CONDITION =
  /\b(herid|lesionad|hospitaliz|internad|sobrevivi|falleci|muri[óo]|muert[oa]|con\s+vida|desaparec|rescatad|paradero|se[ñn]ales\s+de\s+vida|est[áa]\s+bien|d[óo]nde\s+est[áa]|qu[ée]\s+hospital|no\s+contesta|no\s+responde|no\s+me\s+contesta|no\s+s[ée]\s+nada|sin\s+noticias|perd[íi]\s+contacto|no\s+he\s+podido\s+(comunicar|contactar|hablar|localizar)|no\s+ha\s+(vuelto|regresado|llegado|aparecido)|no\s+lleg[óo]|no\s+aparece|sin\s+aparecer|(alguien|nadie)\s+(sabe|ha\s+visto|conoce)|sabe[ns]?\s+algo\s+de|(est[áa]|estaba|llevaron|trasladaron|internaron)\s+(en|a)\s+(un|el|qu[ée]|cu[áa]l)\s+(hospital|cl[íi]nica|centro\s+m[ée]dico|puesto\s+de\s+salud))/i;

const PERSON_SAFETY_PATTERNS: RegExp[] = [
  // The personal "a" marks a human direct object in Spanish, which is exactly
  // the distinction needed: "buscar a mi hermano" vs "buscar agua".
  // Verb stems, not infinitives: people write "estoy buscando a mi hijo" and
  // "como encuentro a mi esposa". The required " a " is what keeps "donde
  // encuentro ayuda" out — no Spanish speaker writes "encuentro a ayuda".
  /\b(encontr\w*|encuentr\w*|busc\w*|ubic\w*|localiz\w*|hall[aeo]\w*|contact\w*|saber\s+de|perd[íi]\w*|vist\w*|ver)\s+a\s+(mi|mis|un|una|alguien|alg[uú]n)/i,
  // Casualty lists, which this site does not hold and must never appear to.
  /\b(lista|listado|censo|registro|reporte)\s+(oficial\s+)?(de\s+)?(herid|lesionad|v[íi]ctima|fallecid|muert|desaparecid)/i,
  /\b(medicina\s+legal|morgue|identificaci[óo]n\s+de\s+(cuerpos|cad[áa]veres))/i,
  // Casualty questions that name no relative. Kept narrow on purpose: the verb
  // has to be about consulting a list, so "donde donar sangre para los heridos"
  // and "como puedo ayudar a los heridos" still search.
  /\b(d[óo]nde|donde)\s+(est[áa]n|reportan|publican|consulto|puedo\s+ver|puedo\s+consultar)\s+(a\s+)?(los\s+|las\s+)?(herid|lesionad|v[íi]ctima|fallecid|muert|desaparecid)/i,
  /\b(informaci[óo]n|datos|noticias?|algo|reporte)\s+(de|sobre)\s+(los\s+|las\s+)?(herid|lesionad|v[íi]ctima|fallecid|muert|desaparecid)/i,
  /\bcu[áa]nt[oa]s\s+(personas\s+)?(herid|lesionad|v[íi]ctima|fallecid|muert|desaparecid)/i,
  /\b(reportar|reporto|denunciar)\s+(un|una|a)\s+(desaparecid|persona)/i,
];

export function detectOutOfScope(question: string): OutOfScopeReason | null {
  // A person actively dying outranks everything else: that answer is "call 123".
  if (MEDICAL_EMERGENCY_PATTERNS.some((re) => re.test(question))) return "medical_emergency";
  if (PERSON_SAFETY_PATTERNS.some((re) => re.test(question))) return "person_safety";
  if (PERSON_REFERENCE.test(question) && PERSON_CONDITION.test(question)) return "person_safety";
  if (STRUCTURE_PATTERNS.some((re) => re.test(question))) return "structure";
  return null;
}
