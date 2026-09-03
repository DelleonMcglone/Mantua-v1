# 011 — Branch management (B-011)

**Status:** ✅ adopted 2026-09-03 · **Branch:** `011-branch-management`

## Convention

One branch per task document, named to match the document.

- A unit of work gets a **task document** in `docs/tasks/`, named
  `NNN-short-slug.md` (three-digit number, kebab-case slug), e.g.
  `001-repo-cleanup.md`, `012-ci-baseline.md`. The document states the task,
  its status, and anything a reviewer needs.
- The work happens on a **branch named exactly like the document** (without
  `.md`): `011-branch-management`, `012-ci-baseline`. Branch and document are
  created together; the branch's PR is the review surface for both.
- Numbers are allocated in ascending order and never reused. External task
  ids (e.g. `B-011` from the bootstrap checklist) are recorded in the
  document title, but the branch carries the document name, not the external
  id.
- `main` stays the integration branch; no direct feature commits to `main`
  once a task has a document. Docs-only fixups and emergency reverts may
  still land on `main` directly.

## Pre-convention branches

Branches created before this convention keep their names until merged:
`d110-wallet-reconciliation` (PR #1), `prediction-markets-schema` (PR #2).
New work from here on follows the `NNN-slug` form.
