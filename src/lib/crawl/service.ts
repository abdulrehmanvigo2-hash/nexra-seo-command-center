import type { CrawlStore } from "@/lib/crawl/contract";
import { checkUrl } from "@/lib/crawl/url-policy";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import type { Crawl, CrawlSource, SitemapDiscovery } from "@/types/crawl";
import type { ProjectRecord } from "@/types/project";

/**
 * The rules for running a discovery pass: who may ask, over which site, and
 * what happens to the record when the pass ends.
 *
 * Pure in the way that matters, the same as the agent run service: the store,
 * the project roster, the discovery function and the clock are all handed in,
 * so the same rules run against Supabase in the application and against
 * in-memory doubles in a test. It holds no credentials and reads no
 * environment, and it never reaches the network itself.
 *
 * The site is derived, never supplied. A caller names a project and nothing
 * else; the host comes from that project's stored domain and then through the
 * same URL policy as any other URL. Letting a caller pass a URL would turn an
 * operator-only button into a way to make this server fetch anywhere.
 *
 * Authorization is the caller's job: every method here assumes an operator has
 * already been confirmed, and records who asked.
 */

export type CrawlFailureReason =
  /** The project id is not one a project could have. */
  | "invalid"
  | "unknown-project"
  /** The project's stored domain does not pass the URL policy. */
  | "site-refused"
  /** Crawls are not stored in this deployment. */
  | "unavailable";

export type CrawlFailure = {
  readonly ok: false;
  readonly reason: CrawlFailureReason;
};

export type StartCrawlResult =
  | {
      readonly ok: true;
      readonly crawl: Crawl;
      /**
       * False when a pass was already in flight and this request joined it
       * rather than starting a second one.
       */
      readonly started: boolean;
    }
  | CrawlFailure;

export type CrawlServiceDependencies = {
  readonly store: CrawlStore;
  readonly projects: {
    getProjectById(id: string): Promise<ProjectRecord | null>;
  };
  /** Reads a site's sitemaps. Injected so a test never reaches the network. */
  readonly discover: (site: string) => Promise<SitemapDiscovery>;
};

/**
 * The host to crawl, from a project's stored domain.
 *
 * The domain column is canonical — lower case, no scheme, no trailing slash —
 * but it may carry a path, because a project can be scoped to a section of a
 * site. A crawl is scoped to a host, so the path is dropped here and the result
 * goes through the URL policy before anything uses it.
 */
export function siteForProject(project: ProjectRecord): string | null {
  const host = project.domain.split("/")[0].trim().toLowerCase();
  const checked = checkUrl(`https://${host}`);
  return checked.ok ? new URL(checked.url).hostname : null;
}

export type CrawlService = {
  startDiscovery(
    operatorId: string | null,
    projectId: unknown,
    source?: CrawlSource,
  ): Promise<StartCrawlResult>;
  latestForProject(projectId: unknown): Promise<{ ok: true; crawl: Crawl | null } | CrawlFailure>;
};

export function createCrawlService(dependencies: CrawlServiceDependencies): CrawlService {
  const { store, projects, discover } = dependencies;

  const resolve = async (
    projectId: unknown,
  ): Promise<{ ok: true; project: ProjectRecord } | CrawlFailure> => {
    if (typeof projectId !== "string" || !isStorableProjectId(projectId)) {
      return { ok: false, reason: "invalid" };
    }
    const project = await projects.getProjectById(projectId);
    if (!project) return { ok: false, reason: "unknown-project" };
    return { ok: true, project };
  };

  return {
    async startDiscovery(operatorId, projectId, source = "operator") {
      const resolved = await resolve(projectId);
      if (!resolved.ok) return resolved;

      const site = siteForProject(resolved.project);
      if (site === null) return { ok: false, reason: "site-refused" };

      const created = await store.create({
        projectId: resolved.project.id,
        site,
        source,
        createdBy: operatorId,
      });

      if (!created.ok) {
        if (created.reason === "already-running") {
          // The storage layer's own protection. The caller wanted this project
          // crawled and it is being crawled; that is a success, not an error.
          return { ok: true, crawl: created.crawl, started: false };
        }
        return { ok: false, reason: "unknown-project" };
      }

      const started = await store.start(created.crawl.id);
      if (!started) {
        // Something else moved it out of queued between the insert and here.
        const current = await store.get(created.crawl.id);
        return current
          ? { ok: true, crawl: current, started: false }
          : { ok: false, reason: "unavailable" };
      }

      let discovery: SitemapDiscovery;
      try {
        discovery = await discover(site);
      } catch {
        // The reason stays in the server log; the record keeps a fixed code.
        const failed = await store.fail(started.id, "store-error");
        return { ok: true, crawl: failed ?? started, started: true };
      }

      // A site that could not serve robots.txt has not consented to a crawl,
      // and the discovery pass will have read nothing from it. That is a
      // failed pass with a reason, not an empty success.
      if (discovery.robots === "unavailable") {
        const failed = await store.fail(started.id, "robots-unavailable");
        return { ok: true, crawl: failed ?? started, started: true };
      }

      const completed = await store.recordDiscovery(started.id, discovery);
      return { ok: true, crawl: completed ?? started, started: true };
    },

    async latestForProject(projectId) {
      const resolved = await resolve(projectId);
      if (!resolved.ok) return resolved;
      const [latest] = await store.listForProject(resolved.project.id, 1);
      return { ok: true, crawl: latest ?? null };
    },
  };
}
