# Scripts

## Attendee Tag Migration

This script copies attendee `tags` into the matching `AttendeeAssociation` documents (grouped by `adminId` + `email`) without removing the original data.

### Run

```bash
npm install
npx ts-node -r tsconfig-paths/register scripts/migrate-attendee-tags.ts
```

### Notes

- Safe to re-run: tags are normalized (lowercase, spaces removed) and added via `$addToSet`, so duplicates are ignored.
- Progress is logged every 100 migrations; a summary is printed at the end.
- Errors for individual attendees are logged but do not stop the migration.

## Delete Duplicate Attendees

This script identifies and removes duplicate attendees based on the unique index fields (`adminId`, `webinar`, `isAttended`, `email`), keeping only the oldest entry per duplicate group and creating a backup of all deleted records.

### Run

```bash
npm run delete:duplicate-attendees
```

Or directly:

```bash
npx ts-node -r tsconfig-paths/register scripts/delete-duplicate-attendees.ts
```

### How It Works

1. **Duplicate Detection**: Uses MongoDB aggregation to find all groups of attendees that share the same combination of `adminId`, `webinar`, `isAttended`, and `email`.

2. **Selection Strategy**: For each duplicate group, keeps the attendee with the earliest `createdAt` timestamp. If `createdAt` is missing, falls back to using the `_id` ObjectId timestamp.

3. **Backup Creation**: Before deletion, all duplicate attendees are saved to two backup files in the `scripts/` directory:
   - JSON file: `attendees-backup-YYYY-MM-DD-HH-MM-SS.json` (for programmatic restoration)
   - Text file: `attendees-backup-YYYY-MM-DD-HH-MM-SS.txt` (for human-readable viewing)

4. **Deletion**: Removes all duplicates except the oldest one from each group.

5. **Verification**: After deletion, verifies that no duplicates remain and reports any issues.

### Backup File Format

Two backup files are created:

1. **JSON File** (`attendees-backup-*.json`):
   - **Metadata**: Timestamp, script version, statistics (total duplicates found, deleted, kept)
   - **Deleted Attendees**: Full document data for all deleted attendees, including all fields and properly serialized ObjectIds
   - Used by the restore script for programmatic restoration

2. **Text File** (`attendees-backup-*.txt`):
   - Human-readable format with all deleted attendee details
   - Includes metadata summary at the top
   - Each attendee's information is clearly formatted with all fields
   - Useful for quick viewing, manual inspection, or documentation

### Safety Features

- **Backup First**: All deleted records are backed up before deletion
- **Detailed Logging**: Progress is logged every 50 groups processed
- **Error Handling**: Individual group failures don't stop the entire process
- **Verification**: Post-deletion check confirms no duplicates remain
- **Statistics**: Comprehensive summary of operations performed

### Important Notes

- **Backup Location**: Backup files are created in the `scripts/` directory
- **Restoration**: Use the restore script to reinsert deleted attendees (see below)
- **Re-running**: Safe to re-run if some duplicates remain (e.g., due to errors)
- **Performance**: Processes duplicates in batches with progress tracking
- **Cleanup**: After deleting duplicates, use the assignments cleanup script to remove orphaned assignments (see below)

## Restore Deleted Attendees

This script restores attendees that were previously deleted by the duplicate deletion script, using the backup file that was created during deletion.

### Run

```bash
npm run restore:deleted-attendees <backup-filename>
```

Or directly:

```bash
npx ts-node -r tsconfig-paths/register scripts/restore-deleted-attendees.ts <backup-filename>
```

### Example

```bash
npm run restore:deleted-attendees attendees-backup-2024-01-15T10-30-00-000Z.json
```

### How It Works

1. **File Selection**: Reads the specified backup JSON file from the `scripts/` directory.

2. **Validation**: Validates the backup file structure and displays metadata about the backup.

3. **Restoration**: 
   - Converts string ObjectIds back to MongoDB ObjectId instances
   - Checks if each attendee already exists (by `_id`) to avoid duplicates
   - Reinserts deleted attendees back into the collection
   - Preserves original `_id` values to restore exactly as they were

4. **Error Handling**: 
   - Skips attendees that already exist in the collection
   - Continues processing even if individual attendees fail to restore
   - Provides detailed error logging

5. **Verification**: Reports total attendees in collection after restoration.

### Safety Features

- **Duplicate Prevention**: Automatically skips attendees that already exist
- **Batch Processing**: Processes attendees in batches for better performance
- **Progress Tracking**: Logs progress every 50 restored attendees
- **Error Resilience**: Individual failures don't stop the entire restoration
- **File Validation**: Validates backup file structure before processing

