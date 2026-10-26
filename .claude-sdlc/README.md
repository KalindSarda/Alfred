# .claude-sdlc/

This folder holds the generated SDLC-stage documents for this repo, produced by the team's SDLC skills
plugin. Each file in `outputs/` corresponds to one stage of the pipeline:

| File                          | Produced by                    | Contains                                   |
|--------------------------------|--------------------------------|---------------------------------------------|
| `01-requirements.md`           | requirement-skill               | Extracted client/stakeholder requirements   |
| `02-feasibility.md`            | feasibility-decision-skill      | Feasibility verdict + chosen tech stack     |
| `03-architecture.md`           | design-architect-skill          | System architecture + authoritative stack   |
| `04-dev-prompts.md`            | dev-prompt-skill                | Prompts for AI dev agents / LLM features    |
| `05-api-schema.md`             | dev-api-skill                   | API/schema conventions and endpoint list    |
| `06-review-backend.md`         | code-review-backend-skill       | Backend code review findings                |
| `07-review-frontend.md`        | code-review-frontend-skill      | Frontend code review findings               |
| `08-test-evaluation.md`        | test-evaluation-skill           | Test strategy + LLM/AI evaluation plan      |
| `09-deployment.md`             | deployment-skill                | Deployment/CI-CD plan                       |

Each file is a normal markdown file with a small YAML frontmatter block at the top (stage, stack,
inputs used, status). Regenerating a stage overwrites its file; skills append a `## Revision history`
line rather than silently discarding what was there before.

This folder is generated and maintained by Claude — edit by hand if you like, later skill runs will
treat your edits as the current source of truth.
