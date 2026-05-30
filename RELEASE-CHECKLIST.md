# Release checklist

## One-time setup

- [ ] Register the publisher / confirm `PublisherId` in `pyproject.toml` `[tool.comfy]`.
- [ ] Create the `REGISTRY_ACCESS_TOKEN` repo secret (PAT from https://registry.comfy.org/).
- [ ] Confirm gitops pushes `RELEASE_PLEASE_APP_ID` (var) + `RELEASE_PLEASE_PRIVATE_KEY` (secret).
- [ ] Add the repo to `gitops/repositories.tf` (do not configure via the GitHub UI).

## Per release

- [ ] Land work via conventional commits on feature branches → PRs to `main`.
- [ ] Merge the release-please PR (it bumps `version` + updates `CHANGELOG.md`).
- [ ] The version bump on `main` triggers `publish.yml` → Comfy Registry.
- [ ] Verify the new version appears on registry.comfy.org.
