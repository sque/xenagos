# review-target Specification

## Purpose
Defines what a review covers and pins it to two fixed revisions, so every view, anchor and explanation refers to the
same code, and guarantees that reviewing never disturbs the user's own checkout.

## Requirements

### Requirement: Target kinds
The system SHALL accept as a review target, for a git repository on disk: a range between two revisions, a single
commit, or the current branch against a named base branch. It SHALL resolve the target to a base revision and a head
revision identified by full commit ids, and SHALL show both ids in the viewer.

#### Scenario: Branch against base
- **GIVEN** a repository on branch `feature` that forked from `main`
- **WHEN** the user opens a review of the current branch against `main`
- **THEN** the base is the fork point with `main`, the head is the tip of `feature`, and both commit ids are shown

#### Scenario: Unknown revision
- **WHEN** the user names a revision that does not exist
- **THEN** no review opens and the error names the revision that could not be resolved

### Requirement: Target is pinned
Once opened, a review SHALL keep its base and head commit ids. New commits on the branch SHALL NOT change what an open
review shows; the viewer SHALL instead report that the branch has moved.

#### Scenario: Branch moves during review
- **GIVEN** an open review of `feature` at head `H1`
- **WHEN** a new commit `H2` lands on `feature`
- **THEN** the review still shows the diff up to `H1` and reports that `feature` is now ahead of the reviewed head

### Requirement: xenagos itself leaves the working copy untouched
xenagos SHALL NOT itself modify the user's working tree, index, branches, stashes or HEAD when a review is opened,
browsed or walked through. When the reviewed head is not what the user has checked out, any checkout xenagos needs
SHALL live in a private location owned by xenagos. Changes made by the review's agent session at the reviewer's
request are that session's actions under the reviewer's permissions, and are outside this requirement.

#### Scenario: Reviewing a head that is not checked out
- **GIVEN** the user's checkout is on `main` with uncommitted edits
- **WHEN** the user opens a review whose head is another branch
- **THEN** `git status` and the current branch in the user's checkout are the same before and after the review

### Requirement: Only committed changes are reviewed
A review SHALL cover committed changes only. When the user's working tree has uncommitted changes to files in the
review, the viewer SHALL say that they are not included.

#### Scenario: Dirty working tree
- **GIVEN** the user has uncommitted edits to a file that the reviewed range also changes
- **WHEN** the review opens
- **THEN** the diff shows the committed change only and a notice says uncommitted changes are not included

### Requirement: No default target without a branch to compare
When no target is named and the current branch is the repository's default branch, or there is no current branch, or
the default branch cannot be determined, no review SHALL open and the message SHALL ask for an explicit target.

#### Scenario: On the default branch
- **WHEN** the user runs xenagos with no target while on the default branch
- **THEN** no review opens and the message asks for a range or a commit
