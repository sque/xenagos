# configuration Specification

## Purpose
One place for a user's preferences across all reviews, with a per-repository override, so behaviour such as how a
review is presented, which narration style is used and which voice speaks can be changed without touching the
application.

## Requirements

### Requirement: User-wide configuration in the standard location
xenagos SHALL read user-wide configuration from its directory under the user's XDG configuration home, falling back to
`~/.config` when that is not set. It SHALL keep review data, running-review records and caches under the XDG data,
state and cache homes respectively, with the standard fallbacks. A missing configuration SHALL mean built-in defaults.

#### Scenario: Custom configuration home
- **GIVEN** `XDG_CONFIG_HOME` is set to `/tmp/cfg` and `/tmp/cfg/xenagos/` holds a configuration selecting voice off
- **WHEN** a review is opened
- **THEN** voice is off in that review

#### Scenario: No configuration
- **WHEN** a review is opened with no configuration anywhere
- **THEN** it opens with the built-in defaults and no error

### Requirement: Repository configuration overrides the user's
A repository MAY carry its own xenagos configuration. For reviews of that repository, a setting present there SHALL
take precedence over the user-wide one, and settings absent there SHALL come from the user-wide configuration.

#### Scenario: Partial override
- **GIVEN** the user-wide configuration sets a narration style and a voice, and the repository sets only a style
- **WHEN** a review of that repository is opened
- **THEN** the repository's style and the user's voice are used

### Requirement: How an agent-started review is presented is a setting
When an agent starts a review, a setting SHALL decide whether the viewer window is opened on the user's screen or the
agent only gives the user the review's link. A review started by a person from the command line SHALL open the viewer
unless that person asks otherwise on the command line.

#### Scenario: Link only
- **GIVEN** the setting is link only
- **WHEN** an agent starts a review
- **THEN** no window opens and the agent's reply contains the review's link

### Requirement: Invalid configuration is reported, not ignored
A configuration file that cannot be read or holds an unknown setting or an invalid value SHALL be reported with the
file and the setting named, and the review SHALL NOT silently run with a different value.

#### Scenario: Misspelled setting
- **WHEN** the user-wide configuration contains a setting name xenagos does not know
- **THEN** opening a review reports that file and that name

### Requirement: Sessions xenagos starts follow settings
The name given to a session xenagos starts and its permission mode SHALL be settings. The name setting SHALL be a
template that can include the repository name and the reviewed branch.

#### Scenario: Name template
- **GIVEN** the name template is `review {repo} {branch}`
- **WHEN** xenagos starts a session for a review of branch `feature` in repository `app`
- **THEN** the session is named `review app feature`
