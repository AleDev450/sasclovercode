Quiero que implementes el frontend completo de una landing page SaaS para “Vendra”.

Usa como referencia visual principal la imagen adjunta. Quiero una implementación MUY fiel al diseño, pero no una copia rígida pixel por pixel: conserva la composición, jerarquía, estética premium, espaciados, proporciones y lenguaje visual.

==================================================
CONTEXTO DEL PRODUCTO
==================================================

Vendra es un SaaS pensado principalmente para restaurantes peruanos.

NO es una tienda de ropa.
NO es un ecommerce genérico.
NO es un marketplace.

Vendra permite que un restaurante pueda tener:

- Su propia web.
- Carta digital.
- Pedidos online.
- Pedidos mediante QR desde una mesa.
- Pagos online.
- Yape / Plin / tarjetas.
- Delivery y recojo.
- Gestión de pedidos.
- Cocina / KDS.
- POS.
- Inventario.
- Reportes.
- Gestión de mesas.
- Facturación electrónica.
- Múltiples sedes en planes avanzados.

El público objetivo son restaurantes, cafeterías, cevicherías, pollerías, dark kitchens, negocios gastronómicos y emprendimientos de comida en Perú.

La landing debe transmitir:

“Tu restaurante puede verse y operar como una gran marca.”

==================================================
STACK
==================================================

Quiero la implementación con:

- Next.js
- App Router
- TypeScript
- Tailwind CSS
- Lucide Icons
- Framer Motion SOLO donde aporte valor

Si el proyecto ya tiene alguna de estas tecnologías configuradas, reutiliza la configuración existente.

NO instales librerías innecesarias.

Evita dependencias pesadas.

==================================================
OBJETIVO VISUAL
==================================================

La landing tiene que sentirse como una mezcla de:

- Stripe
- Shopify
- Linear
- Square
- Toast
- SaaS gastronómico premium

Pero con identidad propia de Vendra y enfocada al mercado peruano.

Debe sentirse:

- Premium
- Moderna
- Comercial
- Confiable
- Tecnológica
- Minimalista
- Elegante
- Muy bien diseñada

NO quiero que parezca:

- Template barato de ThemeForest.
- Landing genérica generada por IA.
- Página de restaurante tradicional.
- ERP antiguo.
- Software corporativo aburrido.

==================================================
IDENTIDAD VISUAL
==================================================

Paleta aproximada:

Background principal:
#FAFAF8
o un blanco cálido muy ligero.

Texto principal:
#111814

Texto secundario:
#66706B

Verde Vendra principal:
aprox #087A5B

Verde oscuro:
aprox #075C48

Verde muy claro para backgrounds:
#EAF8F2

Borders:
#E7EBE8

Cards:
#FFFFFF

CTA oscuro:
#062E27

No satures la página de verde.

El verde debe usarse principalmente como:
- acento
- CTA
- iconos
- estados positivos
- highlights

==================================================
TIPOGRAFÍA
==================================================

Los títulos grandes deben tener una apariencia editorial/premium.

Puedes usar algo similar a:

Headings:
- DM Serif Display
o
- Playfair Display

Body/UI:
- Inter
o
- Geist

Preferencia:

DM Serif Display + Inter

El resultado debe sentirse sofisticado pero moderno.

Hero headline:
aprox 64px desktop.

Secciones:
38-46px.

Body:
16-18px.

==================================================
LAYOUT GENERAL
==================================================

Desktop:

max-width aproximado:
1280px

Padding lateral:
32-48px

Mucho whitespace.

Usa grids amplios.

Evita que todo esté excesivamente compacto.

Border radius:
14px - 22px

Shadows:
muy suaves.

==================================================
HEADER
==================================================

Header blanco, limpio y elegante.

Debe contener:

Izquierda:
Logo Vendra.

Puedes crear temporalmente el logo usando:

[icono V estilizado] Vendra

Si existe asset del logo en /public úsalo.

Centro:

Producto
Soluciones
Precios
Cómo funciona

Con pequeños chevrons en los elementos donde tenga sentido.

Derecha:

Ingresar

Botón:
“Crear mi restaurante →”

El header debe ser sticky opcionalmente:

position: sticky
top: 0

Con backdrop-blur ligero al hacer scroll.

No debe verse pesado.

