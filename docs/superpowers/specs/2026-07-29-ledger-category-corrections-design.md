# Ledger Category Corrections

**Date:** 2026-07-29

## Goal

Correct one source transcription and make the public category charts reflect how
the class used its funds. Keep all transaction dates, amounts, types, semesters,
officers, IDs, and timestamps unchanged.

## Settings Change

Add `冷氣` as an active category. Keep the existing categories unchanged so old
and future transactions remain valid.

## Transaction Changes

Apply these corrections to `data/transactions.csv` and `ledger-paste.txt`:

| Transactions | Current | Corrected |
| --- | --- | --- |
| All 15 `冷氣儲值` rows | `其他` | `冷氣` |
| `2025-10-31 拾遺` | `退款` | `其他` |
| `2025-10-31 日本交流飲料費` | `退款` | `活動` |
| `2026-07-23` | `謝師宴 / 活動` | `清潔費 / 清潔用品` |

The `退款` category remains on `班導自費運用餘錢` because that entry records
unused money returned to the fund. `班費加拾遺` remains `班費收入` because the
class-fee portion determines the purpose of that combined entry.

## Save Path

Use the ledger mutation previews and repository save methods used by the TUI.
Save settings before transactions so the new `冷氣` category exists when the
repository validates the reclassified rows. The repository creates its normal
backup before each save.

## Validation

After saving:

- `data/settings.json` contains one active `冷氣` category.
- All 15 `冷氣儲值` rows use `冷氣`.
- `拾遺`, `日本交流飲料費`, and `2026-07-23 清潔費` use the approved categories.
- The text source and ledger agree on all 40 dates, subjects, amounts, and notes.
- Income remains `NT$195,361`, expenses remain `NT$152,685`, and the balance
  remains `NT$42,676`.
