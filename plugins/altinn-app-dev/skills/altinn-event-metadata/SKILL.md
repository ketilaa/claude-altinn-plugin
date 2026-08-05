---
name: altinn-event-metadata
description: Wires up an Altinn Studio (.NET) app to relay per-instance metadata — fixed values and/or values derived from the form data model — to a service owner's Altinn Events subscriber, via Instance.DataValues. Use this whenever working on an Altinn app and the user wants to "send", "relay", "forward", or "pass" custom fields/metadata to an event consumer, webhook, archive system, or "the service owner side" for every instance, including cases where the value should be computed from a field the user filled in (e.g. a templated title like "Report for ${model.someField}"). Also use it if the user asks how to add custom data to Altinn's CloudEvents, or mentions Instance.DataValues. Do NOT use this for configuring Altinn's built-in Fiks Arkiv/Noark5 archive integration specifically (that's a separate mechanism using FiksArkivSettings in appsettings.json, not covered by this skill) — only use this skill when the target is a generic Altinn Events subscriber reading Instance.DataValues.
---

# Altinn event metadata relay

## The problem this solves

Altinn Apps (built on `Altinn.App.Core`/`Altinn.App.Api`) can auto-publish CloudEvents to the Altinn Events
component for every instance (`app.instance.process.movedTo.*`, `app.instance.process.completed`, etc.), and a
service owner can subscribe a webhook to receive them. But the CloudEvent payload the framework sends is minimal
— just `type`, `subject`, `source` (a URL back to the instance) — it never carries a custom `data` payload. So
"relay field X to the event consumer" cannot be done by injecting extension attributes into the event itself.

The supported channel for this is **`Instance.DataValues`** (a `Dictionary<string,string>` stored on the
instance in Storage). The service owner's subscriber receives the lightweight event, follows its `source` URL
(or the Storage API) back to the instance, and reads `dataValues`. This skill wires up that relay generically,
for both:

1. **Static data** — a fixed value, same for every instance.
2. **Dynamic data** — a value derived from whatever the user entered in the form (e.g. a title that embeds a
   field the user filled in), kept in sync as the user edits and saves.

## How it works

One config-driven mechanism covers both cases, so you never write per-field C# code:

- An `EventMetadata` section in `appsettings.json` holds `"key": "template"` pairs. A template with no
  placeholder is just a static value. A template containing `${model.some.path}` gets that placeholder resolved
  against the current form data (dot-separated path into the model's JSON representation, matched
  case-insensitively — e.g. `${model.someField}`, or `${model.someObject.someNestedField}` for a nested object).
- `DataValueTemplateResolver` (pure string→string, no framework dependency) does the placeholder substitution.
- `EventMetadataSyncService` reads the config, resolves every template against the model, diffs the result
  against the instance's current `DataValues`, and only writes back (`IInstanceClient.UpdateDataValues`) when
  something actually changed.
- Two thin hooks feed that service so values are correct from the moment the instance exists and stay correct
  as the user edits the form:
  - `EventMetadataInstantiationProcessor` implements `IInstantiationProcessor.DataCreation` — fires once, right
    after the instance and its first data element are created.
  - `EventMetadataDataProcessor` implements `IDataProcessor.ProcessDataWrite` — fires on every subsequent save
    from the frontend (PATCH/PUT), so templated values tracking user input get re-resolved.

Both hooks are safe, additive extension points meant to be implemented by apps — registering them in
`RegisterCustomAppServices` does not fight the framework's own DI wiring (confirmed against the
`Altinn/app-lib-dotnet` source: `IInstantiationProcessor`'s default is registered with `TryAddTransient`, so an
app registration added first wins; `IDataProcessor` implementations are collected additively via
`GetAll<IDataProcessor>()`, so there's no override collision either way).

## Applying it to an app

1. **Confirm the app shape.** Check `App/App.csproj` for `Altinn.App.Core`/`Altinn.App.Api` package references
   (this was verified against v8.12.7; the interfaces used here — `IInstantiationProcessor`, `IDataProcessor`,
   `IInstanceClient.UpdateDataValues(Instance, Dictionary<string,string>)` — have been stable through the v7+
   `RegisterCustomAppServices` app template generation. If the target app is on a materially different major
   version, or its `App.csproj` predates the `RegisterCustomAppServices` convention, verify these signatures
   still match before assuming this recipe applies as-is).

2. **Copy the four bundled files** from this skill's `assets/` folder into the app under
   `App/EventMetadata/` (a plain, descriptive folder — avoid dumping this into a generic "CustomServices"-style
   catch-all; the name should say what the code does, not just that it isn't framework code):
   - `DataValueTemplateResolver.cs`
   - `EventMetadataSyncService.cs`
   - `EventMetadataInstantiationProcessor.cs`
   - `EventMetadataDataProcessor.cs`

   They use the namespace `Altinn.App.EventMetadata`. Check the target app's `App/App.csproj`
   `<RootNamespace>` — Altinn Studio scaffolds default to `Altinn.App`, so this namespace usually needs no
   change; adjust it if the app deviates.

3. **Register the services** in `App/Program.cs`, inside `RegisterCustomAppServices`:

   ```csharp
   services.AddTransient<EventMetadataSyncService>();
   services.AddTransient<IInstantiationProcessor, EventMetadataInstantiationProcessor>();
   services.AddTransient<IDataProcessor, EventMetadataDataProcessor>();
   ```

   Add the matching `using` directives (`Altinn.App.Core.Features;` and
   `Altinn.App.EventMetadata;`).

4. **Turn on event publishing.** In `App/appsettings.json`, set:

   ```json
   "AppSettings": {
     "RegisterEventsWithEventsComponent": true
   }
   ```

   This is the master switch — without it the app never publishes lifecycle events to the Events component at
   all, regardless of DataValues.

5. **Configure the fields to relay**, also in `App/appsettings.json`:

   ```json
   "EventMetadata": {
     "example.staticKey": "some-fixed-value",
     "example.dynamicKey": "Some text ${model.someField}"
   }
   ```

   This is the only thing that needs to change when the field list or the model changes later — no C# edits.

6. **Build to verify** (`dotnet build App/App.csproj`) — the four files have no external dependencies beyond
   what `Altinn.App.Core`/`Altinn.App.Api` already bring in, so a clean build is a good signal everything is
   wired correctly.

## Template syntax reference

| Template | Resolves to |
|---|---|
| `"some-fixed-value"` | itself (no placeholder → static value) |
| `"${model.someField}"` | the value of the model's `someField` (or `SomeField`) property |
| `"${model.someObject.someNestedField}"` | nested property, same case-insensitive dotted-path rule |
| `"Some text ${model.someField}"` | literal text with the resolved value spliced in |
| `"${model.doesNotExist}"` | empty string (missing paths resolve to `""`, never throw) |

## Caveats

- The CloudEvent published to the Events component still only ever carries `type`/`subject`/`source` — the
  service owner's consumer must follow `source` (or otherwise call the Storage/App API) to read
  `Instance.DataValues`. This skill does not and cannot put custom data directly into the CloudEvent JSON, since
  the framework's own `EventsClient` never populates the event's `data` field.
- Assumes the standard single-primary-data-type app shape (one data type bound to the layout set, as in
  `App/ui/layout-sets.json`). If an app has multiple data types/tasks, decide per data type whether
  `DataCreation`/`ProcessDataWrite` fire for the one you care about, since both hooks receive whatever
  data object triggered them.
- `UpdateDataValues` merges into the existing `DataValues` dictionary — it never deletes keys that aren't in the
  set you pass, so removing a key from the `EventMetadata` config won't retroactively clear it from instances
  that already have it set.
