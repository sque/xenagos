---
name: xenagos
description: Use when working with a xenagos review - opening one for the user with `xen open`, writing or rewriting its walkthrough, answering a reviewer's question that starts with a `[xenagos review <id>]` reference line, or pointing at code in the reviewer's viewer. Also use before fixing code while a xenagos review is open.
---

# xenagos

xenagos shows a code change to a reviewer in their browser: whole files with the change marked in place, a walkthrough
narrated step by step with a spotlight on the code, and this session in a terminal pane beside them. You are the
review's agent. The reviewer's aim is to understand the change the way its author does, not to find bugs.

Questions the reviewer asks from the viewer arrive as ordinary messages whose first line is a reference, for example:

    [xenagos review 2c318731af40708e] src/app.py lines 40-52 (head) · section 3, step 2
    why is this guard needed?

`head` means the reviewed commit, `base` the code before the change; line numbers are of that side. The section and
step say where the reviewer was in the walkthrough. Answer in this session, as you would any message.

## Commands

The `xen` command finds the review through this session. If you are the agent of more than one review, or a command
asks for it, add `--review <id>` with the id from the reference line.

- `xen open [target]` in the repository opens a review for the user and makes this session its agent. Targets follow
  `git diff`: none (current branch against the default branch), `A...B`, `A..B`, or one commit. Give the user the
  link it prints. If the review already has another agent session, that one stays; tell the user.
- `xen guide` prints how to write a walkthrough and lists this review's hunks. Read it before writing one.
- `xen plan submit <file>` submits a whole walkthrough plan; `xen plan get` prints the current one.
- `xen plan get --without-narration` and `xen narration submit <file>` rewrite the narration only.
- `xen show <path>:<start>[-<end>][:<startCol>-<endCol>] [--side base|head] [--form lines|box|circle]` points at code
  in the viewer.
- `xen step add --section N [--after M] <file>` and `xen visual add --section N <file>` change one section.

A rejected submission lists every problem with the item it concerns. Fix them all and submit again.

## Writing the walkthrough

1. Run `xen guide` and follow it.
2. Read the changed code, and the code around it that the change relies on, before writing.
3. Write the plan JSON to a file outside the repository (in the system's temporary folder), so the reviewed repository
   is not changed, and submit it with `xen plan submit`.
4. Explain what the change does and why. Never say the change is correct, safe or ready to merge.

## Answering questions

- When your answer is about specific lines, and above all about code elsewhere than the reviewer's selection (a caller,
  a definition, the old version on the base side), run `xen show` on those lines while you answer, and say in the
  answer what you are showing. Do not point back at the selection itself.
- If `xen show` says that no viewer is open, give the review's link instead.
- Keep answers short; the reviewer reads them beside the code.

## Fixes while a review is open

A review covers the committed changes at a pinned head commit. A commit moves the branch, and the reviewer then gets a
new review without the walkthrough, while the open one keeps showing the code without the fix.

- When the reviewer asks for a fix while the review is open: edit the files, and do not commit, amend, stash, reset
  or switch branches. Say that the fix is uncommitted, that the viewer does not show it because it shows the reviewed
  commits, and that it can be committed after the review.
- If the reviewer explicitly asks you to commit, do it, and say that it starts a new review without the walkthrough.
- Claude Code may put a background session's edits in a separate git worktree instead of the checkout. If yours went
  to a worktree, say where (its folder and branch), that the user's checkout is unchanged, and how to bring the fix
  over after the review.
- If your working directory is inside xenagos's data folder (`~/.local/share/xenagos/` or `$XDG_DATA_HOME/xenagos/`),
  you are in xenagos's private checkout of the reviewed commit, not in the user's own checkout. Say so before or while
  you edit: your edits are not in the user's checkout, and they are removed with the review's data.
