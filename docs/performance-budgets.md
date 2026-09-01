# Objetivos de rendimiento

`CLOVERCODE_MASTER.md` §33, Fase 26: **medir antes de optimizar**, y **crear
objetivos de rendimiento**. Este documento es la segunda parte; los números
salen de la primera.

Cada presupuesto de aquí tiene un test que falla cuando se supera. Un
presupuesto que nadie comprueba es un deseo.

---

## Cómo están puestos los números

Ligeramente por encima de lo medido, nunca en una cifra redonda que sonara bien.

Un presupuesto por debajo del valor actual es una build rota el primer día. Uno
muy por encima no se dispara nunca. Las dos cosas son formas de no tener
presupuesto.

---

## Bundle de cliente

```text
Medido    1.6 MB de JavaScript en .next/static
Objetivo  < 3 MB
Test      TEST-2602, src/tests/unit/performance-budgets.test.ts
```

Se mide del build real, no de una estimación. El test se salta si no hay `.next`
en el árbol —`npm run test` corre sin build— y mide en CI, que construye antes.

---

## Client components

```text
Medido    52 de 140 componentes (37%)
Objetivo  <= 60 componentes, y siempre menos del 50% del total
Test      TEST-2603
```

§18 nombra dos veces lo mismo: "client components innecesarios" y "JS
innecesario". Ningún `"use client"` concreto está mal; lo que se vigila es la
tendencia, porque cada uno es JavaScript que viaja a un móvil peruano.

---

## Consultas de lista

```text
Medido    26 de 34 lecturas de lista sin ningún límite
Objetivo  0
Test      TEST-2618
```

`LIST_CAP = 500` es el techo que lleva toda lectura de lista, incluso las que
nadie pagina. No es un tamaño de página: es lo que convierte "esta consulta lee
la tabla" en "esta consulta lee como mucho esto".

`MAX_PAGE_SIZE = 100` es lo máximo que un cliente puede pedir en una lista
paginada. Se aplica en el servidor: un `?limit=1000000` se recorta, no se
obedece.

**Una lista que legítimamente supere `LIST_CAP` necesita paginación, no un techo
más alto.** Subir el número para que una pantalla funcione es el arreglo
equivocado.

---

## Planes de consulta

```text
Objetivo  Ninguna consulta caliente hace Seq Scan con volumen cargado
Objetivo  Toda tabla caliente pequeña tiene un índice USABLE para su forma
Test      TEST-2604 a TEST-2613, src/tests/database/query-plans.test.ts
```

Dos afirmaciones distintas a propósito:

- Sobre tablas grandes —`products`, `orders`, `order_items`, `customers`— se
  exige que el planificador **elija** el índice.
- Sobre tablas calientes pero pequeñas —`locations`, `tenant_members`,
  `tenant_domains`— se exige que el índice **exista y sea usable**, no que se
  elija. Con doscientas filas el escaneo secuencial es el plan correcto, y
  afirmar lo contrario sería afirmar algo falso.

El arnés carga ~40 tenants con volumen y ejecuta `ANALYZE` antes de medir. Un
`EXPLAIN` sobre una tabla vacía no prueba nada: el planificador elige escaneo
secuencial siempre, haya índice o no.

---

## Latencia

```text
Objetivo  Consulta lenta = > 200 ms, registrada como warn
Test      TEST-2620 a TEST-2622
```

El umbral es de aviso, no un SLO. Los objetivos de latencia reales —p95 de API,
p95 de base de datos— necesitan un entorno desplegado y tráfico; esta fase deja
la instrumentación puesta y el número se fija cuando haya con qué medirlo
(KL-2601).

---

## Lo que esta fase NO fijó, y por qué

```text
Latencia real de API y de base de datos
  Necesita un despliegue. Inventar un p95 sin tráfico sería un número decorativo.

Vistas materializadas para reportes
  ADR-027 las condiciona a que esta fase midiera un umbral. Se midió y no se
  cruzó: los reportes agregan sobre índices existentes y no hay volumen que lo
  justifique todavía.

Rutas estáticas
  Cero, y es correcto. ADR-029 (Fase 25) ya lo midió: el nonce del CSP obliga a
  render dinámico. Revertirlo es una decisión de seguridad, no de rendimiento.

Optimización de imágenes
  Las imágenes de tenant salen por URL firmada de un bucket privado, que
  `next/image` no puede optimizar sin proxy. Queda anotado, no resuelto.
```
