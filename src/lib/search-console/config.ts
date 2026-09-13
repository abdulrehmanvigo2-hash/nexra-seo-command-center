import "server-only";

import { createPrivateKey } from "node:crypto";
import { PROJECT_ID_PATTERN } from "@/lib/projects/intake-rules";

/**
 * Search Console settings, read from the server environment.
 *
 * Three variables. Two are the service account's identity and private key —
 * the key is a secret and must never carry a `NEXT_PUBLIC_` prefix. The third
 * maps Nexra projects to the Search Console properties they report on:
 *
 *   SEARCH_CONSOLE_PROPERTIES=halcyon-fintech=sc-domain:halcyon.example,verdant-home=https://www.verdanthome.example/
 *
 * The mapping is explicit on purpose. Guessing a property from a project's
 * domain would silently pick the wrong one when a site has both a domain
 * property and a URL-prefix property, or report on a site nobody connected.
 *
 * With none of the three set, Search Console is simply not configured and
 * every project reads as not connected. Any other combination — a key with no
 * email, a malformed key, a mapping with nothing to authenticate it — is a
 * configuration error, reported by name without the values.
 */

export const SERVICE_ACCOUNT_EMAIL_VARIABLE = "GOOGLE_SERVICE_ACCOUNT_EMAIL";
export const SERVICE_ACCOUNT_KEY_VARIABLE = "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY";
export const PROPERTIES_VARIABLE = "SEARCH_CONSOLE_PROPERTIES";

export type ServiceAccountCredentials = {
  readonly clientEmail: string;
  /** PEM, PKCS#8. */
  readonly privateKey: string;
};

export type SearchConsoleConfig =
  | { readonly status: "unconfigured" }
  | {
      readonly status: "configured";
      readonly credentials: ServiceAccountCredentials;
      /** Project id → property, e.g. `sc-domain:example.com`. */
      readonly properties: ReadonlyMap<string, string>;
    };

export class SearchConsoleConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchConsoleConfigurationError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

const SERVICE_ACCOUNT_EMAIL = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;

/** A domain property or a URL-prefix property, as Search Console names them. */
export function isSearchConsoleProperty(value: string): boolean {
  if (value.startsWith("sc-domain:")) {
    return /^sc-domain:[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
      value,
    );
  }
  try {
    const url = new URL(value);
    // Exactly as Search Console lists it: parsing would quietly add the
    // trailing slash, and then the mapped name would never match the list.
    return (
      url.href === value &&
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.pathname.endsWith("/") &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function parseProperties(raw: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const entry of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    const projectId = separator > 0 ? entry.slice(0, separator).trim() : "";
    const property = separator > 0 ? entry.slice(separator + 1).trim() : "";
    if (!PROJECT_ID_PATTERN.test(projectId) || !isSearchConsoleProperty(property)) {
      throw new SearchConsoleConfigurationError(
        `${PROPERTIES_VARIABLE} must be comma-separated project-id=property pairs, where a property is sc-domain:example.com or a URL ending in /.`,
      );
    }
    if (properties.has(projectId)) {
      throw new SearchConsoleConfigurationError(
        `${PROPERTIES_VARIABLE} maps the same project more than once.`,
      );
    }
    properties.set(projectId, property);
  }
  return properties;
}

export function readSearchConsoleConfig(env: Environment): SearchConsoleConfig {
  const exposed = Object.keys(env).filter(
    (name) =>
      name.startsWith("NEXT_PUBLIC_") &&
      /GOOGLE|SERVICE_ACCOUNT|SEARCH_CONSOLE/i.test(name) &&
      Boolean(env[name]?.trim()),
  );
  if (exposed.length > 0) {
    throw new SearchConsoleConfigurationError(
      `${exposed.join(", ")} would be bundled into the browser. Search Console settings are server-only.`,
    );
  }

  const email = env[SERVICE_ACCOUNT_EMAIL_VARIABLE]?.trim() ?? "";
  const key = env[SERVICE_ACCOUNT_KEY_VARIABLE]?.trim() ?? "";
  const mapping = env[PROPERTIES_VARIABLE]?.trim() ?? "";

  if (!email && !key && !mapping) return { status: "unconfigured" };

  const missing = [
    email ? null : SERVICE_ACCOUNT_EMAIL_VARIABLE,
    key ? null : SERVICE_ACCOUNT_KEY_VARIABLE,
    mapping ? null : PROPERTIES_VARIABLE,
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    throw new SearchConsoleConfigurationError(
      `Search Console is partly configured: ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not set.`,
    );
  }

  if (!SERVICE_ACCOUNT_EMAIL.test(email)) {
    throw new SearchConsoleConfigurationError(
      `${SERVICE_ACCOUNT_EMAIL_VARIABLE} is not a service account address (…@….iam.gserviceaccount.com).`,
    );
  }

  // Environment files usually hold the PEM on one line with literal "\n".
  const privateKey = key.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  try {
    const parsed = createPrivateKey(privateKey);
    if (parsed.asymmetricKeyType !== "rsa") throw new Error("not rsa");
  } catch {
    throw new SearchConsoleConfigurationError(
      `${SERVICE_ACCOUNT_KEY_VARIABLE} is not a readable RSA private key. Copy the private_key field of the service account's JSON key.`,
    );
  }

  return {
    status: "configured",
    credentials: { clientEmail: email, privateKey },
    properties: parseProperties(mapping),
  };
}
