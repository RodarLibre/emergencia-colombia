# Agregar palabras que la gente usa

Cuando alguien escribe una pregunta, el sitio decide dos cosas antes de buscar:

1. **¿Esto es de la emergencia?** Si ninguna palabra se lo dice, responde "eso
   no lo tengo" y no busca nada.
2. **¿Qué está pidiendo?** Agua, alojamiento, alimentos… eso es lo que filtra
   los resultados.

Las dos salen del mismo archivo: **`src/lib/data/vocabulario.json`**.

Esta es la forma de aportar que **no requiere saber programar** y que más
sirve. Quien vive en Buga sabe que allá se dice "remesa" y no "mercado"; eso no
lo adivina nadie desde afuera.

## Cómo se ve

```json
{
  "terminosDeDominio": ["acopio", "albergue", "damnificad", "..."],
  "palabrasPorCategoria": {
    "food": ["alimento", "mercado", "remesa", "ancheta"],
    "shelter": ["albergue", "dormir", "cambuche", "sin casa"]
  }
}
```

- **`terminosDeDominio`**: palabras que dicen "esto es de la emergencia", sin
  indicar qué se necesita. `sismo`, `damnificad`, `alcaldia`.
- **`palabrasPorCategoria`**: palabras que además dicen **qué** se pide. Son
  las que hacen que la búsqueda encuentre algo útil.

Los nombres de categoría (`food`, `shelter`, `water`…) están fijos en
`src/lib/vocab.ts`. No se inventan: si escribís uno que no existe, los tests
fallan.

## Las tres reglas

**1. Todo en minúsculas y sin tildes.** La comparación se hace contra el texto
ya normalizado, así que `"bañarse"` con ñ **no coincide nunca con nada**. Se
escribe `banarse`. Es el error más fácil de cometer y el más difícil de notar,
porque no rompe nada: simplemente no funciona.

**2. Se busca por pedazo, no por palabra completa.** `acopio` también coincide
con "acopios" y "punto de acopio". Por eso conviene escribir la raíz:
`damnificad` cubre damnificado, damnificada y damnificados. Y por eso **no hay
que agregar plurales**: si ya está `acopio`, poner `acopios` no aporta nada.

**3. Cuidado con las palabras cortas o comunes.** Como se busca por pedazo,
`vela` coincide dentro de "novela" y `clases` dentro de "clases de inglés".
Cuando una palabra es ambigua, se escribe la forma que nadie usa por accidente:
`velas` en vez de `vela`, `suspension de clases` en vez de `clases`, `para
bebe` en vez de `bebe` —que si no, coincide con el verbo beber—.

## Qué pasa si te equivocás

Nada grave: los tests avisan antes de que llegue a producción.

```bash
pnpm test
```

Hay cinco reglas que se verifican solas: tildes, categorías inexistentes,
repetidos, palabras de menos de cuatro letras, y palabras que ya están
cubiertas por otra de la misma lista.

## Cómo saber qué falta

El método que ha encontrado todos los huecos hasta ahora no es leer el código:
es escribir 40 frases como las diría la gente de verdad —con errores de tipeo,
sin tildes, en el español de tu región— y ver cuáles rebotan. Está en
`src/lib/vocabulary.test.ts`; se agregan frases nuevas y se corre `pnpm test`.

Dos tandas de 40 encontraron nueve fallos cada una. Entre ellos:

- `recolecta`, que es **la palabra que usan las propias fuentes** en sus
  títulos.
- `estoy sin casa` y `mi casa se cayó`. Quien lo perdió todo no escribe
  "albergue": escribe lo que le pasó. Era la frase más desesperada que podía
  llegarnos y era de las que menos posibilidades tenía de ser entendida.
- La categoría `baby_supplies` existía desde el principio **sin una sola
  palabra que pudiera activarla**. Estaba declarada, tenía etiqueta en español,
  se mostraba en las tarjetas — y era inalcanzable.

## Al agregar, cuidado con el otro lado

Es tentador agregar de todo. Pero el mensaje "eso no lo tengo" no es un
rechazo: le dice a la gente para qué sirve el sitio. Si el vocabulario se abre
demasiado, una pregunta sobre el clima entra, no encuentra nada, y la persona
se queda sin entender qué pasó.

Al agregar palabras, conviene sumar también un par de frases ajenas al bloque
`NO_SE_BUSCAN` de `vocabulary.test.ts`. Cuando se agregó `clases`, doce de
dieciocho preguntas ajenas empezaron a pasar; el test lo mostró de inmediato.

Entre las dos formas de fallar, la preferida es buscar de más: una búsqueda que
no encuentra nada es molesta, pero negarle la respuesta a alguien que la
necesitaba es peor.
