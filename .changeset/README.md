# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

## Releasing a new version

1. After making a change worth shipping, run:

   ```bash
   npx changeset
   ```

   Pick `patch` / `minor` / `major` and write a short note. A new `.md` file lands in `.changeset/`. Commit it with the change.

2. When changes land on `master`, the **Release** GitHub Action opens (or updates) a "Version Packages" PR that bumps `package.json`, rewrites `CHANGELOG.md`, and consumes the changeset files.

3. Merging that PR triggers the same workflow to run `changeset publish`, which pushes the new version to npm and creates a GitHub release.

## Conventions

- One changeset per logical change. Multiple are fine in one PR.
- Use `patch` for fixes and internal refactors, `minor` for additive API, `major` only when intentionally breaking public types or props (see `src/index.ts`).
- Mentioning issue/PR numbers in the note is fine — the GitHub changelog formatter will link them.
