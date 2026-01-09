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

