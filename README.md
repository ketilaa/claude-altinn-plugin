# claude-altinn-plugin

A [Claude Code](https://claude.com/claude-code) plugin marketplace for [Altinn Studio](https://docs.altinn.studio/)
app development — the .NET platform Norwegian public-sector organizations use to build digital services
(forms/e-services) on top of the Altinn platform.

## Why this exists

Altinn Studio apps are convention-driven: correct behavior depends on several files agreeing with each other
(`process.bpmn`, `policy.xml`, `applicationmetadata.json`, layout JSON, the data model) in ways that aren't
always obvious and don't always fail loudly when they disagree. Some of the gotchas here were only found by
reading Altinn's own platform source (`Altinn/altinn-studio`, `Altinn/app-lib-dotnet`) rather than guessing, or
by actually running an app end-to-end against a local Altinn environment and noticing what silently broke.

Rather than re-deriving that knowledge in every project or conversation, it's packaged here as **skills** —
scoped, reusable instructions Claude Code loads automatically when the task at hand matches, so the same
hard-won fixes and verification steps apply consistently across apps.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- The apps these skills target are .NET 8 Altinn Studio apps (`Altinn.App.Api`/`Altinn.App.Core`)

## Add this marketplace

```
/plugin marketplace add ketilaa/claude-altinn-plugin
```

To make this automatic for everyone working in an app repo (rather than a per-person, per-machine step), add it
to the repo's own `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "ketilaa-altinn": { "source": { "source": "github", "repo": "ketilaa/claude-altinn-plugin" } }
  },
  "enabledPlugins": { "altinn-app-dev@ketilaa-altinn": true }
}
```

## Install a plugin

```
/plugin install altinn-app-dev@ketilaa-altinn
```

## Plugins

- [`altinn-app-dev`](plugins/altinn-app-dev/README.md) — skills for developing Altinn Studio apps (the .NET
  Altinn.App.Api/Altinn.App.Core backend): relaying instance metadata to event subscribers, access-package/role
  authorization in `policy.xml`, page navigation/summary/submit wiring, and local end-to-end testing against
  `app-localtest`. See that plugin's own README for the full, up-to-date skill list.

## Repository structure

This follows Claude Code's standard plugin-marketplace layout:

```
.claude-plugin/marketplace.json       — marketplace manifest, lists the plugins below
plugins/<plugin-name>/
  .claude-plugin/plugin.json          — plugin manifest (name, description, author)
  README.md                           — human-facing overview of that plugin's skills
  skills/<skill-name>/
    SKILL.md                         — the skill itself: frontmatter (name/description used for
                                        auto-triggering) + the instructions Claude Code loads
    assets/, scripts/, references/    — optional bundled files a skill can point to
```

## Contributing / adding a skill

1. Create `plugins/altinn-app-dev/skills/<skill-name>/SKILL.md` with YAML frontmatter (`name`, `description`).
   The `description` is what Claude Code matches against to decide when to load the skill, so make it specific
   and keyword-rich — describe the concrete situations/phrasings that should trigger it, not just its topic.
2. Ground the content in something actually verified: real platform source, a real schema, or an actual
   reproduced bug/fix — not assumptions about how the platform "probably" works.
3. Update `plugins/altinn-app-dev/README.md`'s skill list.
4. Run `claude plugin validate .` from the repo root before committing.

## License

[MIT](LICENSE) — see the LICENSE file. Permissive and low-friction on purpose: this is developer-tooling
knowledge meant to be reused, forked, and adapted freely.
