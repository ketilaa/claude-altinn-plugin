---
name: altinn-local-test
description: Spins up a local Altinn platform (app-localtest) and drives an Altinn Studio app through it via HTTP, to smoke-test real app behavior (instantiation, data writes, process state, published events, DataValues) without deploying anywhere. Use this whenever the user wants to "test locally", "run my Altinn app locally", "verify this actually works" against a real instance, "check the events got published", "inspect DataValues", or mentions app-localtest, LocalTest, or a local Altinn/Storage/Events API. Also use it if a local `dotnet run` of an Altinn app behaves strangely (random port, wrong platform endpoints) — that's almost always the studioctl gotcha covered here.
---

# Local Altinn app testing

## What this is for

Altinn Studio apps depend on platform services (Storage, Register, Authentication, Events, ...) that normally
only exist in Altinn's cloud environments. `app-localtest` (https://github.com/Altinn/app-localtest) is Altinn's
own Dockerized stand-in for those services, letting an app run and be driven end-to-end on a dev machine — real
instantiation, real data writes, a real process state machine, real published CloudEvents — with everything
inspectable as plain files on disk. Use this whenever you need to prove an app behaves correctly at runtime,
not just that it compiles.

## Setup

1. **Clone `app-localtest`** as a sibling to the app repo (or anywhere convenient):
   ```
   git clone https://github.com/Altinn/app-localtest.git
   ```

2. **Point its storage at a host-visible directory**, so instances/events/data land as files you can read
   directly instead of being buried in an anonymous Docker volume. Create `.env` in `app-localtest/`:
   ```
   ALTINN3LOCALSTORAGE_PATH=/absolute/path/to/app-localtest/AltinnPlatformLocal/
   ```
   Create that directory first (`mkdir -p`) — the container won't create it for you.

3. **Start the containers**:
   ```
   docker compose up -d --build
   ```
   This starts three services: the gateway/loadbalancer (`local.altinn.cloud`, default port 80), the LocalTest
   API itself (default port 5101), and a PDF-generation worker. `local.altinn.cloud` resolves to `127.0.0.1` via
   public DNS — no `/etc/hosts` edit needed.

   If the default gateway port (80) is already taken by something else on the machine, override it via `.env`:
   ```
   ALTINN3LOCAL_PORT=<free-port>
   ```
   Check what's actually free before picking a number — don't assume 80 or any other specific port is available.

4. **Confirm it's healthy** before touching the app:
   ```
   docker ps --filter name=localtest
   curl http://localhost:5101/health
   ```

5. **Run the app** from its `App/` folder — see the studioctl section below before doing this, it changes the
   command:
   ```
   cd <app-repo>/App
   dotnet run
   ```
   The app's own `appsettings.json` should already point `PlatformSettings.Api*Endpoint` at the LocalTest API
   port (5101 by default) and `GeneralSettings.HostName` at `local.altinn.cloud` — this is how Altinn Studio
   scaffolds apps, so it's rarely something you need to change.

## The studioctl gotcha

If **`studioctl`** (Altinn's newer local-dev CLI) happens to be installed on the machine, it silently hooks into
`dotnet run`/`dotnet build` for any app in Development mode and injects its own configuration — including
rebinding Kestrel to `http://127.0.0.1:0` (a random OS-assigned port every run) and redirecting every
`PlatformSettings` endpoint to whatever local environment `studioctl` itself manages. This happens transparently,
with no warning printed, and produces confusing symptoms: the app listens on a different port every time, and
`LocaltestValidation` may shut the app down immediately complaining it can't reach LocalTest — because it's
checking studioctl's assumed endpoint, not the one in your `appsettings.json`.

**Don't try to detect whether studioctl is present before deciding what to do.** Just always set one environment
variable before running the app:

```
STUDIOCTL_APP_RUN=1 dotnet run
```

This is what studioctl's own injection hook checks for to skip itself (it's the same variable studioctl sets
internally when *it* launches the app, to avoid double-injecting). Setting it yourself is a complete no-op if
studioctl isn't installed at all, and reliably disables the auto-injection if it is — so the exact same command
works unmodified on a machine with studioctl and one without. This makes the recipe deterministic without ever
needing to branch on whether the tool is present.

(There is an alternative path — `studioctl app run` lets studioctl manage the whole local environment itself
instead of your manually-started `app-localtest` containers. That brings its own port/service conventions, and
is a genuinely different workflow rather than a drop-in replacement for the steps above — worth knowing it
exists, but treat the manual `app-localtest` + `STUDIOCTL_APP_RUN=1` recipe as the default, always-works path.)

## Getting a test-user token

`app-localtest` mints JWTs for test identities directly over HTTP — no real login flow needed:

```
curl "http://localhost:5101/Home/auth/user?userId=<id>&partyId=<id>&authenticationLevel=2"
```

Valid `userId`/`partyId` pairs come from `app-localtest`'s own `testdata/authorization/roles/User_<userId>/party_<partyId>`
folder structure — look there for an existing pairing rather than guessing IDs. The response body is the raw
JWT string; use it as `Authorization: Bearer <token>` on every subsequent call.

## Driving the app via HTTP

Instantiate a new instance:
```
curl -X POST "http://localhost:<app-port>/<org>/<app-name>/instances?instanceOwnerPartyId=<partyId>" \
  -H "Authorization: Bearer <token>"
```
The response includes the instance `id` (`<partyId>/<instanceGuid>`) and the created data element's `id`.

Write form data (content type depends on the data type — typically `application/xml` for a model-bound data
type, matching the model's `[XmlRoot]`/`[XmlElement]` shape):
```
curl -X PUT "http://localhost:<app-port>/<org>/<app-name>/instances/<instanceId>/data/<dataGuid>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/xml" \
  --data-raw '<model><someField>value</someField></model>'
```

Re-fetch the instance at any point to see its current state (process status, `dataValues`, etc.):
```
curl "http://localhost:<app-port>/<org>/<app-name>/instances/<instanceId>" \
  -H "Authorization: Bearer <token>"
```

## Inspecting results on disk

With `ALTINN3LOCALSTORAGE_PATH` set to a host directory (see Setup step 2), everything LocalTest persists is a
plain JSON file underneath it:

- `documentdb/instances/` — instance documents (mirrors what the instance GET endpoint returns)
- `documentdb/data/<instanceGuid>/` — data element metadata
- `documentdb/events/` — every CloudEvent the app published to the Events component, one file per event, named
  by event ID. This is the ground truth for "did my app actually publish this event" — read the file directly
  rather than trying to query anything.
- `documentdb/instanceevents/` — Storage's own instance audit trail (created/saved/deleted etc.) — a different,
  lower-level concept from the CloudEvents in `documentdb/events/`, don't conflate the two.
- `blobs/<org>/<app-name>/<instanceGuid>/data/` — the actual data element contents (e.g. the XML you PUT)

## Cleanup

```
docker compose down        # in app-localtest/
kill <dotnet-process-pid>  # or Ctrl+C if run in the foreground
```
