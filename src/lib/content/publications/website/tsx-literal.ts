/**
 * How content becomes source text in a rendered artifact: only ever as a
 * string literal, never as JSX text, an identifier, a template literal or a
 * comment.
 *
 * `JSON.stringify` gives a valid JavaScript string literal for any string
 * (lone surrogates included). On top of that, `<`, `>` and `&` are written
 * as `<`, `>` and `&`, so no JSX- or HTML-looking sequence
 * from a draft appears literally in the file at all, and the two line
 * separators JavaScript once treated as line terminators are escaped. The
 * literal still decodes to exactly the original string; React renders it as
 * text.
 *
 * Pure.
 */

/** U+2028 and U+2029, built from their code points so this source file stays ASCII. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function tsString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(LINE_SEPARATOR)
    .join("\\u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join("\\u2029");
}

/** An array of string literals, one per line at the given indentation. */
export function tsStringArray(values: readonly string[], indent: string): string {
  if (values.length === 0) return "[]";
  return `[\n${values.map((value) => `${indent}  ${tsString(value)},`).join("\n")}\n${indent}]`;
}

/**
 * The identifier a missing required field is rendered as. It is declared
 * nowhere, so a file carrying one fails the website's typecheck and build:
 * an incomplete dry-run can never be mistaken for, or shipped as, a
 * working article. The key is one of the contract's own field names.
 */
export function missingIdentifier(fieldKey: string): string {
  if (!/^[A-Za-z]+$/.test(fieldKey)) throw new Error(`Not a contract field name: ${fieldKey}`);
  return `MISSING_REQUIRED_FIELD_${fieldKey}`;
}