### Important Notes

- **Backup File Required**: You must specify the exact backup filename
- **Idempotent**: Safe to run multiple times - existing attendees will be skipped
- **Original IDs**: Restores attendees with their original `_id` values
- **No Duplicates**: Won't create duplicates if attendees already exist
- **List Available Files**: If no filename is provided, the script lists all available backup files

## Delete Assignments for Deleted Attendees

This script cleans up assignments that are associated with attendees that were deleted during the duplicate removal process. It reads the backup file, identifies deleted attendees that had assignments (where `assignedTo` or `tempAssignedTo` was not null), and removes their corresponding assignment records.

### Run

```bash
npm run delete:assignments-for-deleted-attendees <backup-filename>
```

Or directly:

```bash
npx ts-node -r tsconfig-paths/register scripts/delete-assignments-for-deleted-attendees.ts <backup-filename>
```

### Example

```bash
npm run delete:assignments-for-deleted-attendees attendees-backup-2024-01-15T10-30-00-000Z.json
```

### How It Works

1. **Backup File Reading**: Reads the specified backup JSON file from the `scripts/` directory.

2. **Filtering**: Identifies deleted attendees where `assignedTo` or `tempAssignedTo` is not null/undefined.

3. **Assignment Lookup**: Uses the attendee `_id` values to find all assignments in the `Assignments` collection where the `attendee` field matches.

4. **Deletion**: Removes all found assignments from the database.

5. **Verification**: Confirms that all assignments have been deleted and creates a detailed report.

6. **Report Generation**: Creates a text file report with details of all deleted assignments.

### Safety Features

- **Backup File Required**: Uses the same backup file from duplicate deletion to ensure consistency
- **Detailed Logging**: Logs all assignments found and deleted
- **Verification**: Confirms deletion was successful
- **Report File**: Creates a detailed report file for audit purposes
- **Error Handling**: Comprehensive error handling with detailed error messages

### Report File Format

The script creates a report file: `assignments-deletion-report-YYYY-MM-DD-HH-MM-SS.txt` containing:
- Summary statistics (total attendees, assignments found, deleted, remaining)
- Detailed information for each deleted assignment (ID, attendee, user, status, etc.)

### Important Notes

- **Backup File Required**: You must specify the exact backup filename used during duplicate deletion
- **Idempotent**: Safe to run multiple times - will only delete assignments that still exist
- **Orphaned Data Cleanup**: This script helps maintain data integrity by removing assignments for attendees that no longer exist
- **List Available Files**: If no filename is provided, the script lists all available backup files

## Delete Duplicate Attendee Associations

This script identifies and removes duplicate attendee associations based on the composite key (`adminId`, `email`, `leadType`) defined in `[backend/src/schemas/attendee-association.schema.ts](../src/schemas/attendee-association.schema.ts)`. For each duplicate group, it keeps the oldest document and deletes the rest, backing up all deleted association documents to a JSON file.

### Run

```bash
npm run delete:duplicate-attendee-associations
```

Or directly:

```bash
npx ts-node -r tsconfig-paths/register scripts/delete-duplicate-attendee-associations.ts
```

### How It Works

1. **Duplicate Detection**: Uses MongoDB aggregation on the attendee associations collection to group by `adminId`, `email`, and `leadType`, and finds groups where the count is greater than 1.

2. **Selection Strategy**: For each duplicate group, sorts the associations by `createdAt` (oldest first). If `createdAt` is missing, falls back to the `_id` ObjectId timestamp. It keeps the oldest association and marks all others for deletion.

3. **Backup Creation**: Before deletion, all duplicate associations (except the one kept) are fetched in full and written to a JSON backup file in the `scripts/` directory with a timestamped filename (e.g., `attendee-associations-backup-2026-01-09T10-00-00-000Z.json`).

4. **Deletion**: Deletes all associations in each duplicate group except the one chosen to keep.

5. **Verification**: After deletion, runs another aggregation to verify that no duplicate groups remain.

### Backup File Format

The backup JSON file contains:

- **Metadata**:
  - `timestamp`: When the backup was created
  - `scriptVersion`: Script version (e.g., `1.0.0`)
  - `totalDuplicateGroups`: Number of duplicate groups processed
  - `totalDeleted`: Number of association documents deleted
  - `totalKept`: Number of association documents kept (one per group)

- **Deleted Associations**: An array of full association documents, with `ObjectId` fields (`_id`, `adminId`, `leadType`) serialized to strings.

