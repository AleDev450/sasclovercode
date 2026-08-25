// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Skeleton,
  Spinner,
} from "@/components/ui";

describe("Button (TEST-022)", () => {
  it("renders a button that is accessible by its name", () => {
    render(<Button>Crear producto</Button>);
    expect(screen.getByRole("button", { name: "Crear producto" })).toBeInTheDocument();
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("honours an explicit type", () => {
    render(<Button type="submit">Enviar</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("blocks interaction when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Eliminar
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Eliminar" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("lets a caller-supplied class override the variant default", () => {
    render(<Button className="bg-destructive">Peligro</Button>);

    // tailwind-merge drops the conflicting base utility but must keep the
    // hover variant, which lives in a different conflict group.
    const classes = screen.getByRole("button").className.split(/\s+/);
    expect(classes).toContain("bg-destructive");
    expect(classes).not.toContain("bg-primary");
    expect(classes).toContain("hover:bg-primary/90");
  });
});

describe("Button loading state (TEST-023)", () => {
  it("disables itself, exposes aria-busy and announces the spinner", async () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Guardando" onClick={onClick}>
        Guardar
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Guardando")).toBeInTheDocument();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has no aria-busy when idle", () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");
  });
});

describe("EmptyState (TEST-024)", () => {
  it("renders title, description and action", () => {
    render(
      <EmptyState
        title="Aun no tienes productos"
        description="Agrega tu primer producto para comenzar a crear tu catalogo."
        action={<Button>Crear producto</Button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Aun no tienes productos" })).toBeInTheDocument();
    expect(
      screen.getByText("Agrega tu primer producto para comenzar a crear tu catalogo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear producto" })).toBeInTheDocument();
  });

  it("renders with only a title", () => {
    render(<EmptyState title="Sin resultados" />);
    expect(screen.getByRole("heading", { name: "Sin resultados" })).toBeInTheDocument();
  });
});

describe("Alert (TEST-025)", () => {
  it("is announced as an alert", () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Algo salio mal</AlertTitle>
        <AlertDescription>Intentalo nuevamente.</AlertDescription>
      </Alert>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Algo salio mal");
  });
});

describe("Input and Label accessibility (NFR-005)", () => {
  it("associates a label with its input", () => {
    render(
      <>
        <Label htmlFor="slug">Slug</Label>
        <Input id="slug" name="slug" />
      </>,
    );

    expect(screen.getByLabelText("Slug")).toBeInTheDocument();
  });

  it("marks an invalid input for assistive technology", () => {
    render(<Input aria-label="RUC" invalid />);
    expect(screen.getByLabelText("RUC")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not set aria-invalid when valid", () => {
    render(<Input aria-label="RUC" />);
    expect(screen.getByLabelText("RUC")).not.toHaveAttribute("aria-invalid");
  });
});

/**
 * Coverage added after the Phase 00 audit.
 *
 * Badge, Card and Skeleton ship inside `/` and `/loading` but had no test at
 * all, and Spinner was only exercised indirectly through Button.
 */
describe("Badge", () => {
  it("renders its content", () => {
    render(<Badge>Fase 00</Badge>);
    expect(screen.getByText("Fase 00")).toBeInTheDocument();
  });

  it.each(["neutral", "success", "warning", "destructive", "outline"] as const)(
    "supports the %s variant",
    (variant) => {
      render(<Badge variant={variant}>x</Badge>);
      expect(screen.getByText("x")).toBeInTheDocument();
    },
  );
});

describe("Card", () => {
  it("composes header, title, description, content and footer", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Productos</CardTitle>
          <CardDescription>Catalogo del tenant</CardDescription>
        </CardHeader>
        <CardContent>contenido</CardContent>
        <CardFooter>pie</CardFooter>
      </Card>,
    );

    expect(screen.getByRole("heading", { name: "Productos" })).toBeInTheDocument();
    expect(screen.getByText("Catalogo del tenant")).toBeInTheDocument();
    expect(screen.getByText("contenido")).toBeInTheDocument();
    expect(screen.getByText("pie")).toBeInTheDocument();
  });

  it("defaults the title to h3", () => {
    render(<CardTitle>Titulo</CardTitle>);
    expect(screen.getByRole("heading", { level: 3, name: "Titulo" })).toBeInTheDocument();
  });

  it("honours an explicit heading level so pages keep a valid outline", () => {
    render(<CardTitle as="h2">Titulo</CardTitle>);
    expect(screen.getByRole("heading", { level: 2, name: "Titulo" })).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive technology", () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    const node = container.firstElementChild;
    expect(node).toHaveAttribute("aria-hidden", "true");
    expect(node?.className).toContain("animate-pulse");
  });
});

describe("Spinner", () => {
  it("exposes a status role with an accessible label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("accepts a custom label", () => {
    render(<Spinner label="Guardando cambios" />);
    expect(screen.getByText("Guardando cambios")).toBeInTheDocument();
  });
});

describe("EmptyState heading level", () => {
  it("defaults to h3", () => {
    render(<EmptyState title="Sin datos" />);
    expect(screen.getByRole("heading", { level: 3, name: "Sin datos" })).toBeInTheDocument();
  });

  it("can be promoted to h1 when it is the page's only heading", () => {
    render(<EmptyState titleAs="h1" title="Pagina no encontrada" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Pagina no encontrada" }),
    ).toBeInTheDocument();
  });
});

describe("AlertTitle", () => {
  it("does not inject a heading into the document outline", () => {
    render(
      <Alert>
        <AlertTitle>Aviso</AlertTitle>
      </Alert>,
    );
    expect(screen.getByText("Aviso")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
