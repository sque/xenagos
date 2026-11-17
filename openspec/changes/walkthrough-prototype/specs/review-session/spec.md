# Spec Delta

## Purpose

Defines who starts a review and when, how several reviews run side by side without interfering, how a review is found
again, and who may reach it. A review is one target with its saved state; an instance is the running process that
serves a review to one user on one machine.

## ADDED Requirements

### Requirement: A person can start a review from a folder
Running xenagos in a repository with no further arguments SHALL open a review of the current branch against the
repository's default branch and show the viewer in browse mode. A target MAY be named instead. Starting a review SHALL
NOT start an agent; an agent is started only when the person asks for a walkthrough or asks a question.

#### Scenario: Just look
- **GIVEN** a repository on branch `feature`
- **WHEN** the person runs xenagos there with no arguments and only browses the diff
- **THEN** the viewer shows `feature` against the default branch and no agent session has been started

### Requirement: An agent can start a review for its user
An agent session SHALL be able to open a review of a target for its user, with that session as the review's agent.

#### Scenario: After implementing
- **GIVEN** an agent session that has just finished changes on a branch
- **WHEN** the agent opens a review of that branch
- **THEN** the review is presented to the user and names that session as its agent

### Requirement: Reviews are independent instances
Each open review SHALL be served at its own address. Several reviews, of the same or different repositories, SHALL be
able to be open at once, and starting, using or stopping one SHALL NOT affect another.

#### Scenario: Two reviews at once
- **GIVEN** a review of repository A is open
- **WHEN** a review of repository B is started
- **THEN** both viewers work, at different addresses, and stopping B leaves A running

### Requirement: The same review is reused
Opening a target that is already open, meaning the same repository, base and head, SHALL bring up the existing review
and SHALL NOT start a second instance for it, whether the request comes from a person or an agent.

#### Scenario: Agent opens what the person already has open
- **GIVEN** the person has a review of `feature` open
- **WHEN** their agent session opens a review of the same target
- **THEN** no second viewer starts and the existing review is the one presented

### Requirement: List and stop
The user SHALL be able to list open reviews with their target, address and agent session, and to stop any of them.

#### Scenario: List
- **WHEN** two reviews are open and the user lists reviews
- **THEN** both appear with repository, base and head, address, and the name of the agent session, if any

### Requirement: A review survives its instance
The plan, narration, progress, category corrections and the questions asked with their selections SHALL be kept when
an instance ends, and SHALL be restored when the same target is opened again. Answers are part of the agent session's
own conversation and are kept there.

#### Scenario: Reopen tomorrow
- **GIVEN** a review with a generated walkthrough was stopped
- **WHEN** the same target is opened the next day
- **THEN** the walkthrough, progress and earlier questions are shown without regenerating anything

### Requirement: Idle instances end themselves
An instance with no viewer connected for a configurable period, or never opened in a viewer for a longer configurable
period, SHALL end, keeping its state.

#### Scenario: Forgotten review
- **WHEN** a review's viewer tab is closed and the idle period passes
- **THEN** the instance is no longer running, no longer appears in the list of open reviews, and its agent session
  has not been stopped by xenagos

### Requirement: One agent session per review
A review SHALL have at most one agent session at a time. The viewer SHALL show which session it is, by name, or that
there is none. Replacing the review's session with another SHALL happen only on the user's request.

#### Scenario: Session ends
- **WHEN** the review's session ends
- **THEN** the viewer shows that there is no agent and offers to start one

### Requirement: Access is local and secret-bound
An instance SHALL accept connections only from the same machine and only with that review's secret. The secret SHALL
be different for every instance, SHALL be part of the address given to the user, and SHALL be stored readable only by
that user. A request without the secret SHALL be refused, and so SHALL a request made by a web page that the
instance did not serve.

#### Scenario: Request without the secret
- **WHEN** a request reaches an instance without its secret
- **THEN** it is refused and nothing is delivered to the agent or shown

#### Scenario: Another review's secret
- **WHEN** a request reaches review A with the secret of review B
- **THEN** it is refused

#### Scenario: Request from another site's page
- **WHEN** a page from another site, open in the user's browser, sends a request to an instance
- **THEN** it is refused
