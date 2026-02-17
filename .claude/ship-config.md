## CI Settings

ci: skip

## Test Settings

test-command: npm test

## Review Policy

review-mode: strict
- Address ALL issues AND suggestions from every review — even if the verdict is APPROVE
- After addressing, commit + push + re-request review from Maxwell
- Repeat until the review has ZERO issues and ZERO suggestions
- Only then merge

## Deploy

Deploy is handled by GitHub Actions CD on merge to main (not by /ship).
