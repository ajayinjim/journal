import { randomUUID } from 'node:crypto';
import { PDFDocument, PageSizes, StandardFonts } from 'pdf-lib';
import { fixture } from './apps-script-fixture.mjs';

export function localDemo() {
  const db = fixture();
  const rpc = (action, data, token) => {
    const result = db.rpc(action, data, token);
    if (!result.ok) throw new Error(result.message);
    return result.data;
  };
  function signIn(email, registration = {}) {
    const mode = registration.name ? 'register' : 'login';
    rpc('requestCode', { email, mode, ...registration });
    return rpc('verifyCode', { email, code: db.mail.at(-1).body.match(/\d{6}/)[0] }).token;
  }
  const admin = signIn('admin@example.test');
  rpc('reviewer', { email: 'reviewer@example.test', name: 'Prof. Meera Rao', affiliation: 'School of Management' }, admin);
  rpc('reviewer', { email: 'reviewer2@example.test', name: 'Dr. Rohan Sen', affiliation: 'Centre for Applied Research' }, admin);
  const author = signIn('author@example.test', { name: 'Ananya Sharma', affiliation: 'School of Business' });
  const challenges = new Map();
  const tokens = { 'admin@example.test': admin, 'author@example.test': author, 'reviewer@example.test': signIn('reviewer@example.test') };
  const seeded = (async () => {
    for (const [title, section, status] of [
      ['Digital credit and small-business resilience', 'Research Article', 'Under review'],
      ['Responsible AI adoption in higher education', 'Review Article', 'Accepted'],
      ['Platform governance in emerging markets', 'Research Article', 'Submitted'],
      ['Circular supply chains in the textile sector', 'Case Study', 'Revision requested'],
      ['Financial inclusion through embedded finance', 'Research Article', 'Under review'],
      ['Evaluating micro-credentials for adult learners', 'Review Article', 'Rejected']
    ].reverse()) {
      const document = await PDFDocument.create();
      const page = document.addPage(PageSizes.A4);
      const font = await document.embedFont(StandardFonts.Helvetica);
      page.drawText(title, { x: 55, y: 750, size: 16, font });
      page.drawText('Sample PDF for the local editorial workflow.', { x: 55, y: 715, size: 12, font });
      const base64 = await document.saveAsBase64();
      const id = randomUUID();
      const files = Object.fromEntries(['manuscript', 'titlePage', 'undertaking'].map(kind => [kind, rpc('upload', { kind, base64, name: kind + '.pdf' }, author).id]));
      rpc('submit', { id, title, section, ...files, abstract: 'This sample manuscript illustrates how the editorial team receives and processes a journal submission.', keywords: 'Publication, peer review' }, author);
      if (status === 'Under review') rpc('assign', { id, email: 'reviewer@example.test' }, admin);
      else if (status !== 'Submitted') rpc('decide', { id, status, note: 'The editorial team has issued a decision.' }, admin);
      if (status === 'Accepted') {
        const file = rpc('upload', { kind: 'final', base64, name: 'Final article.pdf' }, admin);
        rpc('final', { id, fileId: file.id }, admin);
        const issue = rpc('createIssue', { title: 'Current research in business and management', volume: 1, number: 1, year: 2026 }, admin);
        rpc('schedule', { id, issueId: issue.id, position: 1 }, admin);
      }
    }
  })();
  return {
    name: 'journal-local-demo',
    configureServer(server) {
      server.middlewares.use('/demo-info', (_req, res) => {
        res.setHeader('Content-Type', 'application/json'); res.end('{"demo":true}');
      });
      server.middlewares.use('/.netlify/functions/journal', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        try {
          await seeded;
          const buffers = [];
          for await (const chunk of req) buffers.push(chunk);
          const { action, data = {} } = JSON.parse(Buffer.concat(buffers).toString());
          const email = String(data.email || '').trim().toLowerCase();
          const token = req.headers.cookie?.match(/(?:^|;\s*)journal-demo=([a-f0-9]{64})/)?.[1];
          let result;
          if (action === 'requestCode') {
            challenges.set(email, data);
            result = { ok: true, data: {} };
          } else if (action === 'verifyCode') {
            if (!challenges.has(email) || data.code !== '246810') throw new Error('Use the local demo code 246810.');
            const requested = challenges.get(email);
            challenges.delete(email);
            if (!tokens[email]) tokens[email] = signIn(email, requested.mode === 'register' ? requested : {});
            res.setHeader('Set-Cookie', 'journal-demo=' + tokens[email] + '; Path=/; HttpOnly; SameSite=Strict');
            result = { ok: true, data: {} };
          } else if (action === 'logout') {
            res.setHeader('Set-Cookie', 'journal-demo=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
            result = { ok: true, data: {} };
          } else result = db.rpc(action, data, token);
          res.end(JSON.stringify(result));
        } catch (error) {
          res.end(JSON.stringify({ ok: false, message: error.message }));
        }
      });
    }
  };
}
