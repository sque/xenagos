// Generated from the server models (server/src/xenagos/plan.py, api.py) by `make types`. Do not edit.

/**
 * Lines of a file at the base or head revision, optionally narrowed to a span of characters.
 *
 * Lines and columns count from 1 and both ends are included. With a span, `startCol` is on the first line and
 * `endCol` on the last.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "CodeTarget".
 */
export interface CodeTarget {
  endCol?: number | null;
  endLine: number;
  /**
   * Text that must occur in the targeted range; catches a valid range that points at the wrong code.
   */
  expect?: string | null;
  path: string;
  side?: "base" | "head";
  startCol?: number | null;
  startLine: number;
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Orientation".
 */
export interface Orientation {
  /**
   * The document the problem is taken from.
   */
  document?: string | null;
  /**
   * The problem the change addresses, before any solution; a short paragraph.
   */
  problem: string;
  source: "commit-messages" | "document" | "inferred";
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Plan".
 */
export interface Plan {
  orientation: Orientation;
  /**
   * @minItems 1
   */
  sections: [Section, ...Section[]];
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Section".
 */
export interface Section {
  explanation: string;
  /**
   * The hunks that implement this section's idea.
   */
  hunks: string[];
  role: "core" | "consequence" | "support";
  /**
   * @minItems 1
   */
  steps: [Step, ...Step[]];
  /**
   * Names the section's idea, not a file.
   */
  title: string;
  visuals?: Visual[];
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Step".
 */
export interface Step {
  form: "lines" | "box" | "circle";
  /**
   * Plain text, spoken as written and shown as the caption.
   */
  narration: string;
  target: CodeTarget | VisualTarget;
}
/**
 * An element that one of the section's visuals declares.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "VisualTarget".
 */
export interface VisualTarget {
  element: string;
  visual: string;
}
/**
 * Agent-authored HTML shown in a sandboxed frame (spec: section-visuals).
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Visual".
 */
export interface Visual {
  /**
   * Every element that can be linked, selected or spotlighted.
   */
  elements?: VisualElement[];
  html: string;
  id: string;
  title?: string | null;
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "VisualElement".
 */
export interface VisualElement {
  id: string;
  /**
   * Code shown when the reviewer activates the element.
   */
  link?: CodeTarget | null;
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "ReviewInfo".
 */
export interface ReviewInfo {
  base: string;
  branch: string | null;
  head: string;
  id: string;
  label: string;
  repo: string;
}
