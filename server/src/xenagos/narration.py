"""Checks on narration when a plan is submitted (spec: walkthrough-narration).

Narration is spoken as written and shown as the caption, so it must be plain text: that check applies under every
style. The active style's limits (sentences and words per step, steps per section, forbidden patterns) apply on top.
Each problem names the step and the limit, so the agent can fix all of them in one go.
"""

import re

from xenagos.config import Style
from xenagos.plan import Plan

MARKUP: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^\s{0,3}#{1,6}\s", re.MULTILINE), "a heading"),
    (re.compile(r"```|~~~"), "a code fence"),
    (re.compile(r"`[^`\n]+`"), "inline code"),
    (re.compile(r"</?[A-Za-z][A-Za-z0-9-]*(\s[^>]*)?>"), "an HTML tag"),
    (re.compile(r"\*\*[^*\n]+\*\*|__[^_\n]+__"), "bold text"),
    (re.compile(r"\[[^\]\n]+\]\([^)\n]*\)"), "a link"),
    (re.compile(r"^\s*[-*+]\s+\S", re.MULTILINE), "a list item"),
]
_SENTENCE_END = re.compile(r"[.!?]+(?=\s|$)")
_WORD = re.compile(r"\w[\w'\u2019-]*")


def sentences(text: str) -> int:
    """Sentences in `text`: ends of sentences, plus a last sentence without one."""
    ends = len(_SENTENCE_END.findall(text.strip()))
    tail = _SENTENCE_END.split(text.strip())[-1].strip()
    return ends + (1 if tail else 0)


def words(text: str) -> int:
    return len(_WORD.findall(text))


def check(plan: Plan, style: Style) -> list[str]:
    limits = style.limits
    named = f'style "{style.name}"'
    problems: list[str] = []
    for number, section in enumerate(plan.sections, start=1):
        where = f'section {number} ("{section.title}")'
        steps = len(section.steps)
        if limits.max_steps_per_section is not None and steps > limits.max_steps_per_section:
            problems.append(
                f"{where}: has {steps} steps; {named} allows {limits.max_steps_per_section} (max_steps_per_section)"
            )
        for step_number, step in enumerate(section.steps, start=1):
            at = f"{where}, step {step_number}"
            text = step.narration
            for pattern, what in MARKUP:
                if pattern.search(text):
                    problems.append(f"{at}: narration contains {what}; it is spoken as written, so use plain text")
            count = sentences(text)
            if limits.max_sentences_per_step is not None and count > limits.max_sentences_per_step:
                problems.append(
                    f"{at}: narration has {count} sentences; {named} allows {limits.max_sentences_per_step} "
                    "(max_sentences_per_step)"
                )
            count = words(text)
            if limits.max_words_per_step is not None and count > limits.max_words_per_step:
                problems.append(
                    f"{at}: narration has {count} words; {named} allows {limits.max_words_per_step} "
                    "(max_words_per_step)"
                )
            for forbidden in limits.forbid:
                found = re.search(forbidden, text, re.IGNORECASE)
                if found is not None:
                    problems.append(
                        f"{at}: narration contains {found.group(0)!r}, which {named} forbids (forbid: {forbidden})"
                    )
    return problems
