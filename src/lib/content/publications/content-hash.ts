import "server-only";

import { createHash } from "node:crypto";

/**
 * The hashes a publication proposal is bound by.
 *
 * The content hash is SHA-256 over the UTF-8 bytes of a fixed domain tag, a
 * NUL, the version's title, a NUL, and its body. Postgres text can never
 * hold a NUL, so the separator cannot occur inside either field and no two
 * (title, body) pairs share an input. The database function
 * `nexra_content_publication_propose` computes exactly the same bytes from
 * the stored row and refuses a proposal whose hash differs, so the value is
 * recomputed from the source of truth, never taken from a browser.
 *
 * Server-only: `node:crypto` is not for the browser, and the browser is not
 * trusted with a hash anyway.
 */

export const CONTENT_HASH_DOMAIN = "nexra-content-draft-version/1";

const NUL = Buffer.from([0]);

export function contentSha256(version: { readonly title: string; readonly body: string }): string {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(CONTENT_HASH_DOMAIN, "utf8"), NUL, Buffer.from(version.title, "utf8"), NUL, Buffer.from(version.body, "utf8")]))
    .digest("hex");
}

/** SHA-256 of the preview document's UTF-8 bytes. */
export function previewSha256(document: string): string {
  return utf8Sha256(document);
}

/** SHA-256 of any text's UTF-8 bytes, lowercase hex: the website dry-run's artifact hashes. */
export function utf8Sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}
