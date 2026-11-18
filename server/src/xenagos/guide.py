"""What `xen guide` prints for the agent that writes a walkthrough (spec: walkthrough-plan; design decision 6).

The guide is composed when it is asked for: the fixed format rules, then the active narration style with its limits,
then the review's hunks. So a style edited or selected in configuration applies to the next guide printed.
"""

from xenagos.config import Style
from xenagos.diff import FileChange

RULES = """\
# Writing a xenagos walkthrough

A walkthrough plan is one JSON document. It helps the reviewer understand the change, the way its author would explain
it at a shared screen. It is not a review: explain what the change does and why, and never say that it is correct,
safe or ready to merge.

## Shape

- `orientation`: the problem the change addresses, before any solution, in a short paragraph (`problem`), and where
  that statement comes from (`source`: `commit-messages`, `document` with `document` naming the file, or `inferred`).
- `sections`: ordered so each builds on the ones before. A section carries one idea:
  - `title` names the idea, not a file; `explanation` is a sentence or two; `role` is `core`, `consequence` or
    `support`;
  - `hunks` lists the hunks that implement the idea, by the ids listed below. Each hunk belongs to at most one section;
    hunks no section claims are shown to the reviewer as not covered;
  - `steps` are what the reviewer sees and hears, in order. Each has `narration` (plain spoken text: no markup, no
    code formatting), a `form` (`lines`, `box` or `circle`) and a `target`;
  - `visuals` (optional) are small HTML pictures with declared `elements`.
- A code target is `{"path", "side", "startLine", "endLine"}` with `side` `head` (default) or `base`, lines counted from
  1, both ends included. Narrow it to characters with `startCol` and `endCol` (on the first and last line). Add
  `expect`, text that occurs in the range, so a range that points at the wrong code is caught.
  A target may be code the change did not touch, when the reviewer needs it to follow.
- A visual target is `{"visual", "element"}` naming an element the section's visual declares.

## Submitting

- `xen plan submit <file>` checks every hunk and target against the reviewed commits. A rejected plan comes back with
  each problem named; fix them and submit the whole plan again. The accepted plan replaces the previous one.
- `xen show <path>:<start>[-<end>][:<startCol>-<endCol>] [--side base|head] [--form lines|box|circle]` points at code
  in the reviewer's viewer while you answer a question.
- `xen step add --section N [--after M] <file>` and `xen visual add --section N <file>` change one section.
- `xen guide --schema` prints the JSON Schema of the plan.
"""


def style_section(style: Style) -> str:
    """The active style, as the agent writes narration in it."""
    limits = style.limits
    rules = []
    if limits.max_sentences_per_step is not None:
        rules.append(f"at most {limits.max_sentences_per_step} sentences per step")
    if limits.max_words_per_step is not None:
        rules.append(f"at most {limits.max_words_per_step} words per step")
    if limits.max_steps_per_section is not None:
        rules.append(f"at most {limits.max_steps_per_section} steps per section")
    if limits.forbid:
        rules.append("none of these patterns: " + ", ".join(f"`{p}`" for p in limits.forbid))
    checked = "; ".join(rules) if rules else "no limits beyond plain text"
    return (
        f"## Narration style: {style.name}\n\n"
        "Write every step's narration in this style. Narration is spoken as written and shown as the caption, so it "
        f"is plain text with no markup. Submitted narration is checked against the style: {checked}.\n\n"
        f"{style.text.strip()}\n"
    )


def hunk_list(changes: list[FileChange]) -> str:
    """The review's hunks, one per line, for the agent to claim."""
    lines = ["## Hunks of this review", ""]
    for change in changes:
        renamed = f" (was {change.old_path})" if change.old_path else ""
        lines.append(f"{change.path}: {change.status}{renamed}{', binary' if change.binary else ''}")
        for hunk in change.hunks:
            base = _span(hunk.base_start, hunk.base_count)
            head = _span(hunk.head_start, hunk.head_count)
            lines.append(f"  {hunk.id}  base {base}  head {head}")
    if len(lines) == 2:
        lines.append("This review changes no files.")
    return "\n".join(lines) + "\n"


def _span(start: int, count: int) -> str:
    if count == 0:
        return f"none (after line {start})"
    return f"line {start}" if count == 1 else f"lines {start}-{start + count - 1}"
