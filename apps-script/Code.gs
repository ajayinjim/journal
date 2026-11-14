const TABLES = ['Settings', 'People', 'Papers', 'Issues', 'Uploads', 'Codes', 'Sessions'];
const STATUS = ['Submitted', 'Under review', 'Revision requested', 'Accepted', 'Rejected'];
const RECOMMENDATIONS = ['Accept', 'Request revision', 'Reject'];
const MAX_BYTES = 4 * 1024 * 1024;
const prop_ = () => PropertiesService.getScriptProperties();
const now_ = () => new Date().toISOString();
const id_ = () => Utilities.getUuid();
const token_ = () => id_().replace(/-/g, '') + id_().replace(/-/g, '');
const digest_ = value => Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value, prop_().getProperty('AUTH_PEPPER')));
const email_ = value => {
  const email = String(value || '').trim().toLowerCase();
  require_(email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
  return email;
};

function setupJournal() {
  const properties = prop_();
  const admin = email_(properties.getProperty('INITIAL_ADMIN_EMAIL'));
  const secret = properties.getProperty('JOURNAL_API_SECRET');
  require_(secret && secret.length >= 32, 'Set JOURNAL_API_SECRET to at least 32 random characters.');
  locked_(() => {
    if (!properties.getProperty('AUTH_PEPPER')) properties.setProperty('AUTH_PEPPER', token_());
    if (!properties.getProperty('JOURNAL_SHEET_ID')) {
      const sheet = SpreadsheetApp.create('Journal Publication Records');
      properties.setProperty('JOURNAL_SHEET_ID', sheet.getId());
    }
    if (!properties.getProperty('JOURNAL_FOLDER_ID')) {
      properties.setProperty('JOURNAL_FOLDER_ID', DriveApp.createFolder('Journal Publication Files').getId());
    }
    const db = db_();
    TABLES.forEach(name => {
      if (db.getSheetByName(name)) return;
      db.insertSheet(name).appendRow(['Record ID', 'Record JSON']);
    });
    const settings = db.getSheetByName('Sheet1');
    if (settings && settings.getLastRow() === 0) db.deleteSheet(settings);
    if (!get_('Settings', 'journal')) put_('Settings', {
      id: 'journal', name: 'Journal Publication System', publisher: '', issn: '',
      contact: admin, sections: ['Research Article', 'Review Article', 'Case Study'], submissionsOpen: true
    });
    if (!get_('People', admin)) put_('People', {
      id: admin, email: admin, name: 'Managing Editor', role: 'admin', active: true, affiliation: ''
    });
    require_(get_('People', admin).role === 'admin', 'The configured initial email already has another role.');
  });
  Logger.log('Spreadsheet: ' + properties.getProperty('JOURNAL_SHEET_ID'));
  Logger.log('Drive folder: ' + properties.getProperty('JOURNAL_FOLDER_ID'));
}

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    const secret = prop_().getProperty('JOURNAL_API_SECRET');
    require_(secret && equal_(request.secret, secret), 'Request denied.', 'FORBIDDEN');
    return json_({ ok: true, data: dispatch_(request) });
  } catch (error) {
    if (!error.code) console.error(error.message);
    return json_({ ok: false, code: error.code || 'SERVER_ERROR',
      message: error.code ? error.message : 'The journal service could not complete the request.' });
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function equal_(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < b.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function require_(condition, message, code) {
  if (condition) return;
  const error = new Error(message);
  error.code = code || 'INVALID';
  throw error;
}

function locked_(work) {
  const lock = LockService.getScriptLock();
  require_(lock.tryLock(8000), 'The journal is busy. Please retry.', 'BUSY');
  try {
    return work();
  } finally {
    try {
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
}

function db_() {
  const id = prop_().getProperty('JOURNAL_SHEET_ID');
  require_(id, 'Complete Apps Script setup first.', 'SETUP');
  return SpreadsheetApp.openById(id);
}

function rows_(table) {
  const sheet = db_().getSheetByName(table);
  require_(sheet, 'Complete Apps Script setup first.', 'SETUP');
  const count = sheet.getLastRow() - 1;
  return count > 0 ? sheet.getRange(2, 1, count, 2).getValues() : [];
}

function list_(table) {
  return rows_(table).filter(row => row[1]).map(row => JSON.parse(row[1]));
}

function get_(table, id) {
  const sheet = db_().getSheetByName(table);
  require_(sheet, 'Complete Apps Script setup first.', 'SETUP');
  const row = rowFor_(sheet, id);
  return row ? JSON.parse(sheet.getRange(row, 2).getValue()) : null;
}

function rowFor_(sheet, id) {
  const count = sheet.getLastRow() - 1;
  const cell = count > 0 && sheet.getRange(2, 1, count, 1).createTextFinder('key:' + String(id))
    .matchEntireCell(true).matchCase(true).useRegularExpression(false).findNext();
  return cell ? cell.getRow() : 0;
}

function put_(table, record) {
  const sheet = db_().getSheetByName(table);
  const json = JSON.stringify(record);
  require_(json.length <= 48000, 'This record is full. Contact the managing editor.');
  const row = rowFor_(sheet, record.id) || sheet.getLastRow() + 1;
  // The prefix keeps user-controlled email addresses literal in Google Sheets.
  sheet.getRange(row, 1, 1, 2).setValues([['key:' + String(record.id), json]]);
  return record;
}

function remove_(table, id) {
  const sheet = db_().getSheetByName(table);
  const row = rowFor_(sheet, id);
  if (row) sheet.deleteRow(row);
}

function text_(value, label, max, required) {
  require_(typeof value === 'string' || value == null, 'Invalid ' + label + '.');
  const text = String(value || '').trim();
  require_((!required || text.length > 0) && text.length <= max,
    label + ' must contain ' + (required ? '1–' : 'at most ') + max + ' characters.');
  return text;
}

function person_(token) {
  require_(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'Sign in to continue.', 'AUTH');
  const session = get_('Sessions', digest_(token));
  require_(session && session.until > Date.now(), 'Your session expired. Sign in again.', 'AUTH');
  const user = get_('People', session.email);
  require_(user && user.active, 'This account is unavailable.', 'AUTH');
  return user;
}

function role_(user, role) {
  require_(user.role === role, 'This action is restricted.', 'FORBIDDEN');
}

function requestCode_(data, network) {
  const email = email_(data.email);
  const register = data.mode === 'register';
  const profile = register ? {
    name: text_(data.name, 'Full name', 120, true),
    affiliation: text_(data.affiliation, 'Affiliation', 180, true)
  } : null;
  const current = get_('People', email);
  const previous = get_('Codes', email);
  const time = Date.now();
  require_(!previous || time - previous.sentAt >= 60000, 'Wait one minute before requesting another code.', 'RATE');
  const bucket = Math.floor(time / 3600000);
  const networkKey = 'rate-' + digest_(String(network || 'unknown')).slice(0, 28);
  for (const [key, limit] of [[networkKey, 12], ['rate-global', 60]]) {
    const usage = get_('Codes', key);
    const count = usage && usage.bucket === bucket ? usage.count : 0;
    require_(count < limit, 'Too many sign-in attempts. Try again later.', 'RATE');
    put_('Codes', { id: key, bucket, count: count + 1, until: time + 7200000 });
  }
  const code = String(parseInt(id_().replace(/-/g, '').slice(0, 12), 16) % 1000000).padStart(6, '0');
  const eligible = register ? !current : current && current.active;
  put_('Codes', { id: email, hash: eligible ? digest_(email + '|' + code) : '', sentAt: time,
    until: time + 600000, attempts: 0, profile });
  if (eligible) {
    try {
      MailApp.sendEmail(email, 'Your journal sign-in code', 'Your code is ' + code +
        '. It expires in 10 minutes. If you did not request it, you can ignore this message.');
    } catch (error) {
      remove_('Codes', email);
      throw error;
    }
  }
  return {};
}

function verifyCode_(data) {
  const email = email_(data.email);
  require_(typeof data.code === 'string' && /^\d{6}$/.test(data.code), 'Enter the six-digit code.');
  const challenge = get_('Codes', email);
  require_(challenge && challenge.until > Date.now() && challenge.attempts < 5,
    'Request a new sign-in code.');
  challenge.attempts++;
  put_('Codes', challenge);
  require_(equal_(digest_(email + '|' + data.code), challenge.hash), 'The code is incorrect.');
  let user = get_('People', email);
  if (!user && challenge.profile) {
    user = put_('People', { id: email, email, ...challenge.profile, role: 'author', active: true });
  }
  require_(user && user.active, 'This account is unavailable.', 'AUTH');
  remove_('Codes', email);
  const token = token_();
  put_('Sessions', { id: digest_(token), email, until: Date.now() + 12 * 3600000 });
  return { token, user };
}

function paper_(id) {
  const paper = get_('Papers', id);
  require_(paper, 'Submission unavailable.', 'NOT_FOUND');
  return paper;
}

function assigned_(paper, user) {
  return paper.assignment && paper.assignment.email === user.email;
}

function canRead_(paper, user) {
  return user.role === 'admin' || paper.authorEmail === user.email ||
    (user.role === 'reviewer' && assigned_(paper, user));
}

function appendEvent_(paper, status, message, visibility) {
  paper.history.push({ status, message, visibility, at: now_() });
  paper.updated = now_();
}

function viewPaper_(paper, user, issues) {
  const issue = issues.find(item => item.id === paper.issueId);
  const view = { ...paper, status: issue && issue.publishedAt ? 'Published' : paper.status,
    issue: issue ? { volume: issue.volume, number: issue.number, year: issue.year } : null };
  if (user.role === 'author') {
    delete view.assignment;
    delete view.reviews;
    if (view.status !== 'Published') delete view.final;
    view.history = paper.history.filter(item => item.visibility === 'author');
  }
  if (user.role === 'reviewer') {
    delete view.authorEmail;
    delete view.authorName;
    delete view.affiliation;
    delete view.coauthors;
    delete view.final;
    view.versions = paper.versions.map(({ manuscript, at }, index) => ({
      at, manuscript: index + 1 === paper.assignment.version ? { ...manuscript, name: paper.reference + '.pdf' } : null
    }));
    view.reviews = paper.reviews.filter(item => item.email === user.email);
    view.history = [];
  }
  return view;
}

function dashboard_(user) {
  const issues = list_('Issues');
  const settings = get_('Settings', 'journal');
  const papers = list_('Papers').filter(paper => canRead_(paper, user))
    .sort((a, b) => b.updated.localeCompare(a.updated)).map(paper => viewPaper_(paper, user, issues));
  return { user, settings, papers,
    issues: user.role === 'admin' ? issues.sort((a, b) => b.year - a.year || b.volume - a.volume || b.number - a.number) : [],
    reviewers: user.role === 'admin' ? list_('People').filter(person => person.role === 'reviewer') : [] };
}

function upload_(user, data) {
  const kinds = user.role === 'author' ? ['manuscript', 'titlePage', 'undertaking'] :
    user.role === 'admin' ? ['final'] : [];
  require_(kinds.includes(data.kind), 'Upload type unavailable.', 'FORBIDDEN');
  require_(typeof data.base64 === 'string' && data.base64.length <= 5600000 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(data.base64), 'Upload a PDF of up to 4 MiB.');
  const bytes = Utilities.base64Decode(data.base64);
  require_(bytes.length <= MAX_BYTES && bytes.slice(0, 5).join(',') === '37,80,68,70,45', 'Upload a valid PDF of up to 4 MiB.');
  const name = text_(data.name, 'Filename', 160, true).replace(/[\/\\\x00-\x1f]/g, '_');
  require_(/\.pdf$/i.test(name), 'Use a .pdf filename.');
  const id = id_();
  const folder = DriveApp.getFolderById(prop_().getProperty('JOURNAL_FOLDER_ID'));
  const file = folder.createFile(Utilities.newBlob(bytes, 'application/pdf', id + '-' + name));
  try {
    put_('Uploads', { id, owner: user.email, kind: data.kind, drive: file.getId(), name,
      size: bytes.length, created: Date.now() });
  } catch (error) {
    file.setTrashed(true);
    throw error;
  }
  return { id, name };
}

function attachment_(user, id, kind) {
  const file = get_('Uploads', id);
  require_(file && file.owner === user.email && file.kind === kind, 'A required PDF upload is missing or inaccessible.');
  return { id: file.id, name: file.name, size: file.size };
}

function version_(user, data) {
  return { at: now_(), titlePage: attachment_(user, data.titlePage, 'titlePage'),
    manuscript: attachment_(user, data.manuscript, 'manuscript'),
    undertaking: attachment_(user, data.undertaking, 'undertaking') };
}

function download_(user, data) {
  const paper = paper_(data.paperId);
  require_(canRead_(paper, user), 'Submission unavailable.', 'FORBIDDEN');
  let candidates = paper.versions.map(version => version.manuscript);
  if (user.role === 'reviewer') candidates = [paper.versions[paper.assignment.version - 1].manuscript];
  else candidates = candidates.concat(paper.versions.flatMap(version => [version.titlePage, version.undertaking]),
    paper.final && (user.role === 'admin' || isPublished_(paper)) ? [paper.final] : []);
  require_(candidates.some(file => file.id === data.fileId), 'File unavailable.', 'FORBIDDEN');
  const file = get_('Uploads', data.fileId);
  require_(file, 'File unavailable.', 'NOT_FOUND');
  return { name: user.role === 'reviewer' ? paper.reference + '.pdf' : file.name, base64: Utilities.base64Encode(DriveApp.getFileById(file.drive).getBlob().getBytes()) };
}

function isPublished_(paper) {
  const issue = paper.issueId && get_('Issues', paper.issueId);
  return Boolean(issue && issue.publishedAt);
}

function issue_(id) {
  const issue = get_('Issues', id);
  require_(issue, 'Issue unavailable.', 'NOT_FOUND');
  return issue;
}

function ordered_(issueId) {
  return list_('Papers').filter(paper => paper.issueId === issueId).sort((a, b) => a.position - b.position);
}

function issueManifest_(issue) {
  const papers = ordered_(issue.id);
  require_(papers.length > 0 && papers.every(paper => paper.final && paper.status === 'Accepted'),
    'Add accepted papers with final typeset PDFs before exporting.');
  const settings = issue.printSettings || get_('Settings', 'journal');
  const signature = digest_(JSON.stringify([issue.title, issue.volume, issue.number, issue.year,
    settings.name, settings.publisher, settings.issn, papers.map(paper => [paper.id, paper.title, paper.final.id, paper.position])]));
  return { issue, settings, signature, papers: papers.map(paper => ({
    id: paper.id, title: paper.title, authorName: paper.authorName, coauthors: paper.coauthors, final: paper.final
  })) };
}

function dispatch_(request) {
  const { action, token, network } = request;
  const data = request.data || {};
  if (action === 'requestCode') return locked_(() => requestCode_(data, network));
  if (action === 'verifyCode') return locked_(() => verifyCode_(data));
  if (action === 'dashboard') return dashboard_(person_(token));
  if (action === 'download') return download_(person_(token), data);
  if (action === 'upload') return locked_(() => upload_(person_(token), data));
  if (action === 'issueManifest') {
    role_(person_(token), 'admin');
    return locked_(() => issueManifest_(issue_(data.id)));
  }
  return locked_(() => {
    const user = person_(token);
    if (action === 'logout') {
      remove_('Sessions', digest_(token));
      return {};
    }
    if (['submit', 'revise'].includes(action)) {
      role_(user, 'author');
      const settings = get_('Settings', 'journal');
      if (action === 'submit') {
        require_(settings.submissionsOpen, 'New submissions are currently closed.');
        require_(typeof data.id === 'string' && /^[a-f0-9-]{36}$/.test(data.id), 'Invalid submission request.');
        const existing = get_('Papers', data.id);
        if (existing && existing.authorEmail === user.email) return { id: existing.id };
        require_(!existing, 'Submission conflict.');
        const title = text_(data.title, 'Manuscript title', 250, true);
        const abstract = text_(data.abstract, 'Abstract', 4500, true);
        const keywords = text_(data.keywords, 'Keywords', 250, true);
        const coauthors = text_(data.coauthors, 'Co-authors', 500, false);
        require_(settings.sections.includes(data.section), 'Choose an active journal section.');
        const version = version_(user, data);
        const paper = { id: data.id, reference: 'JRN-' + data.id.replace(/-/g, '').slice(0, 12).toUpperCase(),
          title, abstract, keywords, coauthors, section: data.section, authorEmail: user.email,
          authorName: user.name, affiliation: user.affiliation, status: 'Submitted', created: now_(),
          history: [], reviews: [], versions: [version], assignment: null };
        appendEvent_(paper, 'Submitted', 'Submission received.', 'author');
        put_('Papers', paper);
        return { id: paper.id };
      }
      const paper = paper_(data.id);
      require_(paper.authorEmail === user.email, 'Submission unavailable.', 'FORBIDDEN');
      if (paper.versions.at(-1).manuscript.id === data.manuscript) return { id: paper.id };
      require_(paper.status === 'Revision requested', 'This submission is not open for revision.');
      paper.versions.push(version_(user, data));
      paper.assignment = null;
      paper.status = 'Submitted';
      appendEvent_(paper, paper.status, 'Revised files received.', 'author');
      put_('Papers', paper);
      return { id: paper.id };
    }
    if (action === 'review') {
      role_(user, 'reviewer');
      const paper = paper_(data.id);
      require_(assigned_(paper, user) && paper.status === 'Under review' &&
        paper.assignment.id === data.assignmentId && !paper.assignment.completed,
        'This review is unavailable or already submitted.', 'FORBIDDEN');
      require_(RECOMMENDATIONS.includes(data.recommendation), 'Choose a recommendation.');
      const comments = text_(data.comments, 'Review comments', 3500, true);
      const confidential = text_(data.confidential, 'Confidential notes', 1500, false);
      paper.reviews.push({ email: user.email, recommendation: data.recommendation, comments, confidential,
        version: paper.assignment.version, at: now_() });
      paper.assignment.completed = true;
      appendEvent_(paper, 'Review completed', 'Reviewer submitted a recommendation.', 'staff');
      put_('Papers', paper);
      return {};
    }
    role_(user, 'admin');
    if (action === 'settings') {
      require_(Array.isArray(data.sections) && data.sections.length > 0 && data.sections.length <= 25,
        'Enter 1–25 journal sections.');
      const sections = [...new Set(data.sections.map(s => text_(s, 'Section', 60, true)))];
      put_('Settings', { id: 'journal', name: text_(data.name, 'Journal name', 120, true),
        publisher: text_(data.publisher, 'Publisher', 120, false), issn: text_(data.issn, 'ISSN', 24, false),
        contact: email_(data.contact), sections, submissionsOpen: data.submissionsOpen === true });
      return {};
    }
    if (action === 'reviewer') {
      const email = email_(data.email);
      const existing = get_('People', email);
      require_(!existing || existing.role === 'reviewer', 'This email already belongs to another role.');
      const name = text_(data.name, 'Full name', 120, true);
      put_('People', { id: email, email, role: 'reviewer', active: data.active !== false, name,
        affiliation: text_(data.affiliation, 'Affiliation', 180, false) });
      return {};
    }
    if (action === 'createIssue' || action === 'editIssue') {
      const existing = action === 'editIssue' ? issue_(data.id) : null;
      require_(!existing || !existing.publishedAt, 'Published issues are locked.');
      const volume = Number(data.volume);
      const number = Number(data.number);
      const year = Number(data.year);
      require_([volume, number, year].every(Number.isInteger) && volume >= 1 && volume <= 9999 &&
        number >= 1 && number <= 9999 && year >= 1900 && year <= 2200, 'Enter a valid volume, issue number and year.');
      require_(!list_('Issues').some(issue => issue.id !== existing?.id && issue.volume === volume && issue.number === number && issue.year === year),
        'This issue already exists.');
      const issue = put_('Issues', { id: existing?.id || id_(), volume, number, year,
        title: text_(data.title, 'Issue title', 160, true), createdAt: existing?.createdAt || now_(), publishedAt: '' });
      return { id: issue.id };
    }
    if (action === 'publish') {
      const issue = issue_(data.id);
      if (issue.publishedAt) return {};
      const manifest = issueManifest_(issue);
      require_(data.signature === manifest.signature, 'The issue changed. Export the latest PDF before publishing.');
      issue.printSettings = manifest.settings;
      issue.publishedAt = now_();
      put_('Issues', issue);
      return {};
    }
    require_(['assign', 'decide', 'final', 'schedule'].includes(action), 'Unknown action.', 'NOT_FOUND');
    const paper = paper_(data.id);
    require_(!isPublished_(paper), 'Published submissions are locked.');
    if (action === 'assign') {
      require_(['Submitted', 'Under review'].includes(paper.status), 'This submission is not ready for review.');
      const reviewer = get_('People', email_(data.email));
      require_(reviewer && reviewer.role === 'reviewer' && reviewer.active && reviewer.email !== paper.authorEmail,
        'Choose an active reviewer.');
      if (assigned_(paper, reviewer) && !paper.assignment.completed) return {};
      require_(!paper.reviews.some(review => review.email === reviewer.email && review.version === paper.versions.length),
        'This reviewer already completed a review for this version.');
      paper.assignment = { id: id_(), email: reviewer.email, name: reviewer.name, at: now_(),
        version: paper.versions.length, completed: false };
      paper.status = 'Under review';
      appendEvent_(paper, paper.status, 'The editorial team assigned a reviewer.', 'author');
    }
    if (action === 'decide') {
      require_(STATUS.includes(data.status), 'Choose a valid status.');
      require_(data.status !== 'Under review' || paper.assignment, 'Assign a reviewer first.');
      require_(!paper.issueId || data.status === 'Accepted', 'Remove the paper from its issue before changing its status.');
      const note = text_(data.note, 'Decision note', 2000, true);
      if (data.status !== 'Under review') paper.assignment = null;
      if (data.status !== 'Accepted') paper.final = null;
      paper.status = data.status;
      appendEvent_(paper, paper.status, note, 'author');
    }
    if (action === 'final') {
      require_(paper.status === 'Accepted', 'Accept the paper before uploading the final PDF.');
      paper.final = attachment_(user, data.fileId, 'final');
      appendEvent_(paper, paper.status, 'Final typeset PDF uploaded.', 'staff');
    }
    if (action === 'schedule') {
      const target = data.issueId ? issue_(data.issueId) : null;
      require_(paper.status === 'Accepted' && paper.final && (!target || !target.publishedAt),
        'Schedule an accepted paper with a final PDF in a draft issue.');
      const position = Number(data.position);
      require_(!target || (Number.isInteger(position) && position >= 1 && position <= 999),
        'Enter a print position between 1 and 999.');
      require_(!target || !ordered_(target.id).some(item => item.id !== paper.id && item.position === position),
        'That print position is already in use.');
      paper.issueId = target ? target.id : '';
      paper.position = target ? position : 0;
      appendEvent_(paper, paper.status, 'Issue placement updated.', 'staff');
    }
    put_('Papers', paper);
    return {};
  });
}

function cleanExpiredJournalData() {
  locked_(() => {
    const time = Date.now();
    ['Codes', 'Sessions'].forEach(table => list_(table).filter(item => item.until < time).forEach(item => remove_(table, item.id)));
    const used = new Set(list_('Papers').flatMap(paper => [
      paper.final?.id, ...paper.versions.flatMap(version => [version.titlePage.id, version.manuscript.id, version.undertaking.id])
    ]));
    list_('Uploads').filter(item => item.created < time - 86400000 && !used.has(item.id)).forEach(item => {
      DriveApp.getFileById(item.drive).setTrashed(true);
      remove_('Uploads', item.id);
    });
  });
}
