import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown,
  ChevronRight, CircleCheck, Clock3, FileText, Layers, LayoutDashboard, ListFilter, LogOut,
  Menu, Plus, Search, Settings2, ShieldCheck, Users, X } from 'lucide-react';
import { api, b64bytes, savePdf, sendFile } from './api.js';
import './style.css';

const STATUSES = ['Submitted', 'Under review', 'Revision requested', 'Accepted', 'Rejected', 'Published'];
const ROLES = { admin: 'Managing editor', author: 'Author', reviewer: 'Reviewer' };
const ATTACHMENTS = { titlePage: 'Title page', manuscript: 'Anonymised manuscript', undertaking: 'Signed undertaking' };
const date = value => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value));
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
const issueLabel = issue => `Vol. ${issue.volume} · Issue ${issue.number} · ${issue.year}`;
const fields = form => Object.fromEntries(new FormData(form));
const badge = value => value.toLowerCase().replaceAll(' ', '-');

function Status({ value }) {
  return <span className={'pill ' + badge(value)}><i />{value}</span>;
}

function Brand({ name = '' }) {
  return <div className="brand">
    <span className="mark"><BookOpen size={22} strokeWidth={1.8} /></span>
    <span><strong>{name && name !== 'Journal Publication System' ? name : 'Journal Desk'}</strong><small>Publication system</small></span>
  </div>;
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) fetch('/demo-info').then(r => r.json()).then(r => setDemo(r.demo === true)).catch(() => {});
  }, []);
  async function submit(event) {
    event.preventDefault();
    const data = fields(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (challenge) {
        await api('verifyCode', { email: challenge.email, code: data.code });
        await onLogin();
      } else {
        await api('requestCode', { ...data, mode });
        setChallenge(data);
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="auth">
    <section className="auth-content">
      <Brand />
      <div className="auth-form">
        {challenge && <button className="text-button back" onClick={() => { setChallenge(null); setError(''); }}><ArrowLeft size={16} /> Change email</button>}
        <h1>{challenge ? 'Check your email' : mode === 'register' ? 'Create an author account' : 'Sign in to Journal Desk'}</h1>
        <p>{challenge ? 'Enter the six-digit code sent to ' + challenge.email + '.' : mode === 'register' ?
          'Register to submit a manuscript and follow its progress.' : 'Use your email to access your editorial workspace.'}</p>
        <form onSubmit={submit}>
          {!challenge && mode === 'register' && <>
            <label>Full name<input name="name" autoComplete="name" maxLength={120} required /></label>
            <label>Institution or affiliation<input name="affiliation" autoComplete="organization" maxLength={180} required /></label>
          </>}
          {challenge ? <label>Verification code<input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus /></label> :
            <label>Email address<input name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" required /></label>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" disabled={busy}>{busy ? 'Please wait…' : challenge ? 'Verify and sign in' : 'Send sign-in code'}<ArrowRight size={17} /></button>
        </form>
        {challenge ? <button className="text-button auth-secondary" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { await api('requestCode', { ...challenge, mode }); }
          catch (err) { setError(err.message); }
          finally { setBusy(false); }
        }}>Send a new code</button> : <p className="auth-secondary">{mode === 'register' ? 'Already registered?' : 'Submitting for the first time?'}{' '}
          <button className="text-button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? 'Sign in' : 'Register as an author'}</button></p>}
        {demo && <div className="demo-note"><strong>Local demo</strong><p>Choose a sample account. After requesting a code, enter <b>246810</b>.</p>
          <div className="demo-roles">{Object.entries(ROLES).map(([role, label]) =>
            <button key={role} className="secondary" disabled={busy} onClick={() => {
              setChallenge(null); setMode('login'); setEmail(role + '@example.test'); setError('');
            }}>{label}</button>)}</div></div>}
      </div>
      <div className="auth-footer"><ShieldCheck size={16} /> Private editorial workspace</div>
    </section>
    <aside className="auth-art">
      <div className="orb orb-one" /><div className="orb orb-two" />
      <div className="art-copy"><BookOpen size={44} strokeWidth={1.3} /><h2>From manuscript<br />to published issue.</h2><p>Submissions, peer review and issue production in one editorial workspace.</p></div>
    </aside>
  </main>;
}

function Dialog({ title, description, close, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); close(); }}>
    <header className="dialog-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>
      <button className="icon-button" onClick={close} aria-label="Close"><X size={20} /></button></header>
    <div className="dialog-body">{children}</div>
  </dialog>;
}

