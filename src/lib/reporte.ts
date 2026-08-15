import type { ResumenDeUso } from "./costo";

/**
 * Armado del mensaje de consumo. Puro: se prueba sin base y sin red.
 *
 * Lo que sale de aca se publica en un canal que se comparte y se reenvia, asi
 * que solo lleva agregados. Nunca preguntas, nunca usuarios.
 */

function usd(n: number): string {
  return `US$ ${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
}

function miles(n: number): string {
  return n.toLocaleString("es-CO");
}

/** Verde mientras haya holgura, ámbar al 75%, rojo al 90%. */
function color(r: ResumenDeUso): number {
  if (r.presupuestoUsd <= 0) return 0x2b7a78;
  const usado = r.total.usd / r.presupuestoUsd;
  if (usado >= 0.9) return 0xa32219;
  if (usado >= 0.75) return 0xb8860b;
  return 0x2b7a78;
}

export function construirReporte(r: ResumenDeUso, sitio: string) {
  // Preguntas arriba, costo abajo. El numero que dice si esto le sirve a
  // alguien es cuanta gente pregunto, no cuantas veces se llamo al modelo:
  // mostrando solo lo segundo, el contador parecia congelado mientras el sitio
  // se usaba, porque una pregunta repetida sale de la cache sin gastar nada.
  const campos = [
    {
      name: "Hoy",
      value:
        `**${miles(r.hoy.preguntas.total)}** preguntas\n` +
        `${miles(r.hoy.calls)} al modelo · ${usd(r.hoy.usd)}`,
      inline: true,
    },
    {
      name: "Últimos 7 días",
      value:
        `**${miles(r.ultimos7.preguntas.total)}** preguntas\n` +
        `${miles(r.ultimos7.calls)} al modelo · ${usd(r.ultimos7.usd)}`,
      inline: true,
    },
    {
      name: "Acumulado",
      value:
        `**${miles(r.total.preguntas.total)}** preguntas\n` +
        `${miles(r.total.calls)} al modelo · ${usd(r.total.usd)}`,
      inline: true,
    },
  ];

  // Cuanto del dia se resolvio sin gastar: es lo que explica por que el costo
  // no crece al mismo ritmo que el uso.
  const ahorradas = r.hoy.preguntas.cached + r.hoy.preguntas.deterministic;
  if (r.hoy.preguntas.total > 0) {
    const pct = Math.round((ahorradas / r.hoy.preguntas.total) * 100);
    campos.push({
      name: "Sin gastar inferencia hoy",
      value:
        `${miles(ahorradas)} de ${miles(r.hoy.preguntas.total)} (${pct}%) · ` +
        `${miles(r.hoy.preguntas.cached)} desde caché, ` +
        `${miles(r.hoy.preguntas.deterministic)} sin modelo`,
      inline: false,
    });
  }

  // Lo que no pudimos responder. No es un fallo tecnico: es el mapa de lo que
  // falta cubrir, y es el unico numero de aca que deberia bajar con trabajo.
  const sinRespuesta =
    r.hoy.preguntas.empty + r.hoy.preguntas.outOfCoverage + r.hoy.preguntas.outOfScope;
  if (sinRespuesta > 0) {
    campos.push({
      name: "Se fueron sin resultados hoy",
      value:
        `${miles(r.hoy.preguntas.empty)} buscaron y no había nada · ` +
        `${miles(r.hoy.preguntas.outOfCoverage)} de municipios sin cubrir · ` +
        `${miles(r.hoy.preguntas.outOfScope)} derivadas a quien sí puede`,
      inline: false,
    });
  }

  campos.push({
    name: "Tokens acumulados",
    value: `${miles(r.total.inputTokens)} entrada · ${miles(r.total.outputTokens)} salida`,
    inline: false,
  });

  if (r.presupuestoUsd > 0) {
    const restante = Math.max(0, r.presupuestoUsd - r.total.usd);
    const pct = Math.min(100, Math.round((r.total.usd / r.presupuestoUsd) * 100));
    campos.push({
      name: "Presupuesto",
      value:
        `${usd(r.total.usd)} de ${usd(r.presupuestoUsd)} · ${pct}% usado\n` +
        `Quedan ${usd(restante)}` +
        (r.diasRestantes !== null ? ` · ~${r.diasRestantes} días al ritmo actual` : ""),
      inline: false,
    });
  }

  // Los fallos van solo cuando los hay: un cero repetido cada día entrena a la
  // gente a no leer el mensaje.
  if (r.hoy.failures > 0) {
    campos.push({
      name: "Fallos del proveedor hoy",
      value: `${r.hoy.failures} — las búsquedas siguieron respondiendo sin interpretar`,
      inline: false,
    });
  }

  return {
    embeds: [
      {
        title: "Uso y consumo",
        url: sitio,
        color: color(r),
        fields: campos,
        footer: { text: "Totales agregados. No se registran preguntas ni usuarios." },
      },
    ],
  };
}
