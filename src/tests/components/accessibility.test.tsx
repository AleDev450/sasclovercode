import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Skeleton,
  Spinner,
} from "@/components/ui";
import {
  accessibleName,
  expectNoViolations,
  findViolations,
  focusableElements,
} from "../helpers/accessibility";

/**
 * TEST-2801 to TEST-2812 — accessibility, checked instead of intended.
 *
 * Master section 19 lists seven things: keyboard navigation, labels, focus
 * states, contrast, aria where it applies, clear error messages, and accessible
 * interactive elements. Twenty-seven phases wrote `aria-describedby` and
 * `aria-invalid` by hand and nothing ever verified a single one of them.
 *
 * The contrast rule is disabled because jsdom computes no styles — see
 * `helpers/accessibility.ts`. Pretending to check it would be worse than not
 * checking it.
 */

describe("UI primitives (TEST-2801 to TEST-2806)", () => {
  it("Button has no violations (TEST-2801)", async () => {
    const { container } = render(<Button>Guardar</Button>);
    await expectNoViolations(container, "Button");
  });

  it("a disabled Button is still announced correctly", async () => {
    const { container } = render(<Button disabled>Guardar</Button>);
    await expectNoViolations(container, "Button disabled");
  });

  it("Input with a Label has no violations (TEST-2802)", async () => {
    const { container } = render(
      <div>
        <Label htmlFor="nombre">Nombre</Label>
        <Input id="nombre" name="nombre" />
      </div>,
    );
    await expectNoViolations(container, "Input with label");
    expect(accessibleName(screen.getByRole("textbox"))).toBe("Nombre");
  });

  /*
   * TEST-2803 - the guard of the guard.
   *
   * Every other test in this file asserts an absence, and an absence is exactly
   * what a broken checker reports. So: markup that IS inaccessible, asserted to
   * be caught.
   */
  it("catches an Input with no label at all (TEST-2803)", async () => {
    const { container } = render(<Input name="huerfano" />);
    const violations = await findViolations(container);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.map((violation) => violation.id)).toContain("label");
  });

  it("Alert announces its role (TEST-2804)", async () => {
    const { container } = render(
      <Alert variant="warning">
        <AlertTitle>Sitio no disponible</AlertTitle>
        <AlertDescription>Vuelve a intentarlo.</AlertDescription>
      </Alert>,
    );
    await expectNoViolations(container, "Alert");
  });

  it("Spinner announces that something is happening (TEST-2805)", async () => {
    const { container } = render(<Spinner label="Cargando" />);
    await expectNoViolations(container, "Spinner");
    // A spinner nobody can hear is a page that went silent for a screen reader.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it.each([
    ["Badge", <Badge key="b">Activo</Badge>],
    ["Skeleton", <Skeleton key="s" className="h-4 w-32" />],
    [
      "EmptyState",
      <EmptyState key="e" title="Aun no hay pedidos" description="Crea el primero." />,
    ],
    [
      "Card",
      <Card key="c">
        <CardHeader>
          <CardTitle as="h2">Resumen</CardTitle>
        </CardHeader>
        <CardContent>Contenido</CardContent>
      </Card>,
    ],
  ])("%s has no violations (TEST-2806)", async (name, element) => {
    const { container } = render(element);
    await expectNoViolations(container, name);
  });
});

/**
 * TEST-2807 to TEST-2812 — a real form, which is where the hand-written aria
 * actually lives.
 *
 * The primitives above are the easy half. Every form in this product wires
 * `aria-describedby` to an error paragraph by building an id from the field
 * name, and a typo in either half produces markup that looks right and
 * announces nothing.
 */
function FieldWithError({ withError }: { withError: boolean }) {
  const errorId = "precio-error";

  return (
    <form>
      <div>
        <Label htmlFor="precio">Precio</Label>
        <Input
          id="precio"
          name="precio"
          invalid={withError}
          aria-describedby={withError ? errorId : undefined}
        />
        {withError ? (
          <p id={errorId} role="alert">
            Usa un importe como 24.90.
          </p>
        ) : null}
      </div>
      <Button type="submit">Guardar</Button>
    </form>
  );
}

describe("forms (TEST-2807 to TEST-2812)", () => {
  it("a clean form has no violations (TEST-2807)", async () => {
    const { container } = render(<FieldWithError withError={false} />);
    await expectNoViolations(container, "form");
  });

  it("a form showing an error has no violations either (TEST-2808)", async () => {
    const { container } = render(<FieldWithError withError />);
    await expectNoViolations(container, "form with error");
  });

  /*
   * TEST-2809 - the wiring that is written by hand everywhere.
   *
   * `aria-describedby` pointing at an id that does not exist is invisible in
   * the browser and silent in a screen reader: the user gets a field marked
   * wrong with no explanation of why. axe catches the dangling reference, and
   * this asserts the connection actually resolves.
   */
  it("connects the error to its field (TEST-2809)", async () => {
    render(<FieldWithError withError />);

    const input = screen.getByLabelText("Precio");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();

    const description = document.getElementById(describedBy!);
    expect(description, "aria-describedby points at nothing").not.toBeNull();
    expect(description?.textContent).toContain("24.90");
  });

  it("marks an invalid field as invalid (TEST-2810)", () => {
    render(<FieldWithError withError />);
    // Section 19: "mensajes de error claros". Clear includes being announced as
    // an error rather than as ordinary text next to a box.
    expect(screen.getByLabelText("Precio")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not mark a valid field as invalid", () => {
    render(<FieldWithError withError={false} />);
    const input = screen.getByLabelText("Precio");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("keeps every control reachable by keyboard (TEST-2811)", () => {
    const { container } = render(<FieldWithError withError />);
    const reachable = focusableElements(container);

    // The input and the submit button. A control that responds only to a click
    // is a control somebody navigating with a keyboard cannot use at all.
    expect(reachable).toHaveLength(2);
    expect(reachable.every((element) => accessibleName(element).length > 0)).toBe(true);
  });

  it("announces a button that is working (TEST-2812)", async () => {
    const { container } = render(
      <Button loading loadingLabel="Guardando">
        Guardar
      </Button>,
    );
    await expectNoViolations(container, "loading button");
    // Section 34 asks for "feedback inmediato"; feedback nobody can hear is
    // feedback for sighted users only.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
