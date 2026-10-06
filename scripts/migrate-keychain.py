"""Verify local credentials under the PaperTrail identity without logging secrets."""
import json
import os
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src/backend'))
from platform_runtime import user_data_dir
import credential_store

database = user_data_dir() / 'papertrail.sqlite3'
with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
    rows = connection.execute('''SELECT a.id, j.name FROM accounts a
        JOIN journals j ON j.id=a.journal_id WHERE a.has_password=1''').fetchall()
report = {'accounts': len(rows), 'migrated': 0, 'verified': 0}
for identifier, journal in rows:
    result = credential_store.migrate(identifier, journal)
    report['migrated'] += result == 'migrated'
    if not credential_store.get(identifier):
        raise SystemExit('Credential verification failed; previous application files must be retained.')
    report['verified'] += 1
report['ok'] = report['verified'] == report['accounts']
print(json.dumps(report))
