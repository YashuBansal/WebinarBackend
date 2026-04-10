# Contact Import Load Test Runbook

## Goal
Validate async contacts import flow for `10k`, `50k`, and `100k` records without API timeout and with stable worker throughput.

## Pre-checks
1. Ensure Redis and MongoDB are healthy.
2. Set environment values:
   - `CONTACTS_IMPORT_QUEUE_CONCURRENCY=2`
   - `CONTACTS_IMPORT_CHUNK_SIZE=1000`
3. Start backend with worker enabled.

## Test Datasets
- `contacts_10k.csv`
- `contacts_50k.csv`
- `contacts_100k.csv`

Each file should include controlled proportions:
- 5% invalid phones
- 10% duplicate phones
- 10% existing phones (update path)
- remaining new phones

## Execution
1. Trigger import from UI (recommended) or API with generated payload.
2. Capture `importHistoryId` from `POST /contacts/bulk`.
3. Poll:
   - `GET /contacts/import-history/:id`
4. Verify final counters and status.

## Success Criteria
- Submit API returns quickly (target: < 2s) with `queued` status.
- `processing` progresses steadily (`processedRows` increases per poll).
- No process crash / worker restart.
- Final counters are correct:
  - `totalRows`
  - `validRows`
  - `invalidRows`
  - `duplicates`
  - `newCount`
  - `updatedCount`
  - `failedCount`
- Invalid sample limit respected:
  - `invalidRecordsSample.length <= 100`

## Tuning Guidance
- If Mongo CPU is high: lower `CONTACTS_IMPORT_QUEUE_CONCURRENCY`.
- If latency is high and DB is stable: increase `CONTACTS_IMPORT_CHUNK_SIZE` gradually (`1000 -> 1500 -> 2000`).
- If memory spikes: reduce chunk size.

## Failure Injection
- Kill Redis temporarily during processing.
- Expect retries and eventual `partial_success` or `failed` with `failureReason`.
- Ensure history remains queryable and no stuck `processing` beyond threshold.
