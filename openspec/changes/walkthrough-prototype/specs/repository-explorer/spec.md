# Spec Delta

## Purpose

In walkthrough mode, shows the repository as a file tree so the reviewer always knows where the narrator is, sees at a
glance which files the change touches, and can tell which of them the walkthrough visits.

## ADDED Requirements

### Requirement: Tree of the repository at the reviewed head
Walkthrough mode SHALL show a tree of the repository's files as they are at the reviewed head, in its own column. Files
the change deleted SHALL also appear, in the place they had.

#### Scenario: Deleted file
- **GIVEN** the change deletes `scheduler/legacy_retry.py`
- **WHEN** the tree is shown
- **THEN** `legacy_retry.py` appears under `scheduler`, marked as deleted

### Requirement: Changed files are marked
Each file the change touches SHALL carry a mark saying whether it was modified, added, deleted or renamed, using the
letters and colours customary for version control. A folder that contains changed files SHALL be marked as such, also
when collapsed. Files in the Generated category SHALL be visibly de-emphasised.

#### Scenario: Collapsed folder with a change
- **GIVEN** a folder is collapsed and one file inside it was modified
- **WHEN** the tree is shown
- **THEN** the folder carries the contains-changes mark

### Requirement: The tree follows the narrator
The file shown in the code view SHALL be highlighted in the tree. When a step moves to another file, the tree SHALL
reveal that file, expanding folders as needed, and move the highlight to it.

#### Scenario: Step in a file inside a collapsed folder
- **GIVEN** the next step targets a file in a collapsed folder
- **WHEN** the step begins
- **THEN** the folder expands and that file is highlighted

### Requirement: Files the walkthrough visits are distinguishable
An unchanged file that some step of the walkthrough targets SHALL be marked as visited by the walkthrough. A changed
file that no section of the walkthrough covers SHALL be identifiable as such from the tree.

#### Scenario: Refresher file
- **GIVEN** a step targets `scheduler/queue.py`, which the change does not touch
- **WHEN** the tree is shown
- **THEN** `queue.py` is marked as visited and carries no change mark

#### Scenario: Changed file the walkthrough skips
- **GIVEN** the change modifies `scheduler/settings.py` and no section claims any of its hunks
- **WHEN** the tree is shown
- **THEN** `settings.py` is identifiable as changed but not covered by the walkthrough

### Requirement: Narrow or whole tree
The tree SHALL by default show only changed files and files the walkthrough visits, kept under their folders and
never as a flat list, and SHALL offer a switch to show every file. A folder with nothing changed or visited SHALL NOT
appear in the default view. The number of files hidden in a folder SHALL be shown.

#### Scenario: Default view of a large repository
- **GIVEN** a repository of 400 files where the change touches 5 and the walkthrough visits 1 more
- **WHEN** walkthrough mode opens
- **THEN** the tree lists those 6 files under their folders and says how many others are hidden

### Requirement: Opening a file from the tree
Choosing a file in the tree SHALL show it in the code view. During playback this SHALL pause playback, and resuming
SHALL return to the current step's target.

#### Scenario: Look elsewhere during playback
- **GIVEN** playback is on step 2
- **WHEN** the reviewer chooses another file in the tree and later presses resume
- **THEN** playback was paused while they looked, and resumes at step 2's target
