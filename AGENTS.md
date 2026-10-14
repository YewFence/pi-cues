After changing project code or configuration, run `mise run check` before finishing and make sure the check passes. If the check fails, try `mise run fix` first, then fix any remaining issues manually.

This project is in early development and does not require backward compatibility yet. When a cleaner long-term design requires an incompatible change, make the change deliberately instead of preserving compatibility through extra complexity.

Record significant design decisions as ADRs in `docs/adrs/` (lightweight MADR: context / decision / rejected alternatives / consequences), numbered sequentially, and register them in the VitePress sidebar in `docs/.vitepress/config.ts`. A decision is significant when it rejects a plausible alternative for a non-obvious reason — if a future contributor could reasonably ask "why not X?", the answer belongs in an ADR. Never edit an accepted ADR to change its decision; supersede it with a new one.
