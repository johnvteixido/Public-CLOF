# Engineering Roadmap

This roadmap records the next engineering work for Client Lead & Outreach Finder. It is intentionally linked to GitHub Issues so that scope, decisions, implementation, and closure can be reviewed over time.

**Roadmap status:** Baseline hardened; follow-up work is planned and tracked.  
**Last updated:** 2026-11-14

## Current baseline

The initial public source snapshot is available on `main`. Its CI run completed successfully with dependency-audit gates, TypeScript, ESLint, 52 tests across 7 files, and a production build:

- [Public CI run #43616529377](https://github.com/johnvteixido/Public-CLOF/actions/runs/43616529377)
- [Architecture overview](architecture.md)
- [Security model and known limitations](security-model.md)
- [Reviewer guide](reviewer-guide.md)

The public repository was created as a clean source snapshot. Its short initial commit history is deliberate: the earlier private repository history was not copied because it contained owner-specific development material. This roadmap and its issue tracker are the public project's forward-looking development record; they do not imply that planned work has already been implemented.

## Prioritized follow-up work

| Priority | Workstream | Status | Tracking |
|---|---|---|---|
| P1 | Shared rate limiting and session revocation | Planned | [#1](https://github.com/johnvteixido/Public-CLOF/issues/1) |
| P1 | Versioned schema provisioning and least-privilege runtime role | Planned | [#2](https://github.com/johnvteixido/Public-CLOF/issues/2) |
| P1 | Durable Gmail outbox and atomic send-cap reservations | Planned | [#3](https://github.com/johnvteixido/Public-CLOF/issues/3) |
| P2 | Content Security Policy after asset-source audit | Planned | [#4](https://github.com/johnvteixido/Public-CLOF/issues/4) |
| P2 | Provider contract tests, coverage reporting, and dependency advisory cleanup | Planned | [#5](https://github.com/johnvteixido/Public-CLOF/issues/5) |

Priority is a sequencing recommendation, not a promise of a release date. Work is considered complete only when its issue's acceptance criteria are met, code and tests are merged, and CI passes.

## Development and review policy

1. Keep changes scoped to a focused branch and pull request whenever practical.
2. Link the relevant issue from each pull request; explain the problem, implementation choice, and trade-offs.
3. Add or update automated tests for behavior changes, especially around authentication, untrusted network input, persistence, and outbound email.
4. Require the normal CI workflow to pass: install, dependency audits, TypeScript, ESLint, tests, and production build.
5. Update the architecture or security documentation when a trust boundary, operational assumption, or known limitation changes.
6. Do not close roadmap issues because code was merely drafted. Close them only after acceptance criteria are verified against the merged implementation.
7. Keep secrets, production credentials, customer data, and private deployment configuration out of commits, issue bodies, and test fixtures.

## What is intentionally not claimed

- There is no public hosted demo at this time.
- The project has not undergone an independent penetration test or formal security certification.
- The open issues above are future work, not completed capabilities.
- A passing CI run demonstrates that the checked-in validation suite passed; it does not prove the application is free of defects or secure under every deployment configuration.

## How to assess progress

Reviewers can use the [open issues](https://github.com/johnvteixido/Public-CLOF/issues) to see prioritized work, inspect linked pull requests as implementation progresses, and use the [Actions history](https://github.com/johnvteixido/Public-CLOF/actions) to verify that changes continue to pass CI.