### Safety Features

- **Backup First**: All deleted attendee associations are backed up before deletion.
- **Deterministic Selection**: Always keeps the oldest association in each group (by `createdAt` / `_id`).
- **Detailed Logging**: Logs progress every 50 groups and summarizes totals at the end.
- **Verification**: Performs a post-deletion check to ensure no duplicate groups remain.

### Important Notes

- **Run During Low Traffic**: As with other bulk scripts, prefer to run this during off-peak hours to minimize impact on the primary and replication lag.
- **Backup Location**: Backup files are stored in the `scripts/` directory.
- **Idempotent-ish**: After a successful run, there should be no duplicate groups; re-running will typically do nothing (no further duplicates to delete).
- **Restoration**: If needed, you can write a companion restore script similar to `restore-deleted-attendees.ts` to reinsert deleted associations from the backup file.

## Remove Undefined from FullNames

This script removes the literal string "undefined" from `fullNames` arrays in the `AttendeeAssociation` collection. This addresses cases where undefined values were incorrectly converted to the string "undefined" during data processing.

### Run

```bash
npm run remove:undefined-from-fullnames
```

Or directly:

```bash
npx ts-node -r tsconfig-paths/register scripts/remove-undefined-from-fullnames.ts
```

### How It Works

1. **Detection**: Finds all `AttendeeAssociation` documents where the `fullNames` array contains the string "undefined" (case-insensitive).

2. **Cleaning**: For each association found:
   - Filters out all instances of "undefined" from the `fullNames` array
   - Also removes empty strings and null/undefined values
   - Updates the document with the cleaned array

3. **Reporting**: Creates a JSON report file (`fullnames-cleanup-report-YYYY-MM-DD-HH-MM-SS.json`) containing:
   - Metadata (timestamp, script version, statistics)
   - Details of each cleaned association (original and cleaned fullNames arrays)

4. **Verification**: After cleanup, verifies that no associations with "undefined" remain.

### Prevention

The schema now includes a setter that automatically filters out "undefined" strings when `fullNames` is set, preventing future occurrences. The service method `addFullNamesAndPhonesToAssociation` has also been updated to clean fullName values before adding them to the array.

### Safety Features

- **Non-destructive**: Only removes "undefined" strings, preserves all valid names
- **Detailed Logging**: Progress is logged every 100 associations processed
- **Report File**: Creates a detailed report of all changes made
- **Verification**: Confirms cleanup was successful
- **Error Handling**: Individual failures don't stop the entire process

### Important Notes

- **Idempotent**: Safe to run multiple times - will only update associations that still contain "undefined"
- **Report Location**: Report files are stored in the `scripts/` directory
- **Schema Protection**: The schema setter now prevents "undefined" from being added in the future

## Webinar Stats Backfill

Denormalized webinar counters (`totalRegistrations`, `totalParticipants`, `totalAttendees`, `totalUnAttended`) are recomputed from the `attendees` collection and written to each webinar document.

### Run

```bash
npm run migrate:webinar-stats
```

Optional flags:

```bash
npm run migrate:webinar-stats -- --dry-run
npm run migrate:webinar-stats -- --adminId=<mongoAdminId>
```

### Report

After the run completes, a JSON report is written to the `scripts/` directory:

- Filename: `webinar-stats-backfill-report-YYYY-MM-DDTHH-MM-SS-sssZ.json`
- **metadata**: totals (processed, succeeded, failed, mismatches, updated, unchanged, dry-run flag)
- **results**: per-webinar `before` (stored), `computed` (from attendees), `after` (stored after write; `null` in dry-run), `hadMismatchBeforeBackfill`, `wasUpdated`
- **errors**: failed webinars with message and stack

Progress is logged every 50 webinars. If any webinar fails, the script exits with code `1` after writing the report.

### Webinar list Redis cache (runtime)

`POST /webinar/data` (paginated list) can be cached in Redis via `WebinarListCacheService` and shared `CacheService`.

See **[`src/cache/CACHE.md`](../src/cache/CACHE.md)** for the full caching playbook (key naming, invalidation, env vars).

Quick env vars:

- `CACHE_ENABLED` — global default `true`
- `WEBINAR_LIST_CACHE_ENABLED` — default `true`; set `false` to disable list cache only
- `WEBINAR_LIST_CACHE_TTL_SECONDS` — default `120`
- `REDIS_URL` — shared with BullMQ / user cache (see `src/redis/redis.module.ts`)

Cache is invalidated (version bump) on webinar CRUD and attendee stat mutations.

