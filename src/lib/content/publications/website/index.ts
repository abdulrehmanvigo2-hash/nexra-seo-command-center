import "server-only";

import { publicationService } from "@/lib/content/publications";
import { createWebsiteDryRunService, type WebsiteDryRunService } from "@/lib/content/publications/website/service";

/**
 * The server's website dry-run service. It reads only through the
 * publication proposal service; it holds no credential of its own and
 * reaches nothing outside this product's database.
 */

let service: WebsiteDryRunService | null = null;

export function websiteDryRunService(): WebsiteDryRunService {
  service ??= createWebsiteDryRunService({ publications: publicationService() });
  return service;
}
