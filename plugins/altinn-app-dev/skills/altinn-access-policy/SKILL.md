---
name: altinn-access-policy
description: Configures who is authorized to use an Altinn Studio app, via App/config/authorization/policy.xml — the XACML file that decides whether a user gets in at all (read/write/instantiate/complete), as either a specific Altinn role (e.g. Daglig leder, Privatperson) or a specific Altinn access package (e.g. "Bergverk", any "urn:altinn:accesspackage:*"). Use this whenever the user wants an app to require a named role or access package to use the service, asks "who can use this app", mentions restricting instantiation to certain users/organizations, or asks how access packages connect to an Altinn app's authorization. Also use it if the user assumes access-package requirements are configured somewhere outside the app repo (e.g. "in the Resource Registry" or "an Altinn admin panel") — that's a common misconception this skill corrects.
---

# Altinn app access control (policy.xml)

## What this is for

Every Altinn Studio app ships with `App/config/authorization/policy.xml`, an XACML policy that's the actual
source of truth for who can do what with the app — not just a description, an enforced gate. It typically has
at least two rules: one for the end user (what roles/packages let someone read/write/instantiate/complete the
service) and one for the service owner org itself. This skill covers **changing who the end-user rule lets in**
— most commonly, replacing or adding to the default role-based check with a requirement for a specific Altinn
access package.

## Where this configuration actually lives — and where it doesn't

**It's entirely inside the app repo, in `policy.xml` itself.** This was confirmed by reading Altinn's own
source rather than assuming:

- `Altinn/altinn-studio` → `src/Designer/backend/PolicyAdmin/PolicyConverter.cs` — Studio's own Policy Editor
  backend parses `policy.xml`'s subject `<xacml:AnyOf>` matches and explicitly splits any value whose URN
  `StartsWith("urn:altinn:accesspackage")` into a separate `AccessPackages` list, distinct from role-based
  (`urn:altinn:rolecode`) matches. This is the same file format used in the app repo.
- `Altinn/altinn-studio-docs` (`concepts/data-model/restricted-data`): "The policy.xml file is the primary
  source of authorization policies, but permissions can also be delegated through access packages in Altinn."
- Deployment behavior: publishing an app pushes `policy.xml` to Storage's Policy Retrieval Point, and the
  pipeline mirrors the resource into Altinn's Resource Registry — but the registry entry is *derived from*
  policy.xml, not an independent place where you separately configure the access-package requirement.

**A common wrong assumption to watch for**: that requiring an access package means registering something in
a Resource Registry admin UI, separate from the app's own git history. It doesn't — if you change `policy.xml`
and redeploy, that's the whole change.

**Also unrelated, despite sounding similar**: `App/config/applicationmetadata.json`'s `partyTypesAllowed` field.
That only gates the **party type** (`organisation`, `person`, `subUnit`, `bankruptcyEstate`) — nothing about
which specific access package or role a user needs. Don't conflate the two: an app can allow `organisation`
broadly in `partyTypesAllowed` while still requiring a specific access package in `policy.xml` to actually act
on behalf of one.

## The two subject-match patterns

Role-based (the Altinn Studio default scaffold ships with this — Daglig leder + Privatperson):

```xml
<xacml:AnyOf>
  <xacml:AllOf>
    <xacml:Match MatchId="urn:oasis:names:tc:xacml:3.0:function:string-equal-ignore-case">
      <xacml:AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">dagl</xacml:AttributeValue>
      <xacml:AttributeDesignator AttributeId="urn:altinn:rolecode"
        Category="urn:oasis:names:tc:xacml:1.0:subject-category:access-subject"
        DataType="http://www.w3.org/2001/XMLSchema#string" MustBePresent="false" />
    </xacml:Match>
  </xacml:AllOf>
</xacml:AnyOf>
```

Access-package-based (verified against an `Altinn/altinn-authorization-tmp` XACML test fixture):

```xml
<xacml:AnyOf>
  <xacml:AllOf>
    <xacml:Match MatchId="urn:oasis:names:tc:xacml:3.0:function:string-equal-ignore-case">
      <xacml:AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">bergverk</xacml:AttributeValue>
      <xacml:AttributeDesignator AttributeId="urn:altinn:accesspackage"
        Category="urn:oasis:names:tc:xacml:1.0:subject-category:access-subject"
        DataType="http://www.w3.org/2001/XMLSchema#string" MustBePresent="false" />
    </xacml:Match>
  </xacml:AllOf>
</xacml:AnyOf>
```

Only the `AttributeId` (`urn:altinn:rolecode` vs `urn:altinn:accesspackage`) and the value change — the
resource (`urn:altinn:org`/`urn:altinn:app`) and action (`read`/`write`/`instantiate`/...) `AnyOf` blocks
elsewhere in the same `<xacml:Rule>` stay untouched. You can also combine both patterns as separate `<xacml:AllOf>`
entries inside one `<xacml:AnyOf>` if either a role or a package should qualify.

## Applying this to an app

1. Open `App/config/authorization/policy.xml`. Find the end-user rule (usually `ruleid:1`) — its subject
   `<xacml:AnyOf>` is the first one inside the rule's `<xacml:Target>`, right before the resource/action blocks.
2. Replace (or add alongside) the role-based `<xacml:AllOf>` entries with the access-package pattern above,
   substituting the correct package value.
3. Get the exact package identifier right — don't guess it from the package's display name. Look it up via
   Altinn's access-package catalog (search `docs.altinn.studio`/`altinn-studio-docs` GitHub repo for the
   category listing, or check `https://tjenesteoversikten.no/package/<name>`). The value used in `policy.xml`
   is the short slug from the URN (e.g. `urn:altinn:accesspackage:bergverk` → value `bergverk`), not the
   human-readable name.
4. If the app should now only make sense for organizations (not private individuals), also check
   `App/config/applicationmetadata.json`'s `partyTypesAllowed` — narrowing it there is a UX improvement (don't
   offer party types that can't actually pass authorization), but remember it does not itself enforce the
   access-package requirement; `policy.xml` is what does that.

## Verification

There's no local way to test access-package-based authorization — `app-localtest` (see the `altinn-local-test`
skill) doesn't model Altinn's access-package/authorization system, only Storage/Events/basic role checks. Treat
this as deploy-time-only verification: confirm the change in a real test environment (TT02) after deployment,
not locally.
