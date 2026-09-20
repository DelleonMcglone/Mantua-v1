import { Router, type Request, type Response } from "express";
import { buildX402ServicesIndex, getX402ServiceDef } from "../lib/x402/catalog.ts";
import { buildX402OpenApiIndex, getX402OpenApiSpec } from "../lib/x402/openapi/registry.ts";

/**
 * Phase 17 — the UNPAID OpenAPI publication surface (the marketplace
 * listing prerequisite): per-service OpenAPI 3.1 documents, the document
 * index, and the machine-readable services index. These fetches are free —
 * the paywall covers the services themselves, never their contract
 * metadata, because Circle's listing review fetches the documents without
 * paying and external agents discover prices before they can pay them.
 */

export const x402OpenApiRouter = Router();

x402OpenApiRouter.get("/api/x402/openapi/:serviceId.json", (req: Request, res: Response): void => {
  const serviceId = typeof req.params.serviceId === "string" ? req.params.serviceId : "";
  const spec = getX402OpenApiSpec(serviceId);
  if (!spec || !getX402ServiceDef(serviceId)) {
    res.status(404).json({
      error: `No OpenAPI document for service "${serviceId}".`,
      code: "NOT_FOUND",
    });
    return;
  }
  // Static documents — safe to cache briefly at the edge.
  res.set("Cache-Control", "public, max-age=300");
  res.json(spec);
});

x402OpenApiRouter.get("/api/x402/openapi.json", (_req: Request, res: Response): void => {
  res.set("Cache-Control", "public, max-age=300");
  res.json(buildX402OpenApiIndex());
});

x402OpenApiRouter.get("/api/x402/v1/services.json", (_req: Request, res: Response): void => {
  // Catalog-generated — a catalog row is instantly listed here.
  res.set("Cache-Control", "public, max-age=300");
  res.json({ services: buildX402ServicesIndex() });
});
