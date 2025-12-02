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