function Form({ children, label, action, cancel, className = '' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className={className} onSubmit={async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError('');
    try { await action(fields(form), form); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }}>
    <fieldset disabled={busy}>{children}</fieldset>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions">{cancel && <button type="button" className="secondary" onClick={cancel}>Cancel</button>}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Working…' : label}</button></div>
  </form>;
}

function FilterTable({ papers, role, open, query, setQuery, filter, setFilter, compact }) {
  const displayStatus = paper => role === 'reviewer' && paper.assignment?.completed ? 'Review completed' : paper.status;
  const available = role === 'reviewer' ? ['Under review', 'Review completed'] : STATUSES;
  const filtered = papers.filter(paper => (filter === 'All statuses' || displayStatus(paper) === filter) &&
    (!query || [paper.title, paper.reference, paper.section, paper.authorName].some(value => value?.toLowerCase().includes(query.trim().toLowerCase()))));
  const data = compact ? filtered.slice(0, 6) : filtered;
  return <div className="table-card">
    <div className="table-tools">
      <label className="search"><Search size={17} /><input aria-label="Search submissions" placeholder="Search title, ID or section…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="filter"><ListFilter size={16} /><select aria-label="Filter by status" value={filter} onChange={e => setFilter(e.target.value)}>
        {['All statuses', ...available].map(value => <option key={value}>{value}</option>)}
      </select><ChevronDown size={14} /></label>
    </div>
    {data.length === 0 ? <div className="empty"><span><FileText size={24} /></span>
      <h3>{papers.length ? 'No matching submissions' : 'No submissions yet'}</h3>
      <p>{papers.length ? 'Try a different search or status.' : role === 'reviewer' ? 'Manuscripts assigned to you will appear here.' : 'Submitted manuscripts will appear here.'}</p>
    </div> : <div className="table-scroll"><table>
      <thead><tr><th>Manuscript</th><th>Status</th><th>{role === 'admin' ? 'Reviewer' : 'Section'}</th><th>Updated</th><th><span className="sr">Open</span></th></tr></thead>
      <tbody>{data.map(paper => <tr key={paper.id}>
        <td><button className="paper-title" onClick={() => open(paper.id)}>{paper.title}</button>
          <small>{paper.reference}{role === 'admin' ? ' · ' + paper.authorName : ''}</small></td>
        <td><Status value={displayStatus(paper)} /></td>
        <td>{role === 'admin' ? paper.assignment?.name || 'Unassigned' : paper.section}</td>
        <td>{date(paper.updated)}</td>
        <td><button className="icon-button" aria-label={'Open ' + paper.title} onClick={() => open(paper.id)}><ChevronRight size={17} /></button></td>
      </tr>)}</tbody>
    </table></div>}
    <div className="table-footer">{data.length} of {papers.length} submissions</div>
  </div>;
}

function SubmitForm({ settings, paper, call, complete, close }) {
  const id = useRef(paper?.id || crypto.randomUUID());
  const uploads = useRef({});
  async function submit(data) {
    for (const kind of Object.keys(ATTACHMENTS)) {
      const file = data[kind];
      if (uploads.current[kind]?.file !== file) {
        const saved = await sendFile(call, kind, file);
        uploads.current[kind] = { file, id: saved.id };
      }
      data[kind] = uploads.current[kind].id;
    }
    await call(paper ? 'revise' : 'submit', { ...data, id: id.current });
    await complete(paper ? 'Revision submitted.' : 'Manuscript submitted.');
  }
  return <Dialog title={paper ? 'Submit a revision' : 'New manuscript'} description={paper?.title || 'Add your manuscript details and the three required PDFs.'} close={close}>
    <Form action={submit} label={paper ? 'Submit revision' : 'Submit manuscript'} cancel={close}>
      {!paper && <>
        <label>Manuscript title<input name="title" maxLength={250} required /></label>
        <label>Journal section<select name="section" defaultValue="" required><option value="" disabled>Select section</option>{settings.sections.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Abstract<textarea name="abstract" maxLength={4500} rows={5} required /></label>
        <label>Keywords<input name="keywords" placeholder="Separate keywords with commas" maxLength={250} required /></label>
        <label>Co-authors <span className="muted">(optional)</span><input name="coauthors" maxLength={500} /></label>
      </>}
      <p className="helper">PDF only, up to 4 MiB each. Remove names, identifying details and document metadata from the manuscript before uploading.</p>
      {Object.entries(ATTACHMENTS).map(([kind, label]) => <label key={kind}>{label}
        <input type="file" name={kind} accept="application/pdf,.pdf" required /></label>)}
    </Form>
  </Dialog>;
}

function PaperView({ paper, role, reviewers, issues, call, update, revise, back }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState('');
  const version = paper.versions[(role === 'reviewer' ? paper.assignment.version : paper.versions.length) - 1];
  const canEdit = role === 'admin' && paper.status !== 'Published';
  const canAssign = ['Submitted', 'Under review'].includes(paper.status);
  async function download(file) {
    setLoading(file.id); setError('');
    try {
      const result = await call('download', { paperId: paper.id, fileId: file.id });
      savePdf(b64bytes(result.base64), result.name);
    } catch (err) { setError(err.message); }
    finally { setLoading(''); }
  }
  async function act(action, data, message) {
    await call(action, { id: paper.id, ...data });
    await update(message);
  }
  const files = Object.entries(ATTACHMENTS).filter(([key]) => version[key]).map(([key, label]) => [label, version[key]]);
  if (paper.final && (role === 'admin' || paper.status === 'Published')) files.push(['Final typeset PDF', paper.final]);
  return <>
    <button className="text-button back" onClick={back}><ArrowLeft size={16} /> Back to submissions</button>
    <div className="page-heading"><div><div className="eyebrow">{paper.reference} &nbsp; / &nbsp; {paper.section}</div>
      <h1>{paper.title}</h1>{paper.authorName && <p>{paper.authorName}{paper.coauthors ? ', ' + paper.coauthors : ''}{paper.affiliation ? ' · ' + paper.affiliation : ''}</p>}</div>
      {role === 'author' && paper.status === 'Revision requested' && <button className="primary" onClick={revise}><Plus size={18} /> Submit revision</button>}
    </div>
    <div className="detail-grid">
      <section className="panel"><div className="panel-title"><h2>Manuscript details</h2><Status value={paper.status} /></div>
        <h3>Abstract</h3><p className="preserve">{paper.abstract}</p><h3>Keywords</h3><p>{paper.keywords}</p>
        {paper.issue && <><h3>Issue</h3><p>{issueLabel(paper.issue)}</p></>}
        <h3>Version {role === 'reviewer' ? paper.assignment.version : paper.versions.length} files</h3>
        {files.map(([label, file]) => <button className="file-row" key={file.id} disabled={Boolean(loading)} onClick={() => download(file)}>
          <FileText size={19} /><span><strong>{label}</strong><small>{file.name}</small></span><ArrowDownToLine size={17} /></button>)}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {role !== 'reviewer' && <section className="panel"><h2>Activity</h2><ol className="timeline">
        {paper.status === 'Published' && <li><strong>Published</strong><p>Included in {issueLabel(paper.issue)}.</p></li>}
        {[...paper.history].reverse().map((item, index) => <li key={index}><strong>{item.status}</strong><small>{date(item.at)}</small><p className="preserve">{item.message}</p></li>)}
      </ol></section>}
      {canEdit && canAssign && <section className="panel"><h2>Reviewer assignment</h2>
        {paper.assignment && <p>{paper.assignment.name} · {paper.assignment.completed ? 'Review completed' : 'Awaiting review'}</p>}
        {reviewers.some(user => user.active) ?
          <Form label={paper.assignment ? 'Update assignment' : 'Assign reviewer'} action={data => act('assign', data, 'Reviewer assignment saved.')}>
            <label>Reviewer<select name="email" defaultValue="" required><option value="" disabled>Choose an active reviewer</option>
              {reviewers.filter(user => user.active).map(user => <option key={user.email} value={user.email}>{user.name} · {user.email}</option>)}</select></label>
          </Form> : <p>Add an active reviewer in the reviewer directory.</p>}
      </section>}
      {canEdit && <section className="panel"><h2>Editorial decision</h2>
        <Form key={paper.status} label="Save decision" action={(data, form) => act('decide', data, 'Decision saved.').then(() => form.reset())}>
          <label>Status<select name="status" defaultValue={paper.status} required>
            {STATUSES.filter(value => value !== 'Published' && (value !== 'Under review' || paper.assignment)).map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label>Note for the author<textarea name="note" rows={3} required maxLength={2000} /></label>
        </Form>
      </section>}
      {canEdit && paper.status === 'Accepted' && <section className="panel"><h2>Production</h2>
        <Form label={paper.final ? 'Replace final PDF' : 'Upload final PDF'} action={async (data, form) => {
          const file = await sendFile(call, 'final', data.final);
          await act('final', { fileId: file.id }, 'Final PDF saved.');
          form.reset();
        }}>
          <label>Final typeset PDF <span className="muted">(portrait A4, up to 4 MiB)</span><input name="final" type="file" accept="application/pdf,.pdf" required /></label>
        </Form>
        {paper.final && <Form key={paper.issueId || 'none'} label="Save issue placement" action={data => act('schedule', data, 'Issue placement saved.')}>
          <label>Issue<select name="issueId" defaultValue={paper.issueId || ''}>
            <option value="">Unscheduled</option>{issues.filter(issue => !issue.publishedAt).map(issue => <option key={issue.id} value={issue.id}>{issueLabel(issue)} · {issue.title}</option>)}
          </select></label>
          <label>Print position<input name="position" type="number" min="1" max="999" defaultValue={paper.position || 1} /></label>
        </Form>}
      </section>}
      {role === 'reviewer' && paper.status === 'Under review' && !paper.assignment.completed && <section className="panel"><h2>Submit your review</h2>
        <Form label="Submit recommendation" action={data => act('review', { ...data, assignmentId: paper.assignment.id }, 'Review submitted.')}>
          <label>Recommendation<select name="recommendation" defaultValue="" required><option value="" disabled>Select an outcome</option>
            {['Accept', 'Request revision', 'Reject'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Review comments<textarea name="comments" rows={5} maxLength={3500} required /></label>
          <label>Confidential notes to the editor<textarea name="confidential" rows={3} maxLength={1500} /></label>
        </Form>
      </section>}
      {role !== 'author' && paper.reviews.length > 0 && <section className="panel"><h2>Reviewer reports</h2>
        {paper.reviews.map((review, index) => <article className="review" key={index}><strong>{review.recommendation}</strong>
          <small>{role === 'admin' ? review.email + ' · ' : ''}Version {review.version} · {date(review.at)}</small>
          <p className="preserve">{review.comments}</p>{review.confidential && <p className="preserve"><b>Confidential</b><br />{review.confidential}</p>}</article>)}
      </section>}
    </div>
  </>;
}

function Issues({ issues, papers, call, update, open, manage }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [exported, setExported] = useState({});
  async function run(issue, publish) {
    setBusy(issue.id);
    setError('');
    try {
      if (publish) {
        await call('publish', { id: issue.id, signature: exported[issue.id] });
        await update('Issue published. Its articles now show as Published.');
      } else {
        const manifest = await call('issueManifest', { id: issue.id });
        const { exportIssue } = await import('./print.js');
        const pdf = await exportIssue(manifest, async paper => {
          const result = await call('download', { paperId: paper.id, fileId: paper.final.id });
          return b64bytes(result.base64);
        });
        savePdf(pdf, `Volume-${issue.volume}_Issue-${issue.number}_${issue.year}.pdf`);
        setExported(previous => ({ ...previous, [issue.id]: manifest.signature }));
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  return <>
    <div className="page-heading"><div><h1>Issues</h1><p>Arrange accepted articles and assemble a single PDF for printing.</p></div>
      <button className="primary" onClick={() => manage({})}><Plus size={18} /> New issue</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!issues.length && <section className="panel empty"><span><Layers size={24} /></span><h3>No issues yet</h3><p>Create an issue to start scheduling articles.</p></section>}
    <div className="issue-grid">{issues.map(issue => {
      const ordered = papers.filter(paper => paper.issueId === issue.id).sort((a, b) => a.position - b.position);
      return <section className="panel issue" key={issue.id}>
        <div className="panel-title"><div className="issue-icon"><Layers size={20} /></div><Status value={issue.publishedAt ? 'Published' : 'Draft'} /></div>
        <div className="eyebrow">{issueLabel(issue)}</div><h2>{issue.title}</h2>
        {issue.publishedAt && <p>Published {date(issue.publishedAt)}</p>}
        {ordered.length ? <ol className="issue-order">{ordered.map(paper => <li key={paper.id}>
          <span>{paper.position}</span><button className="text-button" onClick={() => open(paper.id)}>{paper.title}</button>
        </li>)}</ol> : <p>Schedule accepted papers from their Production panel.</p>}
        <div className="issue-actions">{!issue.publishedAt && <button className="secondary" onClick={() => manage(issue)}>Edit issue</button>}<button className="secondary" disabled={Boolean(busy) || !ordered.length} onClick={() => run(issue, false)}>
          <ArrowDownToLine size={16} />{busy === issue.id ? 'Working…' : 'Export print PDF'}</button>
          {!issue.publishedAt && <button className="primary" disabled={Boolean(busy) || !exported[issue.id]} onClick={() => run(issue, true)}>Publish issue</button>}</div>
      </section>;
    })}</div>
  </>;
}

function ReviewerDirectory({ reviewers, manage }) {
  return <>
    <div className="page-heading"><div><h1>Reviewers</h1><p>Manage the people who can review submissions.</p></div>
      <button className="primary" onClick={() => manage({})}><Plus size={18} /> Add reviewer</button></div>
    {!reviewers.length ? <section className="panel empty"><span><Users size={24} /></span><h3>No reviewers yet</h3><p>Add a reviewer by email to allow sign-in and assignments.</p></section> :
      <div className="table-card table-scroll"><table><thead><tr><th>Name</th><th>Affiliation</th><th>Status</th><th><span className="sr">Edit</span></th></tr></thead>
        <tbody>{reviewers.map(user => <tr key={user.email}><td><strong>{user.name}</strong><small>{user.email}</small></td>
          <td>{user.affiliation || '—'}</td><td><Status value={user.active ? 'Active' : 'Inactive'} /></td>
          <td><button className="secondary" onClick={() => manage(user)}>Edit</button></td></tr>)}</tbody></table></div>}
  </>;
}

function Settings({ settings, call, update }) {
  return <>
    <div className="page-heading"><div><h1>Master setup</h1><p>Manage the journal identity, submission categories and availability.</p></div></div>
    <section className="panel settings"><h2>Journal settings</h2>
      <Form label="Save settings" action={async data => {
        await call('settings', { ...data, sections: data.sections.split('\n').map(value => value.trim()).filter(Boolean), submissionsOpen: data.submissionsOpen === 'on' });
        await update('Journal settings saved.');
      }}>
        <label>Journal name<input name="name" defaultValue={settings.name} maxLength={120} required /></label>
        <label>Publisher<input name="publisher" defaultValue={settings.publisher} maxLength={120} /></label>
        <label>ISSN<input name="issn" defaultValue={settings.issn} maxLength={24} /></label>
        <label>Editorial contact<input name="contact" type="email" defaultValue={settings.contact} required /></label>
        <label>Submission sections <span className="muted">(one per line)</span><textarea rows={5} name="sections" defaultValue={settings.sections.join('\n')} required /></label>
        <label className="check"><input type="checkbox" name="submissionsOpen" defaultChecked={settings.submissionsOpen} /> Accept new submissions</label>
      </Form></section>
  </>;
}

function Workspace({ snapshot, call, update, logout }) {
  const [page, setPage] = useState('overview');
  const [selected, setSelected] = useState('');
  const [modal, setModal] = useState(null);
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All statuses');
  const { user, settings, papers, issues, reviewers } = snapshot;
  const { role } = user;
  const nav = [['overview', 'Overview', LayoutDashboard], ['submissions', role === 'reviewer' ? 'Assigned papers' : 'Submissions', FileText],
    ...(role === 'admin' ? [['issues', 'Issues', Layers], ['reviewers', 'Reviewers', Users], ['settings', 'Master setup', Settings2]] : [])];
  const activePaper = papers.find(paper => paper.id === selected);
  const pageName = activePaper ? 'Manuscript details' : nav.find(([key]) => key === page)?.[1];
  const navigate = key => { setPage(key); setSelected(''); setMobile(false); setQuery(''); setFilter('All statuses'); };
  const open = id => { setSelected(id); };
  const close = () => setModal(null);
  const complete = async message => { await update(message); close(); };
  const stats = [
    [role === 'reviewer' ? 'Assigned papers' : 'Total submissions', papers.length, FileText, 'violet', 'All statuses'],
    ['Under review', papers.filter(paper => paper.status === 'Under review' && (role !== 'reviewer' || !paper.assignment?.completed)).length, Clock3, 'amber', 'Under review'],
    role === 'reviewer' ? ['Reviews completed', papers.filter(paper => paper.assignment?.completed).length, Check, 'green', 'Review completed'] :
      ['Accepted', papers.filter(paper => paper.status === 'Accepted').length, CircleCheck, 'green', 'Accepted'],
    ...(role === 'reviewer' ? [] : [['Published', papers.filter(paper => paper.status === 'Published').length, BookOpen, 'blue', 'Published']])
  ];
  return <div className="workspace">
    {mobile && <button className="scrim" onClick={() => setMobile(false)} aria-label="Close navigation" />}
    <aside className={'sidebar ' + (mobile ? 'visible' : '')}>
      <Brand name={settings.name} />
      <nav aria-label="Workspace navigation">{nav.map(([key, label, Icon]) =>
        <button key={key} onClick={() => navigate(key)} className={key === page ? 'selected' : ''} aria-current={key === page ? 'page' : undefined}><Icon size={19} />{label}</button>)}</nav>
      <div className="side-bottom"><div className="profile"><span className="avatar">{initials(user.name)}</span><span><strong>{user.name}</strong><small>{ROLES[role]}</small></span></div>
        <button className="signout" onClick={logout}><LogOut size={17} /> Sign out</button></div>
    </aside>
    <div className="workspace-right">
      <header className="topbar">
        <div><button className="icon-button menu" onClick={() => setMobile(!mobile)} aria-label="Toggle navigation"><Menu size={21} /></button>
          <span className="top-muted">Workspace</span><ChevronRight size={15} /><strong>{pageName}</strong></div>
        <span className="role-label"><ShieldCheck size={15} />{ROLES[role]}</span>
      </header>
      <main className="main">
        {activePaper ? <PaperView key={activePaper.id} paper={activePaper} role={role} reviewers={reviewers} issues={issues} call={call}
          update={update} revise={() => setModal({ kind: 'submit', paper: activePaper })} back={() => setSelected('')} /> :
          (page === 'overview' || page === 'submissions') ? <>
            <div className="page-heading"><div>
              <h1>{page === 'overview' ? 'Editorial overview' : role === 'reviewer' ? 'Assigned papers' : 'Submissions'}</h1>
              <p>{role === 'admin' ? 'Track submissions, manage peer review, and prepare journal issues.' :
                role === 'author' ? 'Submit manuscripts and follow the progress of your papers.' : 'Access your assignments and submit reviewer recommendations.'}</p>
            </div>{role === 'author' && settings.submissionsOpen && <button className="primary" onClick={() => setModal({ kind: 'submit' })}><Plus size={18} /> New submission</button>}</div>
            {page === 'overview' && <><div className={role === 'reviewer' ? 'stats reviewer-stats' : 'stats'}>{stats.map(([label, count, Icon, tint, status]) =>
              <button className="stat" key={label} onClick={() => { navigate('submissions'); setFilter(status); }}>
                <span className={'stat-icon ' + tint}><Icon size={21} strokeWidth={1.8} /></span>
                <span className="stat-label">{label}</span><strong>{count}</strong>
              </button>)}</div>
              <div className="section-head"><h2>{role === 'reviewer' ? 'Recent assignments' : 'Recent submissions'}</h2><button className="text-button" onClick={() => navigate('submissions')}>View all <ArrowUpRight size={16} /></button></div></>}
            <FilterTable papers={papers} role={role} open={open} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} compact={page === 'overview'} />
          </> : page === 'issues' ? <Issues issues={issues} papers={papers} call={call} update={update} open={open} manage={issue => setModal({ kind: 'issue', issue })} /> :
            page === 'reviewers' ? <ReviewerDirectory reviewers={reviewers} manage={reviewer => setModal({ kind: 'reviewer', reviewer })} /> :
              <Settings settings={settings} call={call} update={update} />}
      </main>
    </div>
    {modal?.kind === 'submit' && <SubmitForm settings={settings} paper={modal.paper} call={call} complete={complete} close={close} />}
    {modal?.kind === 'issue' && <Dialog title={modal.issue.id ? "Edit issue" : "New issue"} description="Set the volume, issue number and publication year." close={close}>
      <Form label={modal.issue.id ? 'Save issue' : 'Create issue'} cancel={close} action={async data => {
        await call(modal.issue.id ? 'editIssue' : 'createIssue', { ...data, id: modal.issue.id }); await complete('Issue saved.');
      }}>
        <label>Issue title<input name="title" maxLength={160} defaultValue={modal.issue.title} required /></label>
        <div className="triple"><label>Volume<input name="volume" type="number" min="1" max="9999" defaultValue={modal.issue.volume} required /></label>
          <label>Issue number<input name="number" type="number" min="1" max="9999" defaultValue={modal.issue.number} required /></label>
          <label>Year<input name="year" type="number" min="1900" max="2200" defaultValue={modal.issue.year || new Date().getFullYear()} required /></label></div>
      </Form></Dialog>}
    {modal?.kind === 'reviewer' && <Dialog title={modal.reviewer.email ? 'Edit reviewer' : 'Add reviewer'}
      description="Reviewers sign in with a code sent to their registered email." close={close}>
      <Form label="Save reviewer" cancel={close} action={async data => {
        await call('reviewer', { ...data, active: data.active === 'on' }); await complete('Reviewer saved.');
      }}>
        <label>Full name<input name="name" maxLength={120} defaultValue={modal.reviewer.name} required /></label>
        <label>Email address<input name="email" type="email" readOnly={Boolean(modal.reviewer.email)} defaultValue={modal.reviewer.email} required /></label>
        <label>Affiliation<input name="affiliation" maxLength={180} defaultValue={modal.reviewer.affiliation} /></label>
        <label className="check"><input name="active" type="checkbox" defaultChecked={modal.reviewer.active !== false} /> Active reviewer</label>
      </Form></Dialog>}
  </div>;
}

function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [warning, setWarning] = useState('');
  async function call(action, data) {
    try { return await api(action, data); }
    catch (err) {
      if (err.code === 'AUTH') setSnapshot(null);
      throw err;
    }
  }
  async function load() { setSnapshot(await call('dashboard')); }
  async function update(message) {
    setNotice(message);
    try { await load(); setWarning(''); }
    catch (err) { if (err.code !== 'AUTH') setWarning('Your change was saved. Reload the page to refresh the workspace.'); }
  }
  useEffect(() => { load().catch(() => {}).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  if (loading) return <div className="loading"><Brand /><p>Loading the journal…</p></div>;
  if (!snapshot) return <Auth onLogin={async () => { setWarning(''); setNotice(''); await load(); }} />;
  return <>
    <Workspace snapshot={snapshot} call={call} update={update} logout={async () => {
      try { await call('logout'); setWarning(''); setSnapshot(null); }
      catch (err) { if (err.code !== 'AUTH') setWarning(err.message); }
    }} />
    {notice && <div className="toast" role="status"><CircleCheck size={19} />{notice}<button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={17} /></button></div>}
    {warning && <div className="toast warning" role="alert">{warning}<button className="icon-button" onClick={() => setWarning('')} aria-label="Dismiss"><X size={17} /></button></div>}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
