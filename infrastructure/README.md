# infrastructure

Reserved for deployment/infrastructure-as-code assets (container definitions, hosting
configuration, environment topology) introduced in later phases.

Phase 0 keeps this directory as a structural placeholder only. Dockerfiles for
`apps/api` and `apps/worker` currently live alongside each app; this directory will
host shared infra manifests (e.g. Render/Vercel config, IaC) once those decisions are
implemented.
