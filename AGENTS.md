## Agent skills

### Issue tracker

Issues live in GitHub Issues for Avilash2001/faceless-video-pipeline, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.

### Finishing a ticket

A ticket worked with `/implement` is finished once, after the code review, all of these hold:

1. The work is committed and pushed to `origin`.
2. Every acceptance-criteria box the work meets is ticked in the ticket body.
3. The ticket is closed with a comment naming the commits, what was checked by hand rather than by tests, and any follow-ups left open.

The `gh` commands are in `docs/agents/issue-tracker.md`.
