# Project Rules

## Database & Persistence Constraint
- **CRITICAL:** The Docker volume mapping for the `masterdeploy` container must **ALWAYS** be `-v /data/masterdeploy:/app/data`.
- Never change this path to a named volume (e.g. `masterdeploy-data`) or any other directory in `install.sh`, `remote_installer.py`, or `main.rs`. Changing this path causes database reset and severe data loss for the user. This rule is absolute and locked.
