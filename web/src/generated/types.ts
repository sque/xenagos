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
  /**
   * The session is also shown in another terminal.
   */
  shared?: boolean;
  state: "none" | "attachable" | "not-shown" | "ended" | "unavailable";
}
/**
 * A question the reviewer asked, kept with the review (spec: review-session, "A review survives its instance").
 * The answer is in the agent session's conversation.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "AskedQuestion".
 */
export interface AskedQuestion {
  /**
   * When it was asked, in seconds since the epoch.
   */
  asked: number;
  position?: Position | null;
  /**
   * The question as the session received it: its visible text.
   */
  question: string;
  selection: CodeSelection | ElementSelection;
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
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "ElementSelection".
 */
export interface ElementSelection {
  element: string;
  kind: "element";
  visual: string;
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "BranchMoved".
 */
export interface BranchMoved {
  /**
   * Commits on the branch after the reviewed head; null when the head is no longer on the branch.
   */
  ahead: number | null;
  branch: string;
  /**
   * The branch's tip now; null when the branch no longer exists.
   */
  tip: string | null;
}
/**
 * Put a changed file in another category for this review; null puts it back where the rules place it.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "CategoryChange".
 */
export interface CategoryChange {
  category: ("code" | "tests" | "generated") | null;
  path: string;
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "CategoryCoverage".
 */
export interface CategoryCoverage {
  added: number;
  category: "code" | "tests" | "generated";
  files: UncoveredFile[];
  removed: number;
}
/**
 * A changed file with hunks that no section of the plan claims (spec: walkthrough-plan, "Coverage is visible").
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "UncoveredFile".
 */
export interface UncoveredFile {
  /**
   * Lines added by the hunks listed.
   */
  added: number;
  binary: boolean;
  category: "code" | "tests" | "generated";
  /**
   * The hunks no section claims.
   */
  hunks: HunkInfo[];
  oldPath: string | null;
  /**
   * Some of the file's hunks are claimed by a section, the ones listed are not.
   */
  partly: boolean;
  /**
   * Head path, or base path for a deleted file.
   */
  path: string;
  /**
   * Lines removed by the hunks listed.
   */
  removed: number;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed";
}
/**
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "HunkInfo".
 */
export interface HunkInfo {
  baseCount: number;
  baseStart: number;
  headCount: number;
  headStart: number;
  id: string;
}
/**
 * A changed file as the repository explorer marks it.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "ChangedEntry".
 */
export interface ChangedEntry {
  binary: boolean;
  category: "code" | "tests" | "generated";
  /**
   * How many of the file's hunks the walkthrough claims; null when there is no walkthrough.
   */
  covered: ("all" | "partly" | "none") | null;
  oldPath: string | null;
  /**
   * Head path, or base path for a deleted file.
   */
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed";
}
/**
 * A file the change touches, as the diff of the pinned revisions has it.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "ChangedFile".
 */
export interface ChangedFile {
  /**
   * Lines added; 0 for a binary file.
   */
  added: number;
  binary: boolean;
  category: "code" | "tests" | "generated";
  hunks: HunkInfo[];
  oldPath: string | null;
  /**
   * Head path, or base path for a deleted file.
   */
  path: string;
  /**
   * Lines removed; 0 for a binary file.
   */
  removed: number;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed";
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
 * A commit of the review, for the per-commit view (spec: diff-browser).
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "CommitInfo".
 */
export interface CommitInfo {
  author: string;
  /**
   * Author date, ISO 8601.
   */
  date: string;
  id: string;
  message: string;
  subject: string;
}
/**
 * What the plan leaves out, by category in the order Code, Tests, Generated; empty categories are omitted.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Coverage".
 */
export interface Coverage {
  categories: CategoryCoverage[];
  /**
   * How many files have a hunk no section claims.
   */
  files: number;
  /**
   * How many hunks no section claims.
   */
  hunks: number;
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
  /**
   * Set by xenagos when it accepts the plan: the style its narration was checked against.
   */
  style?: StyleRef | null;
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
 * via the `definition` "StyleRef".
 */
export interface StyleRef {
  hash: string;
  name: string;
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
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "Question".
 */
export interface Question {
  position?: Position | null;
  question: string;
  selection: CodeSelection | ElementSelection;
}
/**
 * The repository explorer's data (spec: repository-explorer).
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "RepositoryTree".
 */
export interface RepositoryTree {
  changed: ChangedEntry[];
  /**
   * Every file at the head, with deleted files added back; sorted.
   */
  files: string[];
  /**
   * Files some step of the walkthrough targets.
   */
  visited: string[];
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
  /**
   * The active narration style: a walkthrough asked for now is written in it.
   */
  style: string;
  voice: VoiceInfo;
}
/**
 * Voice settings from configuration (spec: configuration).
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "VoiceInfo".
 */
export interface VoiceInfo {
  /**
   * The command's voices the narration menu offers.
   */
  choices?: string[];
  /**
   * A voice command is configured, whatever the default provider.
   */
  command?: boolean;
  enabled: boolean;
  name: string | null;
  /**
   * The configured command sends narration text off this machine.
   */
  offMachine: boolean;
  provider: "browser" | "command";
  speed: number;
}
/**
 * A Claude Code session the reviewer can make the review's agent.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "SessionChoiceItem".
 */
export interface SessionChoiceItem {
  cwd: string | null;
  kind: string;
  name: string | null;
  running: boolean;
  session: string;
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
/**
 * What changed around the pinned review since it opened (spec: review-target).
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "TargetStatus".
 */
export interface TargetStatus {
  /**
   * The reviewed branch no longer points at the reviewed head.
   */
  moved: BranchMoved | null;
  /**
   * Files in the review with uncommitted changes in the working tree.
   */
  uncommitted: string[];
}
/**
 * Narration to speak with the `command` provider; voice and speed default to the configured ones.
 *
 * This interface was referenced by `Root`'s JSON-Schema
 * via the `definition` "VoiceRequest".
 */
export interface VoiceRequest {
  speed?: number | null;
  text: string;
  voice?: string | null;
}
