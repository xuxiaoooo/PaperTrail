from pathlib import Path
import sqlite3
from database import connect as open_database
import tempfile
import threading
import unittest
from datetime import datetime
from refresh_schedule import BEIJING, RefreshSchedule


class RefreshScheduleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / 'schedule.sqlite3'
        self.moment = datetime(2026, 9, 30, 9, 59, tzinfo=BEIJING)
        self.calls = []
        self.lock = threading.Lock()
        self.scheduler = self.create_scheduler()
        self.scheduler.initialize()

    def tearDown(self):
        self.temp.cleanup()

    def connect(self):
        con = open_database(self.db)
        con.row_factory = sqlite3.Row
        return con

    def refresh(self):
        self.assertTrue(self.lock.locked())
        self.calls.append(self.moment)
        return {'ok': True, 'checked': 2, 'updated': 0, 'issues': []}

    def create_scheduler(self):
        return RefreshSchedule(self.connect, self.refresh, self.lock, lambda: self.moment)

    def test_hourly_window_is_persistent_and_executes_once(self):
        self.assertFalse(self.scheduler.tick())
        for hour in range(10, 24):
            self.moment = self.moment.replace(hour=hour, minute=0)
            self.assertTrue(self.scheduler.tick())
            self.assertFalse(self.scheduler.tick())
            self.scheduler = self.create_scheduler()
            self.scheduler.initialize()
            self.assertFalse(self.scheduler.tick())
            state = self.scheduler.state()
            next_time = datetime.fromisoformat(state['next_run_at'])
            self.assertEqual(next_time.hour, hour + 1 if hour < 23 else 0)
            if hour == 23:
                self.assertEqual(next_time.day, 1)
            self.assertEqual(state['last_result']['checked'], 2)
        self.moment = self.moment.replace(day=1, month=10, hour=0)
        self.assertTrue(self.scheduler.tick())
        self.assertEqual(datetime.fromisoformat(self.scheduler.state()['next_run_at']).hour, 8)
        self.assertEqual(len(self.calls), 15)

    def test_sleep_coalesces_missed_times_and_busy_manual_read_defers(self):
        self.moment = self.moment.replace(hour=21, minute=30)
        with self.lock:
            self.assertFalse(self.scheduler.tick())
        self.assertEqual(self.scheduler.state()['next_run_at'], '2026-09-30T10:00:00+08:00')
        self.assertTrue(self.scheduler.tick())
        self.assertFalse(self.scheduler.tick())
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.scheduler.state()['next_run_at'], '2026-09-30T22:00:00+08:00')

    def test_custom_schedule_and_enabled_setting_survive_restart(self):
        self.scheduler.save({'enabled': False, 'times': ['10:00', '15:00', '20:00']})
        self.moment = self.moment.replace(hour=10, minute=0)
        self.scheduler = self.create_scheduler()
        self.scheduler.initialize()
        self.assertFalse(self.scheduler.tick())
        self.scheduler.save({'enabled': True, 'times': ['20:10', '10:10', '15:10']})
        self.moment = self.moment.replace(minute=10)
        self.assertTrue(self.scheduler.tick())
        self.assertEqual(self.scheduler.state()['next_run_at'], '2026-09-30T15:10:00+08:00')
        self.assertEqual(self.scheduler.state()['times'], ['10:10','15:10','20:10'])

    def test_existing_three_slots_remain_custom(self):
        with self.connect() as con:
            con.execute('UPDATE refresh_schedule SET times=?,next_run_at=? WHERE id=1',
                        ('["10:00","15:00","20:00"]', '2026-09-30T15:00:00+08:00'))
        self.scheduler = self.create_scheduler()
        self.scheduler.initialize()
        self.assertEqual(self.scheduler.state()['next_run_at'], '2026-09-30T15:00:00+08:00')
        self.assertEqual(self.scheduler.state()['times'], ['10:00','15:00','20:00'])

    def test_time_validation_rejects_duplicates_and_invalid_values(self):
        for times in ([], ['08:00','08:00'], ['24:00'], ['8:00'], ['12:99'], ['12:00']*49):
            with self.subTest(times=times), self.assertRaises(ValueError):
                self.scheduler.save({'enabled':True,'times':times})

    def test_partial_failure_is_reported_and_next_slot_remains_scheduled(self):
        self.scheduler.refresh = lambda: {'ok': True, 'checked': 1,
            'issues': [{'account_id': 'test', 'message': '需要完成网站验证'}]}
        self.moment = self.moment.replace(hour=10, minute=0)
        self.assertTrue(self.scheduler.tick())
        state = self.scheduler.state()
        self.assertEqual(state['last_error'], '需要完成网站验证')
        self.assertFalse(state['running'])
        self.assertFalse(self.lock.locked())
        self.assertEqual(state['next_run_at'], '2026-09-30T11:00:00+08:00')


if __name__ == '__main__':
    unittest.main()
