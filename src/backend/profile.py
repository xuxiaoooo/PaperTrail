"""Local time zone used by the hourly scheduler."""
import json
import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class Profile:
    def __init__(self, connect):
        self.connect = connect

    def initialize(self):
        with self.connect() as con:
            con.execute('CREATE TABLE IF NOT EXISTS user_profile (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
            con.execute('INSERT OR IGNORE INTO user_profile VALUES(1,?)', (json.dumps({
                'timezone': os.environ.get('PAPERTRAIL_TIMEZONE', 'Asia/Shanghai')}),))

    def state(self):
        with self.connect() as con:
            saved=json.loads(con.execute('SELECT value FROM user_profile WHERE id=1').fetchone()[0])
            return {'timezone':saved['timezone']}

    def zone(self):
        return ZoneInfo(self.state()['timezone'])

    def save(self, body):
        zone = body.get('timezone')
        try:
            ZoneInfo(zone)
        except (ZoneInfoNotFoundError, TypeError, ValueError):
            raise ValueError('请选择有效时区') from None
        value = {'timezone': zone}
        with self.connect() as con:
            con.execute('UPDATE user_profile SET value=? WHERE id=1', (json.dumps(value, ensure_ascii=False),))
        return {'ok': True, 'message': '时区已保存', 'profile': value}
