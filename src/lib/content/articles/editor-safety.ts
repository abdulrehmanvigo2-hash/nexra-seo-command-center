/**
 * Content safety in the article editor (fix F4, audit A5-04, A5-05).
 *
 * The stored content, its canonical text, hashes and pins are untouched:
 * everything here is editor state and wording, and the form still sends
 * `contentFromForm` exactly as before.
 *
 * A5-04: an attestation's locator is a paragraph index, so an edit earlier
 * in a section used to re-point it silently. The editor now remembers the
 * text of the paragraph each attestation was bound to, and after every edit
 * `followAttestations` re-finds that text: same text elsewhere → the
 * locator follows it; the text changed or the paragraph was removed → the
 * attestation is cleared and marked, and the operator must choose the
 * paragraph again. Nothing is ever re-pointed to a paragraph with different
 * text.
 *
 * A5-05: editing an approved (and possibly proposed or published) article
 * starts only after a confirmation that says what a new version does.
 *
 * Pure.
 */

import { ATTESTATION_LABELS } from "@/lib/content/articles/attestations";
import { lines, type ArticleForm } from "@/lib/content/articles/editor-form";
import type { ArticleAttestationBasis } from "@/types/content-article";

/** One attestation's binding: the text of the paragraph it was marked on, and whether that text was lost. */
export type AttestationBinding = {
  /** The bound paragraph's text; null while the row has no paragraph chosen yet. */
  readonly text: string | null;
  /** True when the bound text is no longer in the article: the row was cleared and must be chosen again. */
  readonly lost: boolean;
};

type Paragraph = { readonly locator: string; readonly container: string; readonly heading: string; readonly index: number; readonly text: string };

/** Every H2 and H3 body paragraph, by locator, in article order — the same set `attestableParagraphChoices` offers. */
export function bodyParagraphs(form: ArticleForm): readonly Paragraph[] {
  const out: Paragraph[] = [];
  for (const section of form.sections) {
    lines(section.body).forEach((text, index) => out.push({ locator: `${section.id}/${index}`, container: section.id, heading: section.heading || section.id, index, text }));
    for (const sub of section.subsections) {
      lines(sub.body).forEach((text, index) => out.push({ locator: `${sub.id}/${index}`, container: sub.id, heading: sub.heading || sub.id, index, text }));
    }
  }
  return out;
}

function containerOf(locator: string): string {
  const slash = locator.lastIndexOf("/");
  return slash < 0 ? locator : locator.slice(0, slash);
}

/** The bindings for a form as loaded: each attestation bound to the text its locator names now. */
export function initialBindings(form: ArticleForm): AttestationBinding[] {
  const paragraphs = bodyParagraphs(form);
  return form.attestations.map((a) => ({ text: paragraphs.find((p) => p.locator === a.locator)?.text ?? null, lost: false }));
}

/**
 * After an edit: keep every attestation on the paragraph whose text it was
 * bound to. The paragraph at the old locator still holding the text keeps
 * it; otherwise the same text elsewhere (in the same section or subsection
 * first, then anywhere, never one another attestation holds) takes it; and
 * when the text is nowhere, the row is cleared and marked lost. A lost row
 * whose text comes back (an undo) is bound again.
 */
export function followAttestations(form: ArticleForm, bindings: readonly AttestationBinding[]): { form: ArticleForm; bindings: AttestationBinding[] } {
  const paragraphs = bodyParagraphs(form);
  const taken = new Set<string>();
  const nextAttestations = form.attestations.map((a) => ({ ...a }));
  const nextBindings: AttestationBinding[] = form.attestations.map((_, i) => bindings[i] ?? { text: null, lost: false });

  // First pass: rows whose locator still holds their text stay, and claim it.
  const settled = form.attestations.map((a, i) => {
    const text = nextBindings[i]?.text ?? null;
    if (text === null) return true;
    const here = paragraphs.find((p) => p.locator === a.locator);
    if (here !== undefined && here.text === text) {
      taken.add(here.locator);
      nextBindings[i] = { text, lost: false };
      return true;
    }
    return false;
  });

  // Second pass: the rest follow their text, or are cleared.
  form.attestations.forEach((a, i) => {
    if (settled[i]) return;
    const text = nextBindings[i]?.text ?? null;
    if (text === null) return;
    const wanted = containerOf(a.locator);
    const candidates = paragraphs.filter((p) => p.text === text && !taken.has(p.locator));
    const found = candidates.find((p) => p.container === wanted) ?? candidates[0];
    if (found !== undefined) {
      taken.add(found.locator);
      nextAttestations[i] = { ...a, locator: found.locator };
      nextBindings[i] = { text, lost: false };
    } else {
      nextAttestations[i] = { ...a, locator: "" };
      nextBindings[i] = { text, lost: true };
    }
  });

  return { form: { ...form, attestations: nextAttestations }, bindings: nextBindings };
}