==================================================
HERO
==================================================

Desktop:
grid aproximadamente 46% / 54%.

LEFT:

Eyebrow opcional pequeño.

Headline:

“Haz que tu restaurante
venda como una
gran marca.”

Resalta:

“gran marca.”

en verde Vendra.

Subheadline:

“Crea la web de tu restaurante, recibe pedidos en mesa,
online y por delivery, y administra tu operación desde
un solo lugar.”

Debajo:

“Hecho para restaurantes peruanos 🇵🇪”

CTAs:

Primario:
“Crear mi restaurante →”

Secundario:
icono play
“Ver cómo funciona”

Debajo crear fila de 5 beneficios:

Web y carta digital
Pagos online
Pedidos por QR
Delivery
Cocina & POS

Cada uno con:

- icono circular
- fondo verde muy claro
- icono verde
- label pequeño

==================================================
VISUAL DEL HERO
==================================================

Esta parte es MUY importante.

Quiero recrear la sensación de la imagen de referencia.

Debe haber 3 elementos superpuestos:

1.
Browser mockup principal con web de restaurante.

Restaurante ficticio:

COSTA NORTE
Cocina Peruana

Nav:

Inicio
Nuestra carta
Nosotros
Reservas

CTA:
Pedir ahora

Hero dentro del browser:

“Sabores del Perú
en cada plato”

Texto:

“Cocina peruana contemporánea
con ingredientes de nuestra tierra.”

CTA:
“Hacer un pedido →”

Usar una imagen gastronómica de ceviche o comida peruana premium.

Debajo:

“Nuestros imperdibles”

Cards de platos:

Ceviche clásico
S/ 38

Lomo saltado
S/ 42

Ají de gallina
S/ 36

Arroz con mariscos
S/ 44

2.
Mockup de celular superpuesto al lado izquierdo inferior.

Debe parecer una web/app móvil del restaurante.

Mostrar:

Nuestra carta

Tabs:

Entradas
Fondos
Bebidas

Productos pequeños.

3.
Dashboard Vendra flotante al lado derecho.

Card blanca elevada.

Header:
Vendra
Restaurante ▼

Mostrar:

Ventas de hoy
S/ 2,580
+12%

Pedidos
48
+18%

Mesas activas
12

Ticket promedio
S/ 54

Agregar pequeña gráfica tipo sparkline.

Debajo:

Platos más vendidos

Ceviche clásico
124

Lomo saltado
98

Arroz con mariscos
76

Estos elementos deben superponerse elegantemente.

Usa:
position absolute
transform
z-index
shadow

pero hazlo responsive.

No quiero que parezca un collage desordenado.

==================================================
RESTAURANTES SHOWCASE
==================================================

Section background:
blanco cálido ligeramente diferente.

Heading:

“Tu restaurante merece una experiencia así.”

Subheading:

“Diseños atractivos. Más pedidos. Mejor experiencia para tus comensales.”

Crear 3 cards grandes horizontales.

CARD 1:

MAREA
CEVICHERÍA

Tag:
Cevichería

Copy:
“El mar del Perú
en tu mesa”

Imagen:
ceviche premium.

Footer:
marea.pe ↗

CARD 2:

BRASA 51
PARRILLA PERUANA

Tag:
Parrilla

Copy:
“Buenas brasas,
mejores momentos”

Imagen:
parrilla/carne.

Footer:
brasa51.pe ↗

CARD 3:

CASA NATIVA
COCINA PERUANA

Tag:
Café / Bistro

Copy:
“Café, cocina
y cultura peruana”

Imagen:
café + plato peruano.

Footer:
casanativa.pe ↗

Cards con:

- border radius grande
- imagen full bleed
- overlay oscuro
- texto blanco o según imagen
- footer inferior claro
- hover sutil

Desktop:
3 columnas.

Tablet:
2.

Mobile:
1.

==================================================
FEATURES
==================================================

Heading:

“Todo lo que necesitas para vender y operar mejor”

Right link:

“Ver todas las soluciones →”

Grid 3x2 desktop.

Cards:

1.
Web y carta digital

“Muestra tu menú con una experiencia moderna y profesional.”

Icon:
Monitor

2.
Pagos

“Acepta tarjetas, Yape, Plin y más de forma segura.”

