# Upstream optimization queue

When a scheduled or interactive Codex run is asked to process upstream updates:

1. Run `gh issue list --repo AWelook/Surge-Modules-Optimized --state open --label upstream-update`.
2. If there are no matching issues, report that the optimization queue is empty and stop without changing files.
3. Treat each matching issue as one registered project. Read its `registry.json` entry, upstream snapshot, converted snapshot when present, published module, published scripts, and the upstream-sync commit linked from the issue.
4. If the upstream source is not a Surge module, convert the new source with Script Hub before optimizing and update the unoptimized conversion snapshot under `converted/`.
5. Compare the new upstream version with both the previous upstream commit and the current optimized version. Preserve all existing behavior, parameters, response semantics, and remote-script coverage. Do not optimize solely to make the code shorter.
6. Before editing, record the discovered problems and intended optimizations in the issue. Never include credentials, cookies, tokens, or private machine data.
7. Update only the affected project under `modules/`, `scripts/`, `converted/`, `upstream/`, its registry metadata, and directly related tests or automation.
8. Add behavior tests for every added or changed rule. Run `npm test`, check the final diff, and clearly state any validation that could not be performed, such as live Surge traffic replay.
9. Commit and push only after tests pass. Verify the GitHub Raw module and every referenced Raw script.
10. Add a concise results comment to the issue and close it only after the optimized files are verified on `main`. Leave the issue open when behavior is uncertain, tests fail, or user input is required.
