# Connect Career Ops

Career Ops is the application system of record. The current bundle uses `LocalIdempotentTracker`; it does not ship a remote Career Ops adapter. Use this contract when adding that adapter.

## Security boundary

Run the adapter inside the server-side Harness plugin. Career Ops has no HTTP authentication and sends no CORS headers. It relies on loopback or a private tailnet, so never expose it to the public internet or call it from browser code.

Set the service location in an ignored environment file:

```dotenv
CAREER_OPS_BASE_URL=http://127.0.0.1:8098
```

The same-host default needs no credential. For a remote deployment, inject a private tailnet URL through the environment. Keep database and email-classifier credentials inside the Career Ops service; the Harness adapter does not need them.

Keep `network_enabled` and `external_writes_enabled` false until the adapter has passed its tests. A live tracker write must still follow an exact-job approval and a confirmed application submission.

## Read-only connection check

Start Career Ops, then check its contract and current totals:

```bash
curl --fail --silent --show-error \
  "$CAREER_OPS_BASE_URL/api/webhook/application"

curl --fail --silent --show-error \
  "$CAREER_OPS_BASE_URL/api/stats"
```

`GET /api/stats` returns `{ "stats": { ... } }`. Record `stats.total` before a write when you need to prove that a new application increased the count.

## Dedupe before a sweep

Load existing applications with `GET /api/applications`. It accepts `status`, `workplace`, `search`, and `sort`; valid sort values are `recent`, `company`, `status`, and `priority`.

The response is `{ "applications": [...] }`. Build the sweep's dedupe set from these records. Career Ops treats the case-insensitive pair `(company, title)` as the webhook identity. A URL is useful supporting evidence but is not part of that identity.

## Record a confirmed application

After the submission provider returns confirmation, send one JSON request to `POST /api/webhook/application`.

Use this webhook instead of `POST /api/applications`. The webhook is idempotent by case-insensitive company and title; the applications endpoint always inserts a new row.

Required fields:

- `title`
- `company`

Recommended fields:

- `workplace_type`: `remote`, `hybrid`, or `on-site`
- `status`: normally `applied`
- `application_method`: `portal`, `email`, `linkedin`, `referral`, `recruiter`, or `other`
- `location`, `url`, `notes`, `priority`, `source`, and `applied_at`

Valid priorities are `low`, `medium`, `high`, and `top`. Use a stable source name such as `dsh-job-hunter`.

The webhook returns:

```json
{
  "success": true,
  "action": "created",
  "id": "application-id",
  "application": {}
}
```

`action` is `created` with HTTP 201 for a new row or `updated` with HTTP 200 for an existing row. On update, non-empty scalar values replace existing values, omitted or empty values leave them unchanged, and notes append. Treat either action as a successful idempotent write.

Verify the returned ID immediately:

```bash
curl --fail --silent --show-error \
  "$CAREER_OPS_BASE_URL/api/applications/$APPLICATION_ID"
```

The response must contain the expected company and title. If `action` is `created`, fetch `/api/stats` and confirm that `stats.total` increased by one. An update should leave the total unchanged. Do not process another submission until this verification passes.

## Record a later status change

Resolve the application ID from the webhook response or `GET /api/applications`, then send:

```text
PATCH /api/applications/{id}
Content-Type: application/json

{"status":"interview_pending","note_entry":"Interview invitation received"}
```

Valid statuses are `wishlist`, `applied`, `interview_pending`, `interviewing`, `technical_assessment`, `offer`, `rejected`, and `archived`. Career Ops creates timeline entries for status changes and `note_entry`. There is no public endpoint for writing arbitrary application events.

## Adapter behavior

Add a `CareerOpsTracker` beside `LocalIdempotentTracker` in `plugin/src/application.js`, or place it in a separate provider plugin. The adapter should:

1. accept an injected base URL and reject non-loopback, non-private destinations by default;
2. use bounded timeouts and the Harness cancellation signal;
3. fetch existing applications for sweep dedupe;
4. post only after confirmed submission and exact-job approval;
5. verify the returned application ID and expected fields;
6. report `tracking_failed` on timeout, malformed JSON, a non-2xx response, or failed verification;
7. retry only safe reads automatically; rely on webhook dedupe before retrying a write.

Career Ops errors use `{ "error": "message" }`: HTTP 400 for an invalid request, 404 for a missing application, and 500 for a server or database failure.

The existing `scripts/notify-career-app.py` client in the Career Ops repository remains supported. It posts to the same webhook. A native Harness adapter should call the webhook directly so it can honor cancellation, inspect the structured response, and perform immediate verification.

## Service sources reviewed

Panel-builder verified this contract against the Career Ops routes and repositories:

- `src/app/api/applications/route.ts`
- `src/app/api/applications/[id]/route.ts`
- `src/app/api/webhook/application/route.ts`
- `src/app/api/stats/route.ts`
- `src/lib/repositories/applications.ts`
- `src/lib/repositories/events.ts`
- `src/lib/repositories/stats.ts`
- `src/lib/api-response.ts`
- `src/lib/webhook-payload.ts`
- `scripts/notify-career-app.py`
