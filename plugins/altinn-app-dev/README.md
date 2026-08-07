# altinn-app-dev

Skills for developing Altinn Studio apps (the .NET Altinn.App.Core/Altinn.App.Api backend).

## Skills

- [`altinn-event-metadata`](skills/altinn-event-metadata/SKILL.md) — relay fixed and form-data-derived fields
  to a service owner's Altinn Events subscriber via `Instance.DataValues`.
- [`altinn-local-test`](skills/altinn-local-test/SKILL.md) — spin up `app-localtest` and drive an app through it
  via HTTP to verify real runtime behavior (instantiation, data writes, published events, DataValues).
- [`altinn-access-policy`](skills/altinn-access-policy/SKILL.md) — configure who can use an app via
  `policy.xml`, including requiring a specific Altinn access package instead of (or alongside) a role.
- [`altinn-process-actions`](skills/altinn-process-actions/SKILL.md) — add page navigation, a summary page, and
  a submit button (`NavigationBar`/`NavigationButtons`/`Summary2`/`ActionButton`), including the process.bpmn +
  policy.xml + layout action-id wiring a submit button needs to not be permanently disabled.
- [`altinn-map-polygon-upload`](skills/altinn-map-polygon-upload/SKILL.md) — display a WKT polygon on a Map
  component from an uploaded file, including the trigger-field + geometry-list data model, the
  `ProcessDataWrite` that reads the attachment, and the FileUpload/Map layout bindings.
