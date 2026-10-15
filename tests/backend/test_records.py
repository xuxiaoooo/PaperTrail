import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class RecordsTest(unittest.TestCase):
    def test_mdpi_statuses_follow_publisher_meanings(self):
        normalize = self.app.portal_sync.normalize_status
        self.assertEqual(normalize('Pending review', 'MDPI SuSy'), 'editor')
        self.assertEqual(normalize('Under review', 'MDPI SuSy'), 'review')
        self.assertEqual(normalize('Pending editor decision', 'MDPI SuSy'), 'decision')
        self.assertEqual(normalize('Pending minor revisions', 'MDPI SuSy'), 'revision')
        self.assertEqual(normalize('Author proofreading', 'MDPI SuSy'), 'accepted')

    def test_tray_overview_contains_all_papers_without_account_or_history_details(self):
        account=self.account('private-account-name')
        self.app.manuscript_save(self.paper(account,'QUICK-01',status='review',raw_status='Under Review'))
        self.app.manuscript_save(self.paper(account,'QUICK-02',status='accepted',raw_status='Accepted'))
        with self.app.connect() as con:
            con.execute('INSERT INTO account_sync(account_id,error) VALUES(?,?)',(account,'读取失败'))
        value=self.app.overview()
        self.assertEqual({p['number'] for p in value['manuscripts']},{'QUICK-01','QUICK-02'})
        self.assertEqual(value['issue_count'],1)
        self.assertTrue(all(p['journal_name']=='SCIENCE CHINA Information Sciences' for p in value['manuscripts']))
        self.assertNotIn('private-account-name',json.dumps(value))
        self.assertNotIn('token',value)
        self.assertNotIn('events',value)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'PAPERTRAIL_DATA_DIR': self.temp.name})
        self.env.start()
        spec = importlib.util.spec_from_file_location('papertrail_test_server', Path(__file__).resolve().parents[2] / 'src/backend/server.py')
        self.app = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.app)
        self.app.initialize()
        with self.app.connect() as con:
            con.execute('INSERT OR IGNORE INTO journals VALUES(?,?,?,?,?)', ('scis','SCIENCE CHINA Information Sciences','SCIS','ScholarOne','https://mc03.manuscriptcentral.com/scis'))
        self.reader_pool = patch.object(self.app.portal_sync, 'read_with_browser', side_effect=lambda node,reader,payload,timeout:self.app.portal_sync.subprocess.run([node,str(reader)],input=json.dumps(payload),text=True,capture_output=True,timeout=timeout))
        self.reader_pool_mock = self.reader_pool.start()

    def tearDown(self):
        self.reader_pool.stop()
        self.env.stop()
        self.temp.cleanup()

    def test_embedded_scheduler_calls_full_refresh_and_preserves_real_status(self):
        from datetime import datetime, timedelta
        from refresh_schedule import BEIJING
        account = self.account('scheduled-reader')
        paper = self.app.manuscript_save(self.paper(account, 'AUTO-01', status='submitted'))['id']
        paused = self.app.manuscript_save(self.paper(account, 'AUTO-PAUSED', status='revision'))['id']
        closed_account = self.account('scheduled-skip')
        closed = self.app.manuscript_save(self.paper(closed_account, 'AUTO-CLOSED', status='rejected'))['id']
        moment = datetime.now(BEIJING) + timedelta(seconds=1)
        self.app.SCHEDULE.clock = lambda: moment
        with self.app.connect() as con:
            con.execute('UPDATE refresh_schedule SET next_run_at=? WHERE id=1', (moment.isoformat(),))
        def rows(account, journal, tracked, data_dir):
            return [{'number': p['number'], 'title_en': p['title_en'],
                     'raw_status': {'AUTO-01':'Under Review', 'AUTO-PAUSED':'Awaiting Revision',
                                    'AUTO-CLOSED':'Rejected'}[p['number']],
                     'submitted_at': '2026-09-01', 'status_date': ''} for p in tracked]
        with patch.object(self.app.portal_sync, 'read_account', side_effect=rows) as reader:
            self.assertTrue(self.app.SCHEDULE.tick())
            self.assertEqual(reader.call_count, 2)
            self.assertEqual({p['id'] for call in reader.call_args_list for p in call.args[2]},
                             {paper, paused, closed})
        state = self.app.state()
        observed = next(p for p in state['manuscripts'] if p['id'] == paper)
        self.assertEqual(observed['status'], 'review')
        self.assertEqual(observed['system_submitted_at'], '2026-09-01')
        self.assertEqual(observed['source'], 'website')
        self.assertEqual(state['auto_refresh']['last_result']['checked'], 3)
        self.assertFalse(state['sync_in_progress'])
        self.assertTrue(state['last_checked_at'])
        self.assertTrue(all(p['last_success'] for p in state['manuscripts'] if p['id'] in (paused, closed)))

    def test_wiley_routes_password_account_to_chromium_reader(self):
        from types import SimpleNamespace
        with patch.object(self.app,'save_password',return_value=True):
            identifier=self.app.account_save(dict(username='reader@example.test',password='synthetic-secret',
                login_method='password',journal_name='Example Wiley Journal',
                abbreviation='EWJ',platform='自动识别',login_url='https://authors.wiley.com/journal/EXAMPLE'))['id']
        state=self.app.state()
        account=next(a for a in state['accounts'] if a['id']==identifier)
        journal=next(j for j in state['journals'] if j['id']==account['journal_id'])
        self.assertTrue(account['auto_read_supported'])
        module=self.app.DATA/'browser-runtime/node_modules/playwright-core/index.mjs'
        module.parent.mkdir(parents=True)
        module.touch()
        outcomes=[SimpleNamespace(stdout='{"ok":true,"rows":[]}',returncode=0)]
        with patch.object(self.app.portal_sync.credential_store,'get',return_value='synthetic-secret') as credential, patch.object(self.app.portal_sync.subprocess,'run',side_effect=outcomes) as run:
            self.app.portal_sync.read_account(account,journal,[],self.app.DATA)
            payload=json.loads(run.call_args.kwargs['input'])
            self.assertEqual(payload['username'],'reader@example.test')
            self.assertEqual(payload['browser_engine'],'chromium')
            self.assertTrue(payload['profile_dir'].endswith(identifier))
            self.assertFalse(payload['interactive'])
            self.assertEqual(Path(run.call_args.args[0][1]).name,'wiley_reader.mjs')
            self.assertNotIn('browser_endpoint',payload)
        self.reader_pool_mock.assert_called_once()
        with patch.object(self.app.portal_sync.credential_store,'get',return_value='synthetic-secret') as credential, patch.object(self.app.portal_sync.subprocess,'run',side_effect=outcomes):
            self.app.portal_sync.read_account(account,journal,[],self.app.DATA,interactive=True)
        self.reader_pool_mock.assert_called_once()
        with patch.object(self.app.portal_sync.credential_store,'get',return_value='synthetic-secret'), \
                patch.object(self.app.portal_sync.subprocess,'run',return_value=SimpleNamespace(
                    stdout='{"ok":false,"code":"site_unavailable"}',returncode=1)):
            with self.assertRaisesRegex(self.app.portal_sync.PortalError,'投稿网站暂时无法连接'):
                self.app.portal_sync.read_account(account,journal,[],self.app.DATA)
        self.assertEqual(self.app.portal_sync.submission_date('August 14, 2026'),'2026-08-14')

    def orcid_account(self):
        return self.app.account_save(dict(username='test-orcid-account',login_method='orcid',
            journal_name='Control Engineering Practice',abbreviation='CEP',platform='Editorial Manager',
            login_url='https://www.editorialmanager.com/conengprac/'))['id']

    def test_platform_routes_are_independent_of_specific_journal_names(self):
        from types import SimpleNamespace
        cases = [
            ('https://www.editorialmanager.com/example/', 'password', 'Editorial Manager', 'editorial_manager_reader.mjs'),
            ('https://www.editorialmanager.com/example/default.aspx', 'orcid', 'Editorial Manager', 'cep_reader.mjs'),
            ('https://www.editorialmanager.com/another', 'elsevier', 'Editorial Manager', 'elsevier_reader.mjs'),
            ('https://submission.wiley.com/journal/EXAMPLE', 'password', 'Wiley Research Exchange', 'wiley_reader.mjs'),
            ('https://ieee.submission.researchexchange.com/submission/dashboard', 'password', 'IEEE Research Exchange', 'research_exchange_reader.mjs'),
            ('https://susy.mdpi.com/user/manuscripts/status', 'password', 'MDPI SuSy', 'mdpi_reader.mjs')
        ]
        for index, (url, method, platform, reader) in enumerate(cases):
            with self.subTest(url=url, method=method), patch.object(self.app, 'save_password', return_value=True):
                identifier = self.app.account_save(dict(username='test-user-'+str(index), password='synthetic-secret',
                    journal_name='User supplied journal '+str(index), abbreviation='EXAMPLE', platform='其他',
                    login_url=url, login_method=method))['id']
                state = self.app.state()
                account = next(a for a in state['accounts'] if a['id'] == identifier)
                journal = next(j for j in state['journals'] if j['id'] == account['journal_id'])
                self.assertEqual(journal['platform'], platform)
                self.assertTrue(account['auto_read_supported'])
                with patch.object(self.app.portal_sync.credential_store, 'get', return_value='synthetic-secret'), \
                        patch.object(self.app.portal_sync.subprocess, 'run', return_value=SimpleNamespace(
                            stdout='{"ok":true,"rows":[]}', returncode=0)) as run:
                    self.app.portal_sync.read_account(account, journal, [], self.app.DATA)
                    self.assertEqual(Path(run.call_args.args[0][1]).name, reader)
                    payload = json.loads(run.call_args.kwargs['input'])
                    self.assertEqual(payload['login_method'], method)
                    self.assertEqual(payload['login_url'], url.rstrip('/'))
        self.assertFalse(self.app.portal_sync.supported('https://example.com/login', 'password'))
        self.assertFalse(self.app.portal_sync.supported('https://css.paperplaza.net/journals/tac/scripts/login.pl', 'password'))
        self.assertFalse(self.app.portal_sync.supported('https://mc.manuscriptcentral.com/example', 'elsevier'))

    def test_retired_platform_entries_are_rejected(self):
        for url in ('https://ojs.example.test/index.php/journal/login',
                    'https://css.paperplaza.net/journals/tac/scripts/login.pl'):
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, 'ScholarOne、Editorial Manager、Wiley、IEEE 或 MDPI'):
                self.app.account_save(dict(username='old-platform', password='synthetic-secret',
                    journal_name='Old platform journal', platform='自动识别', login_url=url))

    def test_legacy_ieee_entry_is_reclassified_and_old_unsupported_error_clears(self):
        account = self.account('ieee-legacy')
        paper = self.app.manuscript_save(self.paper(account, 'JBHI-001'))['id']
        with self.app.connect() as con:
            con.execute('UPDATE journals SET login_url=? WHERE id=?',
                ('https://ieee.submission.researchexchange.com/submission/dashboard','scis'))
            con.execute('INSERT INTO account_sync(account_id,error) VALUES(?,?)',
                (account,'这个期刊的自动读取尚未接入'))
        self.app.initialize()
        state = self.app.state()
        self.assertEqual(state['journals'][0]['platform'],'IEEE Research Exchange')
        self.assertTrue(state['accounts'][0]['auto_read_supported'])
        self.assertEqual(state['accounts'][0]['sync_error'],'')
        self.assertEqual(state['manuscripts'][0]['id'],paper)

    def test_journal_entry_can_be_corrected_without_replacing_account_or_paper(self):
        account = self.account('correct-entry')
        paper = self.app.manuscript_save(self.paper(account,'JBHI-001'))['id']
        entry='https://ieee.submission.researchexchange.com/submission/dashboard'
        self.app.journal_save({'name':'IEEE Example Journal','login_url':entry},'scis')
        state=self.app.state()
        self.assertEqual(state['journals'][0]['login_url'],entry)
        self.assertEqual(state['journals'][0]['platform'],'IEEE Research Exchange')
        self.assertEqual(state['accounts'][0]['id'],account)
        self.assertEqual(state['manuscripts'][0]['id'],paper)
        with self.assertRaisesRegex(ValueError,'投稿网址未识别'):
            self.app.journal_save({'name':'IEEE Example Journal','login_url':'https://example.test/login'},'scis')
        self.assertEqual(self.app.state()['journals'][0]['login_url'],entry)

    def test_elsevier_account_uses_credential_store_and_separate_session(self):
        from types import SimpleNamespace
        with patch.object(self.app,'save_password',return_value=True):
            identifier=self.app.account_save(dict(username='elsevier-test@example.test',password='synthetic-secret',
                login_method='elsevier',journal_name='Aerospace Science and Technology',abbreviation='AST',
                platform='Editorial Manager',login_url='https://www.editorialmanager.com/aescte/'))['id']
        state=self.app.state()
        account=next(a for a in state['accounts'] if a['id']==identifier)
        self.assertEqual(account['login_method'],'elsevier')
        self.assertTrue(account['auto_read_supported'])
        self.assertTrue(account['has_password'])
        self.assertNotIn('synthetic-secret',json.dumps(state))
        self.assertNotIn(b'synthetic-secret',self.app.DB.read_bytes())
        module=self.app.DATA/'browser-runtime/node_modules/playwright-core/index.mjs'
        module.parent.mkdir(parents=True)
        module.touch()
        outcomes=[SimpleNamespace(stdout='{"ok":true,"rows":[]}',returncode=0)]
        with patch.object(self.app.portal_sync.credential_store,'get',return_value='synthetic-secret') as credential, patch.object(self.app.portal_sync.subprocess,'run',side_effect=outcomes) as run:
            self.app.connect_account({'account_id':identifier})
            credential.assert_called_once_with(identifier)
            payload=json.loads(run.call_args.kwargs['input'])
            self.assertEqual(payload['login_method'],'elsevier')
            self.assertEqual(payload['password'],'synthetic-secret')
            self.assertTrue(payload['profile_dir'].endswith(identifier+'-elsevier-firefox'))
            self.assertFalse(payload['interactive'])
            self.assertEqual(Path(run.call_args.args[0][1]).name,'elsevier_reader.mjs')
        account=next(a for a in self.app.state()['accounts'] if a['id']==identifier)
        self.assertTrue(account['last_authenticated_at'])
        self.assertIsNone(account['last_checked_at'])
        first_generation=account['session_generation']
        self.app.account_save(dict(username='different-elsevier@example.test'),identifier)
        changed=next(a for a in self.app.state()['accounts'] if a['id']==identifier)
        self.assertNotEqual(changed['session_generation'],first_generation)
        self.assertFalse(changed['has_password'])
        self.assertIsNone(changed['last_authenticated_at'])

    def test_elsevier_requires_editorial_manager_entry_and_preserves_unsynced_paper(self):
        with self.assertRaisesRegex(ValueError,'Editorial Manager'):
            self.app.account_save(dict(journal_id='scis',username='elsevier-test@example.test',login_method='elsevier'))
        account=self.app.account_save(dict(username='elsevier-test@example.test',login_method='elsevier',
            journal_name='Aerospace Science and Technology',abbreviation='AST',platform='Editorial Manager',
            login_url='https://www.editorialmanager.com/aescte'))['id']
        paper=self.app.manuscript_save(self.paper(account,'',title_en='AST Test Paper',status='review'))['id']
        before=self.app.state()['manuscripts']
        with patch.object(self.app.portal_sync,'read_account',side_effect=self.app.portal_sync.PortalError('请先保存 Elsevier 密码')):
            self.assertEqual(self.app.refresh({'manuscript_id':paper})['checked'],0)
        self.assertEqual(self.app.state()['manuscripts'],before)

    def test_new_scholarone_journal_is_recognized_and_uses_its_own_firefox_session(self):
        from types import SimpleNamespace
        with patch.object(self.app,'save_password',return_value=True):
            identifier=self.app.account_save(dict(username='future-journal-account',password='synthetic-secret',
                journal_name='Future Test Journal',abbreviation='FTJ',platform='ScholarOne',
                login_url='https://mc12.manuscriptcentral.com/future-journal'))['id']
        state=self.app.state()
        account=next(a for a in state['accounts'] if a['id']==identifier)
        journal=next(j for j in state['journals'] if j['id']==account['journal_id'])
        self.assertTrue(account['auto_read_supported'])
        module=self.app.DATA/'browser-runtime/node_modules/playwright-core/index.mjs'
        module.parent.mkdir(parents=True)
        module.touch()
        outcomes=[SimpleNamespace(stdout='{"ok":true,"rows":[]}',returncode=0)]
        with patch.object(self.app.portal_sync.credential_store,'get',return_value='synthetic-secret') as credential, patch.object(self.app.portal_sync.subprocess,'run',side_effect=outcomes) as run:
            self.app.portal_sync.read_account(account,journal,[],self.app.DATA)
            credential.assert_called_once_with(identifier)
            payload=json.loads(run.call_args.kwargs['input'])
            self.assertEqual(payload['browser_engine'],'firefox')
            self.assertFalse(payload['interactive'])
            self.assertTrue(payload['profile_dir'].endswith(identifier+'-firefox'))
            self.assertEqual(Path(run.call_args.args[0][1]).name,'scis_reader.mjs')
        for url in ('https://mc.manuscriptcentral.com/taes','https://mc03.manuscriptcentral.com/scis/'):
            self.assertTrue(self.app.portal_sync.is_scholarone(url))
        for url in ('https://example.com/taes','https://mc.manuscriptcentral.com','http://mc.manuscriptcentral.com/taes'):
            self.assertFalse(self.app.portal_sync.is_scholarone(url))

    def test_orcid_account_connects_before_manuscript_without_password(self):
        account=self.orcid_account()
        before=self.app.state()['accounts'][0]
        self.assertEqual(before['login_method'],'orcid')
        self.assertFalse(before['has_password'])
        self.assertIsNone(before['last_authenticated_at'])
        with patch.object(self.app.portal_sync,'read_account',return_value=[]) as reader:
            self.app.connect_account({'account_id':account,'interactive':True})
            self.assertEqual(reader.call_args.args[0]['id'],account)
            self.assertEqual(reader.call_args.args[2],[])
            self.assertEqual(reader.call_args.kwargs,dict(interactive=True,connect_only=True))
        after=self.app.state()
        self.assertTrue(after['accounts'][0]['last_authenticated_at'])
        self.assertIsNone(after['accounts'][0]['last_checked_at'])
        self.assertEqual(after['manuscripts'],[])
        secret='synthetic-orcid-password'
        with patch.object(self.app,'save_password',return_value=True) as password_store:
            self.app.account_save(dict(username='test-orcid-account',password=secret),account)
            self.assertEqual(password_store.call_args.args[:2],(account,secret))
        data=self.app.state()
        self.assertTrue(data['accounts'][0]['has_password'])
        self.assertNotIn(secret,json.dumps(data))
        self.assertNotIn(secret.encode(),self.app.DB.read_bytes())
        with patch.object(self.app.portal_sync,'read_account',return_value=[]) as reader:
            self.app.connect_account({'account_id':account})
            self.assertFalse(reader.call_args.kwargs['interactive'])

    def test_em_successful_verification_clears_previous_login_error_without_papers(self):
        account = self.app.account_save(dict(username='fixture-em-author',
            journal_name='Fixture EM Journal', login_method='password', platform='自动识别',
            login_url='https://www.editorialmanager.com/fixture/default2.aspx'))['id']
        message = '期刊登录未完成，请核对账号密码，或点击“打开验证窗口”处理网站验证'
        with patch.object(self.app.portal_sync, 'read_account', side_effect=self.app.portal_sync.PortalError(message)):
            with self.assertRaisesRegex(ValueError, '登录未完成'):
                self.app.connect_account({'account_id':account, 'interactive':True})
        before = next(a for a in self.app.state()['accounts'] if a['id']==account)
        self.assertEqual(before['sync_error'], message)
        self.assertIsNone(before['last_authenticated_at'])
        with patch.object(self.app.portal_sync, 'read_account', return_value=[]) as reader:
            self.app.connect_account({'account_id':account, 'interactive':True})
            self.assertTrue(reader.call_args.kwargs['connect_only'])
        after = next(a for a in self.app.state()['accounts'] if a['id']==account)
        self.assertEqual(after['sync_error'], '')
        self.assertTrue(after['last_authenticated_at'])
        self.assertIsNone(after['last_checked_at'])

    def test_cep_revision_keeps_deadline_and_uses_initial_submission(self):
        account=self.orcid_account()
        body=self.paper(account,'CONENGPRAC-TEST-1',
            title_en='CEP Test Paper',status='revision',raw_status='Revision Requested',
            due_date='2026-10-26',status_date='2026-09-26')
        identifier=self.app.manuscript_save(body)['id']
        # Pending revisions are checked hourly while the local deadline remains available.
        revision_row=[dict(number='CONENGPRAC-TEST-1',title_en='CEP Test Paper',
                           raw_status='Revision Requested',submitted_at='Aug 9 2026 3:27AM')]
        with patch.object(self.app.portal_sync,'read_account',return_value=revision_row) as reader:
            self.assertEqual(self.app.refresh({'manuscript_id':identifier})['checked'],1)
            reader.assert_called_once()
        self.assertEqual(self.app.state()['manuscripts'][0]['due_date'],'2026-10-26')
        body.update(status='review',raw_status='Under Review')
        self.app.manuscript_save(body,identifier)
        rows=[dict(number='CONENGPRAC-TEST-1R1',title_en='CEP Test Paper',raw_status='Under Review',
                   submitted_at='Aug 9 2026 3:27AM',status_date='Sep 30 2026 5:08PM')]
        with patch.object(self.app.portal_sync,'read_account',return_value=rows):
            self.assertEqual(self.app.refresh({'manuscript_id':identifier})['checked'],1)
        paper=self.app.state()['manuscripts'][0]
        self.assertEqual(paper['due_date'],'2026-10-26')
        self.assertEqual(paper['system_submitted_at'],'2026-08-09')
        self.assertEqual(paper['status'],'review')
        self.assertEqual(paper['number'],'CONENGPRAC-TEST-1R1')

    def test_orcid_reader_uses_separate_session_and_no_keychain(self):
        from types import SimpleNamespace
        account=self.orcid_account()
        state=self.app.state()
        module=self.app.DATA/'browser-runtime/node_modules/playwright-core/index.mjs'
        module.parent.mkdir(parents=True)
        module.touch()
        with patch.object(self.app.portal_sync.subprocess,'run',return_value=SimpleNamespace(stdout='{"ok":true,"rows":[]}',returncode=0)) as run:
            self.app.portal_sync.read_account(state['accounts'][0],state['journals'][-1],[],self.app.DATA,interactive=True,connect_only=True)
            run.assert_called_once()
            payload=json.loads(run.call_args.kwargs['input'])
            self.assertEqual(payload['password'],'')
            self.assertIn(account+'-orcid-firefox',payload['profile_dir'])
            self.assertEqual(Path(run.call_args.args[0][1]).name,'cep_reader.mjs')
            self.assertTrue(payload['connect_only'])

    def test_orcid_password_is_loaded_by_selected_account_for_background_login(self):
        from types import SimpleNamespace
        account=self.orcid_account()
        with patch.object(self.app,'save_password',return_value=True):
            self.app.account_save(dict(username='test-orcid-account',password='synthetic-secret'),account)
        module=self.app.DATA/'browser-runtime/node_modules/playwright-core/index.mjs'
        module.parent.mkdir(parents=True)
        module.touch()
        outcomes=[SimpleNamespace(stdout='{"ok":true,"rows":[]}',returncode=0)]
        with patch.object(self.app.portal_sync.credential_store,'get',return_value='synthetic-secret') as credential, patch.object(self.app.portal_sync.subprocess,'run',side_effect=outcomes) as run:
            self.app.connect_account({'account_id':account})
            self.assertEqual(run.call_count,1)
            credential.assert_called_once_with(account)
            reader=json.loads(run.call_args.kwargs['input'])
            self.assertEqual(reader['password'],'synthetic-secret')
            self.assertEqual(reader['username'],'test-orcid-account')
            self.assertFalse(reader['interactive'])
            self.assertIn(account+'-orcid-firefox',reader['profile_dir'])
        # Changing the ORCID identity without a replacement password must not reuse the old credential.
        self.app.account_save(dict(username='different-orcid-account'),account)
        updated=next(a for a in self.app.state()['accounts'] if a['id']==account)
        self.assertFalse(updated['has_password'])
        self.assertIsNone(updated['last_authenticated_at'])
        with patch.object(self.app.portal_sync,'read_account',side_effect=self.app.portal_sync.PortalError('ORCID 需要人工验证')):
            with self.assertRaisesRegex(ValueError,'人工验证'):
                self.app.connect_account({'account_id':account})
        self.assertIn('人工验证',self.app.state()['accounts'][0]['sync_error'])

    def test_multiple_orcid_accounts_and_changed_identity_keep_sessions_separate(self):
        from types import SimpleNamespace
        first=self.orcid_account()
        first_account=next(a for a in self.app.state()['accounts'] if a['id']==first)
        second=self.app.account_save(dict(journal_id=first_account['journal_id'],
            username='second-test-orcid',login_method='orcid'))['id']
        module=self.app.DATA/'browser-runtime/node_modules/playwright-core/index.mjs'
        module.parent.mkdir(parents=True)
        module.touch()
        paths=[]
        with patch.object(self.app.portal_sync.subprocess,'run',return_value=SimpleNamespace(stdout='{"ok":true,"rows":[]}',returncode=0)) as run:
            self.app.connect_account({'account_id':first})
            paths.append(json.loads(run.call_args.kwargs['input'])['profile_dir'])
            self.app.connect_account({'account_id':second})
            paths.append(json.loads(run.call_args.kwargs['input'])['profile_dir'])
            self.assertNotEqual(paths[0],paths[1])
            self.app.account_save(dict(username='replacement-test-orcid'),first)
            accounts={a['id']:a for a in self.app.state()['accounts']}
            self.assertIsNone(accounts[first]['last_authenticated_at'])
            self.assertTrue(accounts[second]['last_authenticated_at'])
            self.app.connect_account({'account_id':first})
            new_path=json.loads(run.call_args.kwargs['input'])['profile_dir']
            self.assertNotIn(new_path,paths)

    def account(self, username):
        return self.app.account_save({'journal_id':'scis','username':username,'label':username})['id']

    def paper(self, account, number, **changes):
        body = dict(account_id=account, number=number,title='测试稿件',status='submitted',round='初投')
        body.update(changes)
        return body

    def test_multiple_accounts_and_papers_do_not_collide(self):
        a,b=self.account('test-author-a'),self.account('test-author-b')
        self.app.manuscript_save(self.paper(a,'TEST-01'))
        self.app.manuscript_save(self.paper(a,'TEST-02'))
        self.app.manuscript_save(self.paper(b,'TEST-01'))
        data=self.app.state()
        self.assertEqual(len(data['journals']),1)
        self.assertEqual(len(data['accounts']),2)
        self.assertEqual(len(data['manuscripts']),3)
        self.assertEqual(sum(p['account_id']==a for p in data['manuscripts']),2)
        self.assertEqual(sum(p['account_id']==b for p in data['manuscripts']),1)
        with self.assertRaises(ValueError):
            self.app.manuscript_save(self.paper(a,'TEST-01'))

    def test_duplicate_account_cannot_replace_credentials(self):
        self.account('test-author-a')
        with patch.object(self.app, 'save_password') as store:
            with self.assertRaises(ValueError):
                self.account('test-author-a')
            store.assert_not_called()

    def test_history_changes_only_with_status(self):
        account=self.account('test-author-a')
        body=self.paper(account,'TEST-01')
        identifier=self.app.manuscript_save(body)['id']
        self.app.manuscript_save(dict(body,notes='新增备注'),identifier)
        self.assertEqual(len(self.app.state()['events']),1)
        self.app.manuscript_save(dict(body,status='review',raw_status='Under Review'),identifier)
        data=self.app.state()
        self.assertEqual(len(data['events']),2)
        self.assertEqual(data['events'][-1]['old_status'],'submitted')
        self.assertIsNone(data['manuscripts'][0]['last_success'])

    def test_password_is_not_in_records_or_state(self):
        password='synthetic-credential-for-unit-test'
        with patch.object(self.app,'save_password',return_value=True) as store:
            self.app.account_save({'journal_id':'scis','username':'test-author-a','label':'测试账号','password':password})
            self.assertEqual(store.call_count,1)
        data=self.app.state()
        self.assertTrue(data['accounts'][0]['has_password'])
        self.assertNotIn(password,json.dumps(data))
        self.assertNotIn(password.encode(),self.app.DB.read_bytes())

    def test_invalid_date_leaves_record_unchanged(self):
        account=self.account('test-author-a')
        with self.assertRaises(ValueError):
            self.app.manuscript_save(self.paper(account,'TEST-01',due_date='2026-02-30'))
        self.assertEqual(self.app.state()['manuscripts'],[])

    def test_bilingual_titles_and_authors_are_per_manuscript(self):
        account=self.app.account_save({'journal_id':'scis','username':'shared-account'})['id']
        first=self.app.manuscript_save(self.paper(account,'',title_en='Cooperative Control',title_zh='协同控制',first_author='李佳航',corresponding_author='王卓'))['id']
        second=self.app.manuscript_save(self.paper(account,'',title_en='State Estimation',title_zh='状态估计',first_author='示例作者甲',corresponding_author='李佳航'))['id']
        papers={p['id']:p for p in self.app.state()['manuscripts']}
        self.assertIsNone(papers[first]['number'])
        self.assertIsNone(papers[second]['number'])
        self.assertEqual(papers[first]['title_en'],'Cooperative Control')
        self.assertEqual(papers[first]['title_zh'],'协同控制')
        self.assertEqual(papers[first]['corresponding_author'],'王卓')
        self.assertEqual(papers[second]['corresponding_author'],'李佳航')
        self.assertEqual(papers[first]['first_author'],'李佳航')
        self.assertEqual(papers[second]['first_author'],'示例作者甲')
        self.app.manuscript_save(self.paper(account,'SCIS-001',title_en='Cooperative Control',title_zh='协同控制',corresponding_author='王卓'),first)
        self.assertEqual(len(self.app.state()['manuscripts']),2)
        self.assertEqual(self.app.state()['manuscripts'][0]['first_author'],'李佳航')
        self.app.manuscript_save(self.paper(account,'SCIS-001',first_author='Jiahang Li'),first)
        self.assertEqual(self.app.state()['manuscripts'][0]['first_author'],'Jiahang Li')
        self.assertIsNone(self.app.state()['last_checked_at'])

    def test_system_submission_date_is_separate_from_manual_dates(self):
        account=self.account('date-test-account')
        body=self.paper(account,'DATE-01',submitted_at='2026-08-01')
        identifier=self.app.manuscript_save(body)['id']
        self.assertEqual(self.app.state()['manuscripts'][0]['system_submitted_at'],'')
        with self.app.connect() as con:
            con.execute('UPDATE manuscripts SET system_submitted_at=? WHERE id=?',('2026-08-03',identifier))
        self.app.manuscript_save(self.paper(account,'DATE-01',notes='更新备注'),identifier)
        paper=self.app.state()['manuscripts'][0]
        self.assertEqual(paper['system_submitted_at'],'2026-08-03')
        self.assertEqual(paper['submitted_at'],'2026-08-01')

    def test_shared_account_only_matches_explicitly_added_titles(self):
        account=self.account('shared-account')
        identifier=self.app.manuscript_save(self.paper(account,'',title_en='Cooperative Control',title_zh='协同控制'))['id']
        portal=[{'number':'OTHER-1','title':'A Different Control Paper'},
                {'number':'MINE-1','title':'  COOPERATIVE   CONTROL  '},
                {'number':'OTHER-2','title':'Cooperative Control for Other Systems'}]
        result=self.app.tracked_matches(account,portal)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['manuscript_id'],identifier)
        self.assertEqual(result[0]['match']['number'],'MINE-1')
        self.assertEqual(len(self.app.state()['manuscripts']),1)
        ambiguous=self.app.tracked_matches(account,portal+[{'number':'OTHER-3','title':'Cooperative Control'}])
        self.assertEqual(ambiguous[0]['status'],'ambiguous')
        self.assertIsNone(ambiguous[0]['match'])

    def test_legacy_records_migrate_with_history(self):
        account=self.account('legacy-account')
        identifier=self.app.manuscript_save(self.paper(account,'LEGACY-01'))['id']
        with self.app.connect() as con:
            con.execute('PRAGMA foreign_keys=OFF')
            con.execute('''CREATE TABLE manuscripts_old (
                id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),
                title TEXT NOT NULL,number TEXT NOT NULL,status TEXT NOT NULL,
                raw_status TEXT NOT NULL,submitted_at TEXT NOT NULL,status_date TEXT NOT NULL,
                due_date TEXT NOT NULL,round TEXT NOT NULL,notes TEXT NOT NULL,
                recorded_at TEXT NOT NULL,last_success TEXT,source TEXT NOT NULL DEFAULT 'manual',
                UNIQUE(account_id,number))''')
            con.execute('''INSERT INTO manuscripts_old SELECT id,account_id,title,number,status,
                raw_status,submitted_at,status_date,due_date,round,notes,recorded_at,last_success,source
                FROM manuscripts''')
            con.execute('DROP TABLE manuscripts')
            con.execute('ALTER TABLE manuscripts_old RENAME TO manuscripts')
        self.app.initialize()
        with self.app.connect() as con:
            con.execute('INSERT OR IGNORE INTO journals VALUES(?,?,?,?,?)', ('scis','SCIENCE CHINA Information Sciences','SCIS','ScholarOne','https://mc03.manuscriptcentral.com/scis'))
        data=self.app.state()
        self.assertEqual(data['manuscripts'][0]['id'],identifier)
        self.assertEqual(data['manuscripts'][0]['title_zh'],'测试稿件')
        self.assertEqual(data['manuscripts'][0]['title_en'],'')
        self.assertEqual(data['manuscripts'][0]['corresponding_author'],'')
        self.assertEqual(data['manuscripts'][0]['first_author'],'')
        self.assertEqual(data['events'][0]['manuscript_id'],identifier)
        with self.app.connect() as con:
            self.assertEqual(con.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_refresh_binds_only_tracked_paper_and_keeps_personal_fields(self):
        account=self.account('sync-test')
        identifier=self.app.manuscript_save(self.paper(account,'',title_en='Cooperative Control',
            title_zh='协同控制',first_author='李佳航',corresponding_author='王卓',notes='保留备注'))['id']
        portal=[dict(number='TEST-SYNC-1',title_en='Cooperative Control',raw_status='Under Review',submitted_at='09-Sep-2026'),
                dict(number='TEST-OTHER-2',title_en='Another Paper',raw_status='Accepted',submitted_at='01-Sep-2026')]
        with patch.object(self.app.portal_sync,'read_account',return_value=portal):
            result=self.app.refresh({'manuscript_id':identifier})
            self.assertEqual(result['checked'],1)
            data=self.app.state()
            self.assertEqual(len(data['manuscripts']),1)
            paper=data['manuscripts'][0]
            for key,value in dict(number='TEST-SYNC-1',status='review',raw_status='Under Review',
                system_submitted_at='2026-09-09',first_author='李佳航',corresponding_author='王卓',
                title_zh='协同控制',notes='保留备注',source='website').items():
                self.assertEqual(paper[key],value)
            self.assertTrue(data['last_checked_at'])
            self.assertEqual(data['events'][-1]['source'],'website')
            self.assertEqual(self.app.refresh({})['updated'],0)
            self.assertEqual(len(self.app.state()['events']),2)
        previous=self.app.state()
        with patch.object(self.app.portal_sync,'read_account',side_effect=self.app.portal_sync.PortalError('测试读取失败')):
            result=self.app.refresh({})
        after=self.app.state()
        self.assertEqual(result['checked'],0)
        self.assertEqual(after['manuscripts'],previous['manuscripts'])
        self.assertEqual(after['last_checked_at'],previous['last_checked_at'])
        self.assertEqual(after['accounts'][0]['sync_error'],'测试读取失败')

    def test_partial_refresh_does_not_claim_all_papers_checked(self):
        a,b=self.account('sync-a'),self.account('sync-b')
        self.app.manuscript_save(self.paper(a,'',title_en='Paper A'))
        self.app.manuscript_save(self.paper(b,'',title_en='Paper B'))
        def read(account,*args):
            if account['id']==a: raise self.app.portal_sync.PortalError('测试账号不可用')
            return [dict(number='TEST-B',title_en='Paper B',raw_status='Under Review',submitted_at='09-Sep-2026')]
        with patch.object(self.app.portal_sync,'read_account',side_effect=read):
            result=self.app.refresh({})
        self.assertEqual(result['checked'],1)
        self.assertIsNone(self.app.state()['last_checked_at'])
        self.assertTrue(next(a for a in self.app.state()['accounts'] if a['id']==b)['last_checked_at'])

    def test_all_journals_refresh_together_and_keep_account_results_separate(self):
        import threading
        accounts = [self.app.account_save(dict(username='parallel-' + str(i),
            journal_name='Parallel test journal ' + str(i), abbreviation='PAR-' + str(i),
            platform='ScholarOne', login_url='https://mc.manuscriptcentral.com/parallel-' + str(i)))['id']
            for i in range(5)]
        with self.app.connect() as con:
            shared_journal = con.execute('SELECT journal_id FROM accounts WHERE id=?', (accounts[1],)).fetchone()[0]
        accounts.append(self.app.account_save(dict(journal_id=shared_journal, username='parallel-shared'))['id'])
        expected = {}
        for i, account in enumerate(accounts):
            expected[account] = [self.app.manuscript_save(self.paper(account, f'PAR-{i}-{j}',
                title_en=f'Parallel {i} {j}', status='review'))['id'] for j in range(2 if i == 2 else 1)]
        guard = threading.Lock()
        active, peak, seen, journal_active = 0, 0, [], {}
        def read(account, journal, tracked, data):
            nonlocal active, peak
            with guard:
                active += 1
                peak = max(peak, active)
                seen.append(account['id'])
                journal_active[journal['id']] = journal_active.get(journal['id'], 0) + 1
                self.assertEqual(journal_active[journal['id']], 1, 'Same journal accounts log in sequentially')
            try:
                self.assertEqual([p['id'] for p in tracked], expected[account['id']])
                if account['id'] == accounts[0]:
                    raise self.app.portal_sync.PortalError('单个账号读取失败')
                return [dict(number=p['number'], title_en=p['title_en'], raw_status='Under Review',
                             submitted_at='2026-09-01') for p in tracked]
            finally:
                with guard:
                    active -= 1
                    journal_active[journal['id']] -= 1
        with patch.object(self.app.portal_sync, 'read_account', side_effect=read):
            result = self.app.refresh({})
        self.assertEqual(peak, 1)
        self.assertCountEqual(seen, accounts)
        self.assertEqual(result['checked'], 6)
        self.assertEqual(result['issues'], [{'account_id': accounts[0], 'message': '单个账号读取失败'}])
        self.assertGreaterEqual(result['duration_seconds'], 0)
        state = self.app.state()
        self.assertIsNone(state['last_checked_at'])
        for paper in state['manuscripts']:
            self.assertEqual(paper['source'], 'manual' if paper['account_id'] == accounts[0] else 'website')
            self.assertEqual(paper['title_en'], f"Parallel {accounts.index(paper['account_id'])} {paper['number'].split('-')[-1]}")

    def test_refresh_checks_every_tracked_status(self):
        mixed = self.account('mixed-refresh-account')
        second_account = self.account('terminal-account')
        expected = []
        for status in ('submitted', 'editor', 'review', 'decision', 'unknown'):
            expected.append(self.app.manuscript_save(self.paper(mixed, 'READ-' + status,
                title_en='Read ' + status, status=status))['id'])
        for status in ('revision', 'accepted', 'rejected', 'withdrawn'):
            expected.append(self.app.manuscript_save(self.paper(mixed, 'KEEP-' + status,
                title_en='Keep ' + status, status=status))['id'])
        expected.append(self.app.manuscript_save(self.paper(second_account, 'KEEP-RESUBMIT',
            title_en='Keep resubmission', status='revision', raw_status='Reject and Resubmit'))['id'])
        def read(account, journal, tracked, data):
            self.assertIn(account['id'], (mixed,second_account))
            return [dict(number=p['number'], title_en=p['title_en'], raw_status='Under Review',
                         submitted_at='2026-09-01') for p in tracked]
        stamp = '2026-10-01T22:00:00+08:00'
        with patch.object(self.app.portal_sync, 'read_account', side_effect=read) as reader, \
                patch.object(self.app, 'now', return_value=stamp):
            result = self.app.refresh({})
        self.assertEqual(reader.call_count,2)
        self.assertEqual(result['checked'], len(expected))
        self.assertEqual(result['issues'], [])
        self.assertEqual(self.app.state()['last_checked_at'], stamp)
        self.assertTrue(all(p['last_success'] == stamp for p in self.app.state()['manuscripts']))

    def test_terminal_statuses_are_still_checked(self):
        account = self.account('terminal-refresh-account')
        identifier = self.app.manuscript_save(self.paper(account, 'KEEP-REJECT', status='rejected'))['id']
        row=dict(number='KEEP-REJECT',title_en='测试稿件',raw_status='Reject')
        with patch.object(self.app.portal_sync, 'read_account', return_value=[row]) as reader:
            for body in ({}, {'account_id': account}, {'manuscript_id': identifier}):
                with self.subTest(body=body):
                    result = self.app.refresh(body)
                    self.assertEqual(result['checked'], 1)
                    self.assertEqual(result['issues'], [])
        self.assertEqual(reader.call_count,3)
        self.assertEqual(self.app.state()['manuscripts'][0]['status'],'rejected')

    def test_first_website_read_establishes_baseline_for_number_only_entry(self):
        account = self.account('baseline-account')
        identifier = self.app.manuscript_save({'account_id':account, 'number':'BASE-001',
            'status':'unknown'})['id']
        row = {'number':'BASE-001', 'raw_status':'Under Review'}
        with patch.object(self.app.portal_sync, 'read_account', return_value=[row]):
            self.assertEqual(self.app.refresh({'manuscript_id':identifier})['updated'],0)
        state = self.app.state()
        self.assertEqual(state['manuscripts'][0]['status'],'review')
        self.assertEqual(state['manuscripts'][0]['change_count'],0)
        self.assertEqual(state['manuscripts'][0]['last_changed_at'],'')
        with patch.object(self.app.portal_sync, 'read_account', return_value=[{
                'number':'BASE-001', 'raw_status':'Awaiting Decision'}]):
            self.assertEqual(self.app.refresh({'manuscript_id':identifier})['updated'],1)
        self.assertEqual(self.app.state()['manuscripts'][0]['change_count'],1)

    def test_final_decision_remains_checked_without_duplicate_event(self):
        account = self.account('final-decision-account')
        identifier = self.app.manuscript_save(self.paper(account, 'FINAL-01',
            title_en='Final decision', status='review'))['id']
        row = dict(number='FINAL-01', title_en='Final decision', raw_status='Reject', submitted_at='2026-09-01')
        stamp = '2026-10-01T22:01:00+08:00'
        with patch.object(self.app.portal_sync, 'read_account', return_value=[row]), \
                patch.object(self.app, 'now', return_value=stamp):
            self.assertEqual(self.app.refresh({})['checked'], 1)
        state = self.app.state()
        self.assertEqual(state['manuscripts'][0]['status'], 'rejected')
        self.assertEqual(state['last_checked_at'], stamp)
        with patch.object(self.app.portal_sync, 'read_account', return_value=[row]) as reader:
            self.assertEqual(self.app.refresh({'manuscript_id': identifier})['checked'], 1)
            reader.assert_called_once()
        self.assertEqual(self.app.state()['events'], state['events'])

    def test_refresh_ambiguous_title_is_not_bound(self):
        account=self.account('sync-ambiguous')
        self.app.manuscript_save(self.paper(account,'',title_en='Same Title'))
        portal=[dict(number=n,title_en='Same Title',raw_status='Under Review',submitted_at='09-Sep-2026') for n in ('TEST-1','TEST-2')]
        with patch.object(self.app.portal_sync,'read_account',return_value=portal):
            result=self.app.refresh({})
        self.assertEqual(result['checked'],0)
        self.assertIsNone(self.app.state()['manuscripts'][0]['number'])
        self.assertIn('同名',result['message'])

    def test_revision_series_uses_latest_decision_and_initial_submission(self):
        account=self.account('revision-account')
        self.app.manuscript_save(self.paper(account,'',title_en='Same Research Title'))
        rows=[dict(number='TEST-2026-1',title_en='SAME Research Title',raw_status='Major Revision',submitted_at='23-Jan-2026'),
              dict(number='TEST-2026-1.R1',title_en='Same Research Title',raw_status='Minor Revision',submitted_at='23-Mar-2026'),
              dict(number='TEST-2026-1.R2',title_en='Same Research Title',raw_status='Accept (30-Apr-2026)',submitted_at='21-Apr-2026')]
        with patch.object(self.app.portal_sync,'read_account',return_value=rows):
            self.assertEqual(self.app.refresh({})['checked'],1)
        paper=self.app.state()['manuscripts'][0]
        self.assertEqual(paper['number'],'TEST-2026-1.R2')
        self.assertEqual(paper['status'],'accepted')
        self.assertEqual(paper['system_submitted_at'],'2026-01-23')
        self.assertEqual(self.app.tracked_matches(account,rows)[0]['status'],'matched')

    def test_revision_number_changes_keep_one_paper_and_event_history(self):
        account=self.account('round-account')
        identifier=self.app.manuscript_save(self.paper(account,'MS-2026-12',title_en='Round Tracking',
            status='submitted',raw_status='Submitted'))['id']
        reads=[('MS-2026-12-R1','Under Review'),('MS-2026-12_Rev2','Accepted')]
        for number,status in reads:
            with patch.object(self.app.portal_sync,'read_account',return_value=[dict(number=number,
                    title_en='Round Tracking',raw_status=status)]):
                self.assertEqual(self.app.refresh({})['checked'],1)
        paper=self.app.state()['manuscripts'][0]
        self.assertEqual(paper['id'],identifier)
        self.assertEqual(paper['number'],'MS-2026-12_Rev2')
        self.assertEqual(json.loads(paper['number_aliases']),['MS-2026-12','MS-2026-12-R1'])
        self.assertEqual(paper['change_count'],2)
        with self.assertRaisesRegex(ValueError,'其他修订版本'):
            self.app.manuscript_save(self.paper(account,'MS-2026-12.R3'))
        self.assertEqual(self.app.tracked_matches(account,[dict(number='MS-2026-12-R1')])[0]['status'],'not_found')

    def test_unique_title_recovers_renumbered_manuscript(self):
        account=self.account('renumber-account')
        identifier=self.app.manuscript_save(self.paper(account,'OLD-001',title_en='Stable Title'))['id']
        with patch.object(self.app.portal_sync,'read_account',return_value=[dict(number='NEW-927',
                title_en='Stable Title',raw_status='Under Review')]):
            self.assertEqual(self.app.refresh({})['checked'],1)
        paper=self.app.state()['manuscripts'][0]
        self.assertEqual(paper['id'],identifier)
        self.assertEqual(paper['number'],'NEW-927')
        self.assertEqual(json.loads(paper['number_aliases']),['OLD-001'])

    def test_reject_resubmit_is_pending_revision_after_migration_and_refreshes(self):
        raw='Reject with Possibility for Resubmission (09-Sep-2026)'
        account=self.account('resubmission-account')
        identifier=self.app.manuscript_save(self.paper(account,'TEST-RESUBMIT',
            title_en='Resubmission Test',status='rejected',raw_status=raw))['id']
        before=self.app.state()['manuscripts'][0]
        self.app.initialize()
        with self.app.connect() as con:
            con.execute('INSERT OR IGNORE INTO journals VALUES(?,?,?,?,?)', ('scis','SCIENCE CHINA Information Sciences','SCIS','ScholarOne','https://mc03.manuscriptcentral.com/scis'))
        migrated=self.app.state()
        paper=migrated['manuscripts'][0]
        self.assertEqual(paper['status'],'revision')
        self.assertEqual(paper['status_label'],'拒稿重投')
        for key in ('raw_status','last_success','recorded_at','source'):
            self.assertEqual(paper[key],before[key])
        self.assertEqual(migrated['events'][0]['new_status'],'revision')
        self.assertEqual(migrated['events'][0]['new_status_label'],'拒稿重投')
        rows=[dict(number='TEST-RESUBMIT',title_en='Resubmission Test',raw_status=raw,
                   submitted_at='05-Aug-2026')]
        with patch.object(self.app.portal_sync,'read_account',return_value=rows) as reader:
            self.assertEqual(self.app.refresh({'manuscript_id':identifier})['updated'],0)
            reader.assert_called_once()
        synced=self.app.state()['manuscripts'][0]
        self.assertEqual(synced['status'],'revision')
        self.assertEqual(synced['status_label'],'拒稿重投')
        self.assertEqual(synced['source'],'website')
        self.assertTrue(synced['last_success'])
        for raw_value in ('Reject and Resubmit','Reject & Resubmit','拒稿重投'):
            self.assertEqual(self.app.portal_sync.normalize_status(raw_value),'revision')
        self.assertEqual(self.app.portal_sync.normalize_status('Reject'),'rejected')
        self.assertEqual(self.app.portal_sync.normalize_status('Major Revision'),'revision')

    def test_new_journal_status_and_date_formats(self):
        self.assertEqual(self.app.portal_sync.normalize_status('Awaiting Referee Reports'),'review')
        self.assertEqual(self.app.portal_sync.submission_date('Aug  9 2026  3:27AM'),'2026-08-09')
        account=self.account('tim-format-account')
        self.app.manuscript_save(self.paper(account,'',title_en='TIM Test Paper'))
        rows=[dict(number='TIM-TEST-1',title_en='TIM Test Paper',raw_status='Under Review',
                   submitted_at='Aug 9 2026 3:27AM',status_date='Sep 27 2026 5:08PM')]
        with patch.object(self.app.portal_sync,'read_account',return_value=rows):
            self.assertEqual(self.app.refresh({})['checked'],1)
        paper=self.app.state()['manuscripts'][0]
        self.assertEqual(paper['system_submitted_at'],'2026-08-09')
        self.assertEqual(paper['status_date'],'2026-09-27')

    def test_em_date_formats_and_ambiguous_dates(self):
        parse = self.app.portal_sync.submission_date
        for value in ('02 Oct 2026', '2 October 2026', '02-Oct-2026', '02/Oct/2026',
                      'Oct. 2, 2026 3:27AM', 'Oct\u00a02,\u00a02026', '2026/10/02',
                      '2026-10-02T15:27:00Z', '2026年10月2日', '2026.10.02'):
            with self.subTest(value=value):
                self.assertEqual(parse(value), '2026-10-02')
        self.assertEqual(parse('23/09/2026'), '2026-09-23')
        self.assertEqual(parse('09/23/2026'), '2026-09-23')
        for value in ('10/02/2026', '31 Feb 2026', 'unknown', '02 Oct 26'):
            with self.subTest(value=value), self.assertRaises(self.app.portal_sync.PortalError):
                parse(value)

    def test_unrecognized_date_does_not_block_status_or_other_papers(self):
        account = self.account('date-warning')
        ids = [self.app.manuscript_save(self.paper(account, number, status_date='2026-09-01'))['id']
               for number in ('WARN-1', 'WARN-2', 'VALID-3')]
        with self.app.connect() as con:
            con.execute("UPDATE manuscripts SET system_submitted_at='2026-08-01'")
        rows = [dict(number='WARN-1', title_en='Fixture', raw_status='Under Review',
                     submitted_at='02/10/2026', status_date='unknown'),
                dict(number='WARN-2', title_en='Fixture', raw_status='已投稿',
                     submitted_at='unknown', status_date='unknown'),
                dict(number='VALID-3', title_en='Fixture', raw_status='With Editor',
                     submitted_at='02 Oct 2026', status_date='03 Oct 2026')]
        # Keep the second paper's status identical so its known date is still applicable.
        with self.app.connect() as con:
            con.execute("UPDATE manuscripts SET raw_status='Submitted' WHERE id=?", (ids[1],))
        rows[1]['raw_status'] = 'Submitted'
        with patch.object(self.app.portal_sync, 'read_account', return_value=rows):
            result = self.app.refresh({})
        self.assertEqual(result['checked'], 3)
        self.assertEqual(result['updated'], 2)
        papers = {p['id']:p for p in self.app.state()['manuscripts']}
        self.assertEqual(papers[ids[0]]['status'], 'review')
        self.assertEqual(papers[ids[0]]['system_submitted_at'], '2026-08-01')
        self.assertEqual(papers[ids[0]]['status_date'], '')
        self.assertEqual(papers[ids[1]]['status_date'], '2026-09-01')
        self.assertEqual(papers[ids[2]]['system_submitted_at'], '2026-10-02')
        self.assertEqual(papers[ids[2]]['status_date'], '2026-10-03')
        self.assertIn('4 项网站日期暂未识别', self.app.state()['accounts'][0]['sync_error'])
        self.assertTrue(all(p['last_success'] for p in papers.values()))

    def test_journal_rename_preserves_accounts_without_metrics_query(self):
        account = self.account('rename')
        paper = self.app.manuscript_save(self.paper(account, 'KEEP-1'))['id']
        before = self.app.state()
        self.app.journal_save({'name':'Corrected Journal', 'abbreviation':'COR'}, 'scis')
        after = self.app.state()
        self.assertEqual(after['journals'][0]['name'], 'Corrected Journal')
        self.assertEqual(after['journals'][0]['abbreviation'], 'COR')
        self.assertEqual(after['journals'][0]['login_url'], before['journals'][0]['login_url'])
        self.assertEqual(after['accounts'], before['accounts'])
        self.assertEqual(after['manuscripts'][0]['id'], paper)

    def test_account_delete_cleans_only_its_records_credentials_and_profiles(self):
        selected, other = self.account('remove'), self.account('keep')
        removed = self.app.manuscript_save(self.paper(selected, 'REMOVE-1'))['id']
        kept = self.app.manuscript_save(self.paper(other, 'KEEP-1'))['id']
        with self.app.connect() as con:
            con.execute('INSERT INTO account_sync(account_id) VALUES(?)', (selected,))
            con.execute('UPDATE accounts SET has_password=1 WHERE id=?', (selected,))
        profiles = self.app.DATA / 'browser-profiles'
        names = [selected, selected+'-firefox', selected+'-orcid-firefox-generation',
                 selected+'-elsevier-firefox', other, selected+'-unrelated']
        for name in names:
            (profiles/name).mkdir(parents=True)
        with patch.object(self.app.credential_store, 'delete') as credentials, patch.object(self.app, 'close_profile') as close:
            self.app.delete_records('account', selected)
            credentials.assert_called_once_with(selected)
            self.assertEqual(close.call_count, 4)
        data = self.app.state()
        self.assertEqual([a['id'] for a in data['accounts']], [other])
        self.assertEqual([p['id'] for p in data['manuscripts']], [kept])
        self.assertEqual(len(data['journals']), 1)
        self.assertTrue(all(e['manuscript_id']==kept for e in data['events']))
        self.assertEqual({p.name for p in profiles.iterdir()}, {other, selected+'-unrelated'})
        with self.app.connect() as con:
            self.assertEqual(con.execute('SELECT COUNT(*) FROM account_sync').fetchone()[0], 0)

    def test_journal_delete_keeps_other_journals(self):
        account = self.account('remove-journal')
        self.app.manuscript_save(self.paper(account, 'REMOVE-1'))
        other = self.app.account_save(dict(username='keep-journal', journal_name='Keep Journal',
            platform='Other', login_url='https://www.editorialmanager.com/keep-journal'))['id']
        with patch.object(self.app.credential_store, 'delete'):
            self.app.delete_records('journal', 'scis')
        data = self.app.state()
        self.assertEqual([a['id'] for a in data['accounts']], [other])
        self.assertEqual(data['manuscripts'], [])
        self.assertEqual(data['events'], [])
        self.assertEqual([j['name'] for j in data['journals']], ['Keep Journal'])

    def test_delete_waits_for_refresh_to_finish(self):
        account = self.account('busy')
        with self.app.SYNC_LOCK, patch.object(self.app.credential_store, 'delete') as credentials:
            with self.assertRaisesRegex(ValueError, '正在读取或登录'):
                self.app.delete_records('account', account)
            credentials.assert_not_called()
        self.assertEqual(len(self.app.state()['accounts']), 1)

    def test_cep_comma_dates_sync_revision(self):
        account=self.orcid_account()
        identifier=self.app.manuscript_save(self.paper(account,'',title_en='CEP Revision Test',status='review'))['id']
        rows=[dict(number='CONENGPRAC-TEST-1',title_en='CEP Revision Test',raw_status='Revise',
                   submitted_at='Jun 29, 2026',status_date='Sep 28, 2026')]
        with patch.object(self.app.portal_sync,'read_account',return_value=rows):
            self.assertEqual(self.app.refresh({'manuscript_id':identifier})['checked'],1)
        paper=self.app.state()['manuscripts'][0]
        self.assertEqual(paper['status'],'revision')
        self.assertEqual(paper['raw_status'],'Revise')
        self.assertEqual(paper['system_submitted_at'],'2026-06-29')
        self.assertEqual(paper['status_date'],'2026-09-28')
        self.assertEqual(paper['source'],'website')
        self.assertTrue(paper['last_success'])

    def test_visible_verification_reads_only_requested_account(self):
        a,b=self.account('verify-a'),self.account('verify-b')
        self.app.manuscript_save(self.paper(a,'TEST-A',title_en='Paper A'))
        self.app.manuscript_save(self.paper(b,'TEST-B',title_en='Paper B'))
        row=dict(number='TEST-A',title_en='Paper A',raw_status='Under Review',submitted_at='09-Sep-2026')
        with patch.object(self.app.portal_sync,'read_account',return_value=[row]) as reader:
            result=self.app.refresh({'account_id':a,'interactive':True})
            self.assertEqual(result['checked'],1)
            reader.assert_called_once()
            self.assertEqual(reader.call_args.args[0]['id'],a)
            self.assertTrue(reader.call_args.kwargs['interactive'])
        self.assertIsNone(next(p for p in self.app.state()['manuscripts'] if p['account_id']==b)['last_success'])
        with self.assertRaisesRegex(ValueError,'请选择需要验证的账号'):
            self.app.refresh({'interactive':True})

    def test_retry_finishes_partial_check_without_rereading_successful_accounts(self):
        a,b=self.account('retry-a'),self.account('retry-b')
        self.app.manuscript_save(self.paper(a,'',title_en='Paper A'))
        second=self.app.manuscript_save(self.paper(b,'',title_en='Paper B'))['id']
        row=lambda letter:dict(number='TEST-'+letter,title_en='Paper '+letter,raw_status='Under Review',submitted_at='09-Sep-2026')
        def read(account,*args):
            if account['id']==b: raise self.app.portal_sync.PortalError('测试读取失败')
            return [row('A')]
        with patch.object(self.app.portal_sync,'read_account',side_effect=read):
            self.app.refresh({})
        self.assertIsNone(self.app.state()['last_checked_at'])
        with patch.object(self.app.portal_sync,'read_account',return_value=[row('B')]) as reader:
            self.app.refresh({'manuscript_id':second})
            self.assertEqual(reader.call_count,1)
        self.assertTrue(self.app.state()['last_checked_at'])


if __name__=='__main__':
    unittest.main()
