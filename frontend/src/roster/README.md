# Roster reader

Turns a roster screenshot/photo (or Excel sheet) into one employee's shifts,
then imports them idempotently. Everything here except `device.ts` is plain
TypeScript with no React Native imports, so it runs and is tested in Node.

```
image ─► table.ts        rules → rows/columns → merged cells → per-cell ink, fill, rotation
      ─► imageSource.ts  one cell at a time → on-device OCR (ML Kit / Apple Vision)
xlsx  ─► sheetSource.ts  cells straight from the workbook
      ─► extract.ts      date axis, employee rows, chosen row → one code per date
      ─► dates.ts        deterministic dates (consecutive model, flags misreads)
      ─► codes.ts        codes kept exactly as written; unknown/low-confidence flagged
      ─► session.ts      review-screen state and counts
      ─► importPlan.ts   import key per employee+date; create / unchanged / conflict
```

Rules that keep imports honest:

- OCR never sees more than one cell, so a value cannot drift into another
  column or another employee's row.
- A date column whose header is unreadable or disagrees with its position is
  kept in place and marked `derived`; its cells must be confirmed.
- Blank cells are blank: never imported, never "Off".
- Codes are never renamed or expanded (X stays X). Unknown codes, lower-case
  readings, stray marks and readings that a second, independent OCR pass
  disagrees with are `uncertain` and cannot be imported unchecked.
- Re-importing creates nothing new; a different code on an existing date is
  a keep/replace choice for the user.

## Tests

```
npm test                 # all roster tests
npm run test:fixtures    # regenerate synthetic fixtures (Python + Pillow)
```

`ocr-reference.test.ts` runs the real image path with Tesseract reading the
same single-cell crops the app sends to ML Kit / Vision, and compares against
the manually checked JSON next to each fixture. It is skipped when Tesseract is
not installed. Add real roster screenshots to `test-fixtures/rosters/` with a
hand-checked JSON file to extend it.
