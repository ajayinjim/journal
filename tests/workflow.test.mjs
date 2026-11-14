import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PDFDocument, PageSizes } from 'pdf-lib';
import { fixture } from './apps-script-fixture.mjs';
import { assembleIssue } from '../src/print.js';
import handler from '../netlify/functions/journal.mjs';

test('registration, role boundaries, review, revision, issue export and publication', async () => {
  const { rpc, mail } = fixture();
  const ok = (action, data, token) => {
    const result = rpc(action, data, token);
    assert.equal(result.ok, true, result.message);
    return result.data;
  };
  const signIn = (email, profile) => {
    ok('requestCode', { email, mode: profile ? 'register' : 'login', ...profile });
    const code = mail.at(-1).body.match(/\d{6}/)[0];
    const { token } = ok('verifyCode', { email, code });
    assert.equal(rpc('verifyCode', { email, code }).ok, false);
    return token;
  };
  assert.equal(rpc('dashboard', {}, undefined, 'wrong-secret').code, 'FORBIDDEN');
  assert.equal(rpc('dashboard').code, 'AUTH');
  const admin = signIn('admin@example.test');
  const profile = { name: 'Ananya Sharma', affiliation: 'School of Business' };
  const author = signIn('author@example.test', profile);
  const other = signIn('other@example.test', { ...profile, name: 'Another Author' });
  const email = 'reviewer@example.test';
  ok('reviewer', { email, name: 'Prof. Meera Rao' }, admin);
  const reviewer = signIn(email);
  assert.equal(rpc('settings', {}, author).code, 'FORBIDDEN');

  const pagePdf = await PDFDocument.create();
  pagePdf.addPage(PageSizes.A4).drawText('Article page one', { x: 48, y: 740 });
  pagePdf.addPage(PageSizes.A4).drawText('Article page two', { x: 48, y: 740 });
  const base64 = await pagePdf.saveAsBase64();
  function upload(kind, token) {
    return ok('upload', { kind, base64, name: 'Ananya Sharma.pdf' }, token).id;
  }
  function submissionFiles() {
    return Object.fromEntries(['titlePage', 'manuscript', 'undertaking'].map(kind => [kind, upload(kind, author)]));
  }
  const id = randomUUID();
  const versionOne = submissionFiles();
  const submission = {
    id, ...versionOne, title: 'समावेशी वित्त and digital credit', section: 'Research Article',
    abstract: 'An editorial workflow sample.', keywords: 'Credit, finance'
  };
  assert.equal(rpc('submit', submission, other).ok, false);
  ok('submit', submission, author);
  ok('submit', submission, author);
  assert.equal(ok('dashboard', {}, author).papers.length, 1);
  assert.equal(ok('dashboard', {}, other).papers.length, 0);
  assert.equal(rpc('download', { paperId: id, fileId: versionOne.manuscript }, reviewer).code, 'FORBIDDEN');
  ok('assign', { id, email }, admin);
  const assignment = ok('dashboard', {}, reviewer).papers[0];
  assert.equal(assignment.authorName, undefined);
  assert.equal(assignment.versions[0].undertaking, undefined);
  assert.notEqual(assignment.versions[0].manuscript.name, 'Ananya Sharma.pdf');
  assert.equal(ok('dashboard', {}, author).papers[0].assignment, undefined);
  assert.equal(rpc('download', { paperId: id, fileId: versionOne.titlePage }, reviewer).code, 'FORBIDDEN');
  assert.equal(ok('download', { paperId: id, fileId: versionOne.manuscript }, reviewer).base64, base64);
  ok('review', { id, assignmentId: assignment.assignment.id, recommendation: 'Request revision',
    comments: 'Expand the methodology.', confidential: 'Internal comment.' }, reviewer);
  assert.equal(ok('dashboard', {}, reviewer).papers[0].assignment.completed, true);
  assert.equal(ok('dashboard', {}, author).papers[0].reviews, undefined);
  ok('decide', { id, status: 'Revision requested', note: 'Please expand the methodology.' }, admin);
  const versionTwo = submissionFiles();
  ok('revise', { id, ...versionTwo }, author);
  ok('revise', { id, ...versionTwo }, author);
  assert.equal(ok('dashboard', {}, author).papers[0].versions.length, 2);
  ok('assign', { id, email }, admin);
  assert.equal(rpc('review', { id, assignmentId: assignment.assignment.id }, reviewer).code, 'FORBIDDEN');
  ok('decide', { id, status: 'Accepted', note: 'Accepted for publication.' }, admin);
  const final = upload('final', admin);
  ok('final', { id, fileId: final }, admin);
  const issue = ok('createIssue', { volume: 2, number: 1, year: 2026, title: 'Research in financial inclusion' }, admin);
  ok('schedule', { id, issueId: issue.id, position: 1 }, admin);
  assert.equal(rpc('download', { paperId: id, fileId: final }, author).code, 'FORBIDDEN');
  const manifest = ok('issueManifest', { id: issue.id }, admin);
  const fonts = await Promise.all(['NotoSans-Regular.ttf', 'NotoSansDevanagari-Regular.ttf'].map(name =>
    readFile(new URL('../public/fonts/' + name, import.meta.url))));
  const getBytes = paper => Buffer.from(ok('download', { paperId: paper.id, fileId: paper.final.id }, admin).base64, 'base64');
  const merged = await assembleIssue(manifest, getBytes, fonts);
  assert.equal((await PDFDocument.load(merged)).getPageCount(), 4);
  if (process.env.JOURNAL_TEST_PDF) await writeFile(process.env.JOURNAL_TEST_PDF, merged);
  const invalid = await PDFDocument.create();
  invalid.addPage(PageSizes.Letter);
  const invalidBytes = await invalid.save();
  await assert.rejects(() => assembleIssue(manifest, () => invalidBytes, fonts), /portrait A4/);
  ok('editIssue', { id: issue.id, volume: 2, number: 1, year: 2026, title: 'Edited issue title' }, admin);
  assert.equal(rpc('publish', { id: issue.id, signature: manifest.signature }, admin).ok, false);
  const latest = ok('issueManifest', { id: issue.id }, admin);
  ok('publish', { id: issue.id, signature: latest.signature }, admin);
  assert.equal(ok('dashboard', {}, author).papers[0].status, 'Published');
  assert.equal(ok('download', { paperId: id, fileId: final }, author).base64, base64);
  assert.equal(rpc('decide', { id, status: 'Rejected', note: 'Changed' }, admin).ok, false);
  assert.equal(rpc('editIssue', { id: issue.id }, admin).ok, false);
  ok('logout', {}, author);
  assert.equal(rpc('dashboard', {}, author).code, 'AUTH');
});