Icon:
CreditCard

3.
Pedidos por QR

“Tus comensales pueden pedir desde la mesa sin esperar.”

Icon:
QrCode

4.
Cocina / KDS

“Envía pedidos a cocina de forma clara y ordenada.”

Icon:
ChefHat

5.
Delivery

“Recibe pedidos para recoger o entregar.”

Icon:
Truck

6.
Inventario & reportes

“Controla insumos, ventas y rendimiento en tiempo real.”

Icon:
ChartNoAxesColumnIncreasing

Diseño:

icon circle 48px
background verde muy claro
icon verde
card border
hover suave

==================================================
PROBLEMA VS SOLUCIÓN
==================================================

Esta sección es importante para conversión.

Background:
gradiente extremadamente sutil verde/blanco.

Heading:

“De pedidos por WhatsApp y papel a una operación ordenada.”

Subheading:

“Deja el caos atrás. Lleva tu restaurante al siguiente nivel con Vendra.”

2 columnas grandes.

LEFT:

background rosa / beige muy claro.

Título:

“Así opera la mayoría hoy:”

Visual:

Imagen de encargado/cocinero preocupado.

Alrededor simular mensajes:

WhatsApp icon

“¿Tienes mesa hoy?”

“Quiero 2 ceviches para delivery”

“¿Cuánto es? ¿Yape?”

Sticky labels:

Pedidos en papel
Errores en cocina
Pagos por transferencia
Información dispersa
Clientes esperando...

Debe verse visual y no solo como texto.

RIGHT:

background verde muy claro.

Título:

“Así operas con Vendra:”

Crear visual horizontal:

Tu web / carta digital
↓
Pedido
↓
Cocina / KDS
↓
Pago automático
↓
Reportes

Representarlo con mini UI cards.

Agregar logos estilizados de:

Visa
Yape

No es necesario utilizar logos exactos si hay problemas de assets:
se puede utilizar texto.

Checklist lateral:

✓ Pedidos centralizados
✓ Cobros automáticos
✓ Menú digital
✓ Control de cocina
✓ Reportes en tiempo real

==================================================
PASOS
==================================================

Heading:

“Configura → Publica → Vende”

Right:

“En minutos. Sin complicaciones.”

3 columnas.

STEP 1

01

Configura tu menú

“Sube platos, precios, combos
y horarios.”

STEP 2

02

Publica tu canal

“Comparte tu web, enlace o QR
en mesas y redes.”

STEP 3

03

Recibe pedidos

“Cobra online, organiza cocina
y atiende mejor.”

Utilizar flechas entre pasos en desktop.

==================================================
PRICING
==================================================

Heading:

“Planes para cada etapa de tu restaurante.”

Right:

“Sin comisiones por venta. Cancela cuando quieras.”

IMPORTANTE:

Crear 3 cards.

----------------------

STARTER

Todo lo que necesitas para empezar.

S/ 99
/mes

✓ Web y carta digital
✓ Hasta 80 platos
✓ Pedidos online
✓ Yape, Plin y tarjetas
✓ Soporte por email

Button outline:

Comenzar ahora →

----------------------

PRO

Badge:
“Más elegido”

Para restaurantes que quieren crecer.

S/ 199
/mes

✓ Todo lo de Starter
✓ Pedidos por QR en mesa
✓ Delivery y recojo
✓ Cocina / KDS
✓ Facturación electrónica
✓ Reportes avanzados
✓ Soporte prioritario

Button verde:

Crear mi restaurante →

Esta card debe destacar.

border verde.

ligeramente elevada.

----------------------

BUSINESS

Para cadenas en expansión.

S/ 399
/mes

✓ Todo lo de Pro
✓ Múltiples sedes
✓ Roles y permisos
✓ Integraciones personalizadas
✓ Soporte VIP
✓ Asesoría especializada

Button outline:

Comenzar ahora →

==================================================
CTA FINAL
==================================================

Crear una sección visual oscura premium.

Background:

restaurante/cocina peruana sofisticada.

Overlay:
verde oscuro / negro.

Izquierda:

imagen de un dueño de restaurante / chef sonriente.

Center:

Headline:

“Tu próxima mesa también puede vender más.”

Texto:

“Únete a restaurantes peruanos que están modernizando
sus ventas y operaciones con Vendra.”

