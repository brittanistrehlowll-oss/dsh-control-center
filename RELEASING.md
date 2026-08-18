# Releasing — DSH Control Center

Every artifact in this project is an **Unsigned Pilot Build** until a Windows
code-signing certificate is available. Never claim an artifact is a signed
release.

## Artifact set

```
DSH-Control-Center-Setup-x.y.z.exe
DSH-Control-Center-Portable-x.y.z.exe
SHA256SUMS.txt
```

`pnpm hash:artifacts` writes `SHA256SUMS.txt` next to the artifacts
(`release/` or `artifacts/`), or is a no-op when nothing is built.

## Pre-release checklist (all must pass)

- [ ] `pnpm test` — full suite green
- [ ] `pnpm verify:contract` — contract surface pinned
- [ ] `pnpm scan:secret` — no credentials/cookies/prompts in tracked state
- [ ] `pnpm scan:path` — no absolute local paths in committed files
- [ ] License scan (MIT headers, no incompatible deps)
- [ ] CI run on the tag (workflow requires `workflow`-scoped token to be
      committed first — see README "CI")
- [ ] Windows E2E: clean install, upgrade, rollback, uninstall (Checkpoint C)
- [ ] Installer smoke test on a clean Windows machine
- [ ] Artifact hashes computed and committed
- [ ] README and release notes updated

## Versioning

Follow `dsh-v<semver>` tags, mirroring the DSH official convention:

- stable: `dsh-v1.2.3`
- preview: `dsh-v1.2.3-rc.N` / `-beta.N`

The update provider only accepts `dsh-v<semver>` tags from
`deepseek-ai/deepseek-harness`; this repo's own tags use the same shape.

## Release steps

1. Bump `version` in root `package.json` (and any package whose version
   changes).
2. Run the pre-release checklist.
3. Tag: `git tag dsh-v<version>` and push (`git push origin dsh-v<version>`).
4. Build artifacts (Electron builder / installer pipeline — Checkpoint C).
5. `pnpm hash:artifacts` → commit `SHA256SUMS.txt`.
6. Create a GitHub Release with the artifacts attached, marked:

   ```
   Unsigned Pilot Build — not a signed release.
   SHA256: see SHA256SUMS.txt
   ```

7. Write release notes: what changed, what gates passed, known limitations.

## Rollback of a bad release

If a released version fails the update gate or crashes on real DSH:

1. Remove or mark the tag as broken (do not delete the tag if already
   referenced; add a `-broken` note in the release body).
2. Re-publish the previous good version with a patch bump if needed.
3. The UpdateCoordinator's rollback path (stop new → restore old → restart →
   verify old identity/version/profile) is the recovery contract for users who
   already updated.

## Publishing tokens

The current publishing token (Windows Credential Manager, `x-access-token`)
can push repository content but lacks `workflow` scope and REST API access.
Consequences:

- `.github/workflows/ci.yml` cannot be pushed by this token — enable CI via a
  PR from an account with `workflow` scope, or grant the scope.
- Repository topics and Releases cannot be created via the REST API — set
  topics in the web UI (Settings → General → Topics) and create Releases via
  the web UI, or use a classic PAT with `repo` scope.