import type { ComponentType } from "react";
import {
  IconCard,
  IconChart,
  IconChef,
  IconMonitor,
  IconQr,
  IconTruck,
  type IconProps,
} from "@/components/ui/icons";
import { LANDING_IMAGES, type LandingImage } from "./landing-images";

/**
 * The copy and the lists the landing page is built from.
 *
 * SEPARATE FROM THE MARKUP because these are the things that change. A price
 * list, a feature name, the order of the benefits under the hero - those move
 * for commercial reasons, weekly, and none of them should require reading JSX
 * to edit. What stays in the components is layout, which moves for design
 * reasons and almost never.
 *
 * Everything here is Spanish as spoken in Peru, and concrete. No "Lorem", no
 * "Feature 1", no claim about customers the product does not have - the landing
 * page next door already refuses invented testimonials for the same reason.
 */

/* ------------------------------------------------------------------- hero */

export interface HeroBenefit {
  readonly label: string;
  readonly Icon: ComponentType<IconProps>;
}

/** The five-across row under the hero CTAs. What the product IS, in five words. */
export const HERO_BENEFITS: readonly HeroBenefit[] = [
  { label: "Web y carta digital", Icon: IconMonitor },
  { label: "Pagos online", Icon: IconCard },
  { label: "Pedidos por QR", Icon: IconQr },
  { label: "Delivery", Icon: IconTruck },
  { label: "Cocina & POS", Icon: IconChef },
];

/* --------------------------------------------------------- demo restaurant */

/**
 * The fictional restaurant inside the hero mockups.
 *
 * Named, priced and photographed like a real one, because the mockup's whole
 * job is to let a visitor picture their own place there - and "Restaurante
 * Demo" with "Plato 1 - S/ 00.00" does the opposite.
 */
export const DEMO_RESTAURANT = {
  name: "COSTA NORTE",
  kind: "Cocina Peruana",
  nav: ["Inicio", "Nuestra carta", "Nosotros", "Reservas"],
  heroHeading: "Sabores del Peru en cada plato",
  heroBody: "Cocina peruana contemporanea con ingredientes de nuestra tierra.",
  heroCta: "Hacer un pedido",
  menuHeading: "Nuestros imperdibles",
  dishes: [
    { name: "Ceviche clasico", price: "S/ 38", image: LANDING_IMAGES.ceviche },
    { name: "Lomo saltado", price: "S/ 42", image: LANDING_IMAGES.lomo },
    { name: "Aji de gallina", price: "S/ 36", image: LANDING_IMAGES.ajiDeGallina },
    { name: "Arroz con mariscos", price: "S/ 44", image: LANDING_IMAGES.arrozMariscos },
  ],
} as const;

/** The phone mockup: the same carta, as a diner sees it at the table. */
export const DEMO_PHONE = {
  heading: "Nuestra carta",
  tabs: ["Entradas", "Fondos", "Bebidas"],
  items: [
    { name: "Causa limena", price: "S/ 28" },
    { name: "Tiradito nikkei", price: "S/ 34" },
    { name: "Chicharron de calamar", price: "S/ 32" },
  ],
} as const;

/** The floating dashboard card: what the owner sees while that happens. */
export const DEMO_DASHBOARD = {
  stats: [
    { label: "Ventas de hoy", value: "S/ 2,580", delta: "+12%" },
    { label: "Pedidos", value: "48", delta: "+18%" },
    { label: "Mesas activas", value: "12", delta: null },
    { label: "Ticket promedio", value: "S/ 54", delta: null },
  ],
  /*
   * The sparkline, as plain numbers.
   *
   * A component turns these into a path. Storing the shape rather than the
   * `d` attribute means the curve can be redrawn at a different size without
   * anybody editing bezier coordinates by hand.
   */
  trend: [18, 24, 21, 33, 29, 42, 38, 52, 47, 61, 58, 72],
  topDishesHeading: "Platos mas vendidos",
  topDishes: [
    { name: "Ceviche clasico", count: 124 },
    { name: "Lomo saltado", count: 98 },
    { name: "Arroz con mariscos", count: 76 },
  ],
} as const;