test('Netlify forwards the server-side secret and keeps sessions outside frontend JavaScript', async t => {
  const previousUrl = process.env.JOURNAL_SCRIPT_URL;
  const previousSecret = process.env.JOURNAL_API_SECRET;
  process.env.JOURNAL_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
  process.env.JOURNAL_API_SECRET = '12345678901234567890123456789012';
  t.after(() => {
    if (previousUrl === undefined) delete process.env.JOURNAL_SCRIPT_URL;
    else process.env.JOURNAL_SCRIPT_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.JOURNAL_API_SECRET;
    else process.env.JOURNAL_API_SECRET = previousSecret;
  });
  const token = 'a'.repeat(64);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { secret, action, network } = JSON.parse(options.body);
    assert.equal(secret, process.env.JOURNAL_API_SECRET);
    assert.equal(network, '192.0.2.1');
    assert.equal(action, 'verifyCode');
    return Response.json({ ok: true, data: { token } });
  });
  const request = (origin, data) => new Request('https://journal.example.test/.netlify/functions/journal', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verifyCode', data })
  });
  assert.equal((await handler(request('https://another.example.test', {}))).status, 403);
  const response = await handler(request('https://journal.example.test', {}), { ip: '192.0.2.1' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await response.json()).data.token, undefined);
});