Button:

“Crear mi restaurante →”

Derecha:

✓ Sin permanencia

✓ Soporte en español

🇵🇪 Hecho en Perú

Debe transmitir:

confianza
orgullo local
modernidad
crecimiento.

==================================================
FOOTER
==================================================

Logo Vendra

Tagline:

“Vende. Gestiona. Crece.”

Links:

Producto
Soluciones
Precios
Recursos
Blog
Centro de ayuda

Social icons:

Instagram
Facebook
YouTube
LinkedIn

Responsive en mobile.

==================================================
MICROINTERACTIONS
==================================================

No exagerar animaciones.

Usar:

- fade-in
- translate-y pequeño
- hover elevation
- button arrow movement
- cards scale máximo 1.01 / 1.02

Intersection animation opcional.

NO usar animaciones llamativas.

Debe sentirse premium.

==================================================
RESPONSIVE
==================================================

Desktop:
>= 1200px

Tablet:
768px - 1199px

Mobile:
< 768px

En mobile:

Hero en 1 columna.

Texto primero.

Visual después.

Headline aprox 42px.

Cards showcase:
1 columna.

Features:
1 columna.

Problem/solution:
1 columna.

Pricing:
1 columna.

El plan Pro sigue siendo destacado.

CTA final:
layout vertical.

Header:
crear menú hamburguesa.

==================================================
IMÁGENES
==================================================

Usa imágenes gastronómicas premium.

Preferencia:

ceviche
lomo saltado
parrilla
café peruano
restaurante moderno
chef
cocina profesional

No uses:

fashion
ropa
cosméticos
zapatos
modelos de ecommerce

Si no hay assets locales, utiliza imágenes remotas apropiadas de Unsplash temporalmente.

Crea una estructura fácilmente reemplazable por assets reales.

==================================================
COMPONENTES
==================================================

Divide el código en componentes mantenibles.

Por ejemplo:

components/
  landing/
    Navbar.tsx
    Hero.tsx
    RestaurantMockup.tsx
    DashboardMockup.tsx
    RestaurantShowcase.tsx
    Features.tsx
    TransformationSection.tsx
    Steps.tsx
    Pricing.tsx
    FinalCTA.tsx
    Footer.tsx

No pongas toda la landing en un único archivo.

Mantén los textos/data separados cuando tenga sentido.

Ejemplo:

const features = [...]
const plans = [...]
const restaurants = [...]

==================================================
CALIDAD DEL CÓDIGO
==================================================

Quiero:

- TypeScript limpio.
- Componentes reutilizables.
- Semántica HTML correcta.
- No duplicar código.
- Buen responsive.
- Accesibilidad.
- alt en imágenes.
- botones con estados hover/focus.
- navegación mediante anchors.
- performance razonable.
- next/image donde corresponda.
- mobile-first.

No quiero:

- estilos inline masivos.
- valores mágicos innecesarios.
- componentes gigantes.
- dependencias inútiles.
- lorem ipsum.
- textos en inglés.
- elementos sin terminar.

==================================================
IMPORTANTE: FIDELIDAD VISUAL
==================================================

La imagen adjunta es la referencia principal.

Antes de programar:

1. Analiza su jerarquía.
2. Analiza tamaños relativos.
3. Analiza espaciados.
4. Analiza card styles.
5. Analiza composición del hero.
6. Analiza el ritmo vertical de las secciones.

Luego implementa.

No hagas una reinterpretación completamente distinta.

Quiero poder poner el screenshot de tu resultado al lado de la referencia y reconocer claramente el mismo diseño.

Sin embargo, corrige cualquier pequeño problema visual de la referencia si mejora UX o responsive.

==================================================
ENTREGABLE
==================================================

Primero inspecciona la estructura actual del proyecto.

Después implementa directamente la landing.

Si ya existe una home:
actualízala.

No crees un proyecto nuevo si ya existe uno.

Al finalizar:

1. verifica que compile.
2. corrige errores TypeScript.
3. revisa responsive.
4. revisa que ninguna sección desborde horizontalmente.
5. revisa que imágenes y textos estén correctamente alineados.
6. verifica mobile.
7. indícame qué archivos modificaste.

No te limites a describir el código.

IMPLEMENTA EL FRONTEND.