/* -------------------------------------------------------------- showcase */

export interface ShowcaseRestaurant {
  readonly name: string;
  readonly kind: string;
  readonly tag: string;
  readonly headline: string;
  readonly domain: string;
  readonly image: LandingImage;
}

export const SHOWCASE_RESTAURANTS: readonly ShowcaseRestaurant[] = [
  {
    name: "MAREA",
    kind: "CEVICHERIA",
    tag: "Cevicheria",
    headline: "El mar del Peru en tu mesa",
    domain: "marea.pe",
    image: LANDING_IMAGES.marea,
  },
  {
    name: "BRASA 51",
    kind: "PARRILLA PERUANA",
    tag: "Parrilla",
    headline: "Buenas brasas, mejores momentos",
    domain: "brasa51.pe",
    image: LANDING_IMAGES.brasa,
  },
  {
    name: "CASA NATIVA",
    kind: "COCINA PERUANA",
    tag: "Cafe / Bistro",
    headline: "Cafe, cocina y cultura peruana",
    domain: "casanativa.pe",
    image: LANDING_IMAGES.casaNativa,
  },
];

/* -------------------------------------------------------------- features */

export interface Feature {
  readonly title: string;
  readonly body: string;
  readonly Icon: ComponentType<IconProps>;
}

export const FEATURES: readonly Feature[] = [
  {
    title: "Web y carta digital",
    body: "Muestra tu menu con una experiencia moderna y profesional.",
    Icon: IconMonitor,
  },
  {
    title: "Pagos",
    body: "Acepta tarjetas, Yape, Plin y mas de forma segura.",
    Icon: IconCard,
  },
  {
    title: "Pedidos por QR",
    body: "Tus comensales pueden pedir desde la mesa sin esperar.",
    Icon: IconQr,
  },
  {
    title: "Cocina / KDS",
    body: "Envia pedidos a cocina de forma clara y ordenada.",
    Icon: IconChef,
  },
  {
    title: "Delivery",
    body: "Recibe pedidos para recoger o entregar.",
    Icon: IconTruck,
  },
  {
    title: "Inventario & reportes",
    body: "Controla insumos, ventas y rendimiento en tiempo real.",
    Icon: IconChart,
  },
];

/* ------------------------------------------------- problem vs. solution */

/** The WhatsApp messages piling up in the "how it works today" panel. */
export const PROBLEM_MESSAGES: readonly string[] = [
  "Hola, tienen mesa para hoy?",
  "Quiero 2 ceviches para delivery",
  "Cuanto es? Les yapeo?",
];

/** The stickers scattered over that same panel. */
export const PROBLEM_LABELS: readonly string[] = [
  "Pedidos en papel",
  "Errores en cocina",
  "Pagos por transferencia",
  "Informacion dispersa",
  "Clientes esperando...",
];

/** The ordered flow in the "with Vendra" panel. */
export const SOLUTION_FLOW: readonly { readonly step: string; readonly detail: string }[] = [
  { step: "Tu web / carta digital", detail: "El cliente elige y pide" },
  { step: "Pedido", detail: "Entra ordenado, con su mesa" },
  { step: "Cocina / KDS", detail: "La comanda sale sola" },
  { step: "Pago automatico", detail: "Visa, Yape y Plin" },
  { step: "Reportes", detail: "Cierras el dia con numeros" },
];

export const SOLUTION_CHECKLIST: readonly string[] = [
  "Pedidos centralizados",
  "Cobros automaticos",
  "Menu digital",
  "Control de cocina",
  "Reportes en tiempo real",
];

/* ----------------------------------------------------------------- steps */

export interface Step {
  readonly number: string;
  readonly title: string;
  readonly body: string;
}

export const STEPS: readonly Step[] = [
  {
    number: "01",
    title: "Configura tu menu",
    body: "Sube platos, precios, combos y horarios.",
  },
  {
    number: "02",
    title: "Publica tu canal",
    body: "Comparte tu web, enlace o QR en mesas y redes.",
  },
  {
    number: "03",
    title: "Recibe pedidos",
    body: "Cobra online, organiza cocina y atiende mejor.",
  },
];