/** The operator chose a paragraph for row `index`: bind it to that paragraph's text now. */
export function chooseAttestation(form: ArticleForm, bindings: readonly AttestationBinding[], index: number, locator: string): { form: ArticleForm; bindings: AttestationBinding[] } {
  const text = bodyParagraphs(form).find((p) => p.locator === locator)?.text ?? null;
  return {
    form: { ...form, attestations: form.attestations.map((a, i) => (i === index ? { ...a, locator } : a)) },
    bindings: form.attestations.map((_, i) => (i === index ? { text, lost: false } : (bindings[i] ?? { text: null, lost: false }))),
  };
}

export function addAttestation(form: ArticleForm, bindings: readonly AttestationBinding[]): { form: ArticleForm; bindings: AttestationBinding[] } {
  return { form: { ...form, attestations: [...form.attestations, { locator: "", basis: "" }] }, bindings: [...bindings, { text: null, lost: false }] };
}

export function removeAttestation(form: ArticleForm, bindings: readonly AttestationBinding[], index: number): { form: ArticleForm; bindings: AttestationBinding[] } {
  return { form: { ...form, attestations: form.attestations.filter((_, i) => i !== index) }, bindings: bindings.filter((_, i) => i !== index) };
}

/** The first words of a paragraph, for the preview. */
export function firstWords(text: string, count = 10): string {
  const words = text.split(/\s+/).filter((word) => word !== "");
  return words.length > count ? `${words.slice(0, count).join(" ")} …` : words.join(" ");
}

export type AttestationPreviewRow = {
  readonly row: number;
  /** The reader-facing label, or null when no basis is chosen. */
  readonly label: string | null;
  readonly where: string | null;
  readonly words: string | null;
  readonly state: "ready" | "lost" | "unchosen" | "no-basis";
  readonly note: string | null;
};

/**
 * What the pre-save preview lists: each attested paragraph with the label a
 * reader will see and its first words. A lost or unchosen paragraph, or a
 * row with no basis, must be settled before saving.
 */
export function attestationPreview(form: ArticleForm, bindings: readonly AttestationBinding[]): readonly AttestationPreviewRow[] {
  const paragraphs = bodyParagraphs(form);
  return form.attestations.map((a, i) => {
    const binding = bindings[i] ?? { text: null, lost: false };
    const label = a.basis === "" ? null : (ATTESTATION_LABELS[a.basis as ArticleAttestationBasis] ?? null);
    const here = paragraphs.find((p) => p.locator === a.locator);
    if (binding.lost) {
      return {
        row: i + 1,
        label,
        where: null,
        words: binding.text === null ? null : firstWords(binding.text),
        state: "lost",
        note: "Its paragraph's text changed or the paragraph was removed after it was marked. Choose the paragraph again.",
      };
    }
    if (here === undefined) return { row: i + 1, label, where: null, words: null, state: "unchosen", note: "No paragraph is chosen." };
    return {
      row: i + 1,
      label,
      where: `${here.heading} ¶${here.index + 1}`,
      words: firstWords(here.text),
      state: label === null ? "no-basis" : "ready",
      note: label === null ? "No basis is chosen." : null,
    };
  });
}

/** Saving waits until every attested paragraph is chosen, bound and has a basis. */
export function attestationsReady(rows: readonly AttestationPreviewRow[]): boolean {
  return rows.every((row) => row.state === "ready");
}

// --- A5-05: editing an approved article ------------------------------------------

export type EditGuard = {
  readonly title: string;
  readonly lines: readonly string[];
  readonly confirmLabel: string;
};

/**
 * Whether starting an edit needs a confirmation, and what it says. An
 * approved article (the state a proposal and a publication both require)
 * and a checked one each lose that state when a version is saved; a
 * drafting article loses nothing.
 */
export function editGuard(
  article: {
    readonly id: string;
    readonly status: string;
    readonly currentVersion: number;
    readonly approvedVersion: number | null;
  },
  /** The slug this article is live under, as the records say (fix F9); null when it is not live or was not read. */
  live: { readonly slug: string } | null = null,
): EditGuard | null {
  const next = article.currentVersion + 1;
  if (article.status === "approved") {
    return {
      title: `Version ${article.currentVersion} is approved. Edit it as version ${next}?`,
      lines: [
        `Saving an edit creates version ${next} and returns the article to drafting. Version ${next} needs a full re-check and its own approval before it can be proposed.`,
        `Version ${article.currentVersion}, its approval and any proposal for it stay on record, unchanged.`,
        ...(live !== null
          ? [`This article is live on the website (/blog/${live.slug}). Saving a version here does not change the live page, but the product will show the article as drafting.`]
          : []),
        "Opening the editor writes nothing; only Save does.",
      ],
      confirmLabel: `Edit as version ${next}`,
    };
  }
  if (article.status === "checked") {
    return {
      title: `Version ${article.currentVersion} passed its check. Edit it as version ${next}?`,
      lines: [
        `Saving an edit creates version ${next} and returns the article to drafting; version ${next} needs a full re-check. Version ${article.currentVersion}'s check results stay on record.`,
        "Opening the editor writes nothing; only Save does.",
      ],
      confirmLabel: `Edit as version ${next}`,
    };
  }
  return null;
}
