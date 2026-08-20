// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExportBundleFallback,
  ImportPreviewFallback,
  NightBeforeBriefFallback,
  ShopPrepListFallback,
} from "./MarketingScreenFallbacks";

afterEach(cleanup);

describe("MarketingScreenFallbacks", () => {
  describe("ShopPrepListFallback", () => {
    it("renders in English with crew staging checklist", () => {
      render(<ShopPrepListFallback locale="en-US" />);
      expect(screen.getByText("Trip prep")).toBeInTheDocument();
      expect(screen.getByText("Two-Tank Morning Reef")).toBeInTheDocument();
      expect(screen.getByText("Staging checklist")).toBeInTheDocument();
      expect(screen.getByText("Rental gear staged")).toBeInTheDocument();
    });

    it("renders in Spanish with crew staging checklist", () => {
      render(<ShopPrepListFallback locale="es-ES" />);
      expect(screen.getByText("Preparación de salida")).toBeInTheDocument();
      expect(screen.getByText("Arrecife dos botellas matinal")).toBeInTheDocument();
      expect(screen.getByText("Lista de preparación")).toBeInTheDocument();
      expect(screen.getByText("Equipos de alquiler preparados")).toBeInTheDocument();
    });
  });

  describe("NightBeforeBriefFallback", () => {
    it("renders in English with checklist and weather details", () => {
      render(<NightBeforeBriefFallback locale="en-US" />);

      // Check title and details
      expect(screen.getByText("Ready brief")).toBeInTheDocument();
      expect(screen.getByText("Two-Tank Reef")).toBeInTheDocument();
      expect(screen.getByText("Your pre-trip checklist")).toBeInTheDocument();

      // Check status elements
      expect(screen.getByText("Waiver")).toBeInTheDocument();
      expect(screen.getAllByText("Completed")).toHaveLength(3);
    });

    it("renders in Spanish with checklist and weather details", () => {
      render(<NightBeforeBriefFallback locale="es-ES" />);

      // Check title and details in Spanish
      expect(screen.getByText("Resumen de preparación")).toBeInTheDocument();
      expect(screen.getByText("Tu lista de control previa al viaje")).toBeInTheDocument();
      expect(screen.getByText("Exención")).toBeInTheDocument();
      expect(screen.getAllByText("Completada")).toHaveLength(3);
    });
  });

  describe("ImportPreviewFallback", () => {
    it("renders the import preview mockup in English", () => {
      render(<ImportPreviewFallback locale="en-US" />);
      expect(screen.getByText("Import preview")).toBeInTheDocument();
      expect(screen.getByText("Nothing saves until you say so.")).toBeInTheDocument();
    });

    it("renders the import preview mockup in Spanish", () => {
      render(<ImportPreviewFallback locale="es-ES" />);
      expect(screen.getByText("Vista previa de importación")).toBeInTheDocument();
    });
  });

  describe("ExportBundleFallback", () => {
    it("renders the export bundle mockup in English", () => {
      render(<ExportBundleFallback locale="en-US" />);
      expect(screen.getByText("Data export")).toBeInTheDocument();
    });

    it("renders the export bundle mockup in Spanish", () => {
      render(<ExportBundleFallback locale="es-ES" />);
      expect(screen.getByText("Exportar datos")).toBeInTheDocument();
    });
  });
});
