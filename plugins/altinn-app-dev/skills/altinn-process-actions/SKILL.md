---
name: altinn-process-actions
description: Wires up multi-page navigation, a summary page, and a submit button for an Altinn Studio app's form pages, using the schema-verified NavigationBar/NavigationButtons/Summary2/ActionButton components — and covers the non-obvious authorization wiring a submit button needs (process.bpmn, policy.xml, and the layout must all agree on the exact same action-id string, or the button just silently stays disabled forever with no visible error). Use this whenever the user wants "navigation between pages", "a next/back button", "a summary page before submit", "a submit button", or "an action button" added to an Altinn app's form; also use it if a submit/confirm/complete/sign/reject ActionButton renders permanently disabled/greyed-out with no error message, or if the user is confused about "confirm" vs "complete" as an action name.
---

# Altinn multi-page navigation, summary, and submit

## What this covers

A freshly-scaffolded Altinn app has one layout page per data-collection step and no way to move between them
except deep-linking the URL, no summary, and no way to actually finish (submit) the process. This skill covers
adding the standard chrome for that: a nav bar across the top of every page, prev/next buttons at the bottom,
a final summary page, and a real submit action — plus the process/policy wiring the submit action needs to
actually be allowed to run, which is the part that silently breaks if you skip it.

All component shapes below were confirmed against Altinn's real layout JSON schema
(`https://altinncdn.no/toolkits/altinn-app-frontend/4/schemas/json/layout/layout.schema.v1.json`), not guessed.

## The four components

**`NavigationBar`** — one per page, anywhere in that page's layout array (top is conventional):
```json
{ "id": "<page>-navbar", "type": "NavigationBar", "validateOnForward": { "page": "current", "show": ["All"] } }
```

**`NavigationButtons`** — one per page (bottom is conventional):
```json
{
  "id": "<page>-navbuttons",
  "type": "NavigationButtons",
  "showBackButton": true,
  "validateOnNext": { "page": "current", "show": ["All"] },
  "textResourceBindings": { "back": "<textId>", "next": "<textId>" }
}
```
**Set `textResourceBindings.back`/`.next` explicitly and add the matching text resources.** Without them the
buttons render the literal untranslated strings "back"/"next" — this is easy to miss because it doesn't error
or warn anywhere, it just silently shows English text in an otherwise fully-localized app. There's also a
`backToPage` binding for when a `linkToPage`/`linkToComponent` expression is used, not covered further here.

**`Summary2`** — the summary page's main content. The default `target` (`{"type": "layoutSet"}`) auto-summarizes
every page and field in the whole layout set with zero manual per-field listing:
```json
{ "id": "<page>-summary", "type": "Summary2" }
```

**`ActionButton`** — the actual submit/confirm/sign/reject control:
```json
{
  "id": "<page>-submit",
  "type": "ActionButton",
  "action": "confirm",
  "buttonStyle": "primary",
  "textResourceBindings": { "title": "<textId>" }
}
```
`action` is an **enum with exactly four valid values**: `instantiate`, `confirm`, `sign`, `reject` — nothing
else. For a plain single-task data-collection app's submit button, use `confirm`. Do not use `"complete"` here
even though it shows up in some official Altinn test fixtures and does work at runtime as a raw pass-through
string — it is not a valid value per the actual frontend schema, so a layout using it will fail schema
validation and is not future-proof. `confirm` is the officially-documented, schema-valid choice for "finish this
task and move the process on."

## The authorization wiring a non-`read`/`write` action needs — the easy-to-miss part

Adding an `ActionButton` to the layout is not enough by itself. Confirmed by reading the actual
`Altinn.App.Api`/`Altinn.App.Core` source (`ProcessController.cs`, `AltinnTaskExtension.cs`, `AuthorizationService.cs`,
`ProcessEngine.cs` — not guessed):

1. **The list of actions a user can even be authorized for on a task is not a fixed built-in enum.** It's
   literally just `read` + `write` (always implicit, no declaration needed) plus whatever the task's own
   `<altinn:actions>` element in `process.bpmn` declares. If the BPMN task doesn't declare an action, that
   action can **never** appear as authorized — no matter what `policy.xml` says. This is the single most common
   way a submit button ends up permanently disabled with no error anywhere: the button simply never gets an
   action to check, because nothing declared it as a candidate.

2. **Declare the action on the task in `process.bpmn`**, inside the same `<altinn:taskExtension>` that already
   sets `<altinn:taskType>`:
   ```xml
   <bpmn:task id="Task_1" name="...">
     <bpmn:extensionElements>
       <altinn:taskExtension>
         <altinn:taskType>data</altinn:taskType>
         <altinn:actions>
           <altinn:action>confirm</altinn:action>
         </altinn:actions>
       </altinn:taskExtension>
     </bpmn:extensionElements>
   </bpmn:task>
   ```

3. **Grant the same action in `policy.xml`** — add an `<xacml:AllOf>` action-id match for the identical string
   inside the end-user rule's action `<xacml:AnyOf>` (same pattern as the existing `read`/`write`/`instantiate`
   entries there; see the `altinn-access-policy` skill for the full rule shape):
   ```xml
   <xacml:AllOf>
     <xacml:Match MatchId="urn:oasis:names:tc:xacml:3.0:function:string-equal-ignore-case">
       <xacml:AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">confirm</xacml:AttributeValue>
       <xacml:AttributeDesignator AttributeId="urn:oasis:names:tc:xacml:1.0:action:action-id"
         Category="urn:oasis:names:tc:xacml:3.0:attribute-category:action"
         DataType="http://www.w3.org/2001/XMLSchema#string" MustBePresent="false" />
     </xacml:Match>
   </xacml:AllOf>
   ```

4. **All three places — the layout's `ActionButton.action`, the BPMN's `<altinn:action>`, and the policy's
   action-id value — must be the exact same literal string.** The frontend posts whatever string the button is
   configured with verbatim to `process/next`; nothing translates or aliases it. A mismatch anywhere in this
   triangle (e.g. `"confirm"` in the layout but `"complete"` in the policy) fails silently: the button just never
   becomes enabled, with no console error, no network error, nothing — because the action never shows up as
   `authorized: true` (or doesn't show up in the candidate list at all) in the instance's `process` response.

**Fastest way to check what's actually wrong**, in order: `GET .../instances/{party}/{guid}/process` and look at
`currentTask.userActions` —
- action missing entirely from the list → step 1/2, the BPMN never declared it as a candidate
- action present with `"authorized": false` → step 3, the policy doesn't grant it (or the subject/role/package
  match in `policy.xml` doesn't fit the current test user — see `altinn-access-policy`)
- action present and `authorized: true` but the button still looks disabled → check the literal string in the
  layout's `ActionButton.action` matches exactly

## Verification

1. Schema-validate every changed/new layout JSON file against the real schema (fetch
   `layout.schema.v1.json` + its `expression.schema.v1.json` dependency, validate with `jsonschema` + a
   `referencing.Registry` covering both).
2. Use `app-localtest` (see the `altinn-local-test` skill) to actually click through the flow in a browser:
   confirm the nav bar shows every page, prev/next actually move between pages and fire validation per
   `validateOnNext`/`validateOnForward`, the summary page shows real entered data, and the button text isn't
   showing untranslated placeholders.
3. Click submit and don't just check that it didn't error — confirm the instance's `process.ended`/
   `currentTask` via the API afterward to prove the process actually completed, not merely that the button
   click didn't throw.
4. If submission hangs or 500s specifically during this step and the app has `enablePdfCreation: true`, see the
   `altinn-local-test` skill's PDF-generation/Zscaler note before assuming it's a bug in the action wiring above.
