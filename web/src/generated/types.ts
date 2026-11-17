// Generated from the server models (server/src/xenagos/plan.py, api.py) by `make types`. Do not edit.

/**
 * A fixed request the reviewer sends with a control in the viewer.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "AgentRequest".
 */
export interface AgentRequest {
  kind: "walkthrough" | "narration" | "visual";
  /**
   * The visual to repair, for `visual`.
   */
  visual?: string | null;
}
/**
 * The review's agent session as the viewer shows it (spec: agent-link).
 *
 * `state` is `none` (no session yet), `attachable` (a running background session the pane can show), `not-shown`
 * (a session of a kind the pane cannot show), `ended` (stopped or gone), or `unavailable` (Claude Code could not be
 * asked).
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "AgentStatus".
 */
export interface AgentStatus {
  /**
   * What Claude Code reports while it runs: idle, busy, ...
   */
  activity?: string | null;
  name?: string | null;
  /**
   * Why the pane is empty, for the reviewer.
   */
  reason?: string | null;
  session?: string | null;
  state: "none" | "attachable" | "not-shown" | "ended" | "unavailable";
}
/**
 * Lines the reviewer selected. In the unified view a selection can start on a deleted line and end on an added
 * one, so each end names its side.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "CodeSelection".
 */
export interface CodeSelection {
  endLine: number;
  endSide: "base" | "head";
  kind: "code";
  /**
   * The file as the viewer names it: its head path, or base path if deleted.
   */
  path: string;
  startLine: number;
  startSide: "base" | "head";
}
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
 * What happened to a question or request.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Delivery".
 */
export interface Delivery {
  session: string;
  /**
   * True when a session was started for it, with it as the first message.
   */
  started: boolean;
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "ElementSelection".
 */
export interface ElementSelection {
  element: string;
  kind: "element";
  visual: string;
}
/**
 * A file at both pinned revisions, for the whole-file view. Text is absent when the file does not exist at that
 * revision or is binary.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "FileView".
 */
export interface FileView {
  base: string | null;
  binary: boolean;
  head: string | null;
  oldPath: string | null;
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed" | "unchanged";
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
 * Why a submitted plan was not accepted; each problem names the plan item it concerns.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "PlanRejection".
 */
export interface PlanRejection {
  problems: string[];
}
/**
 * Where the reviewer was in the walkthrough, counted from 1.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Position".
 */
export interface Position {
  section: number;
  step: number;
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Question".
 */
export interface Question {
  position?: Position | null;
  question: string;
  selection: CodeSelection | ElementSelection;
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
/**
 * Something the agent points at in the viewer.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Show".
 */
export interface Show {
  form?: "lines" | "box" | "circle";
  target: CodeTarget | VisualTarget;
}
