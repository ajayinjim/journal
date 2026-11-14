import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

export function fixture() {
  const files = new Map();
  const mail = [];
  const tables = new Map();
  const props = new Map([['INITIAL_ADMIN_EMAIL', 'admin@example.test'],
    ['JOURNAL_API_SECRET', 'local-test-secret-at-least-32-characters']]);
  function sheet() {
    const rows = [];
    const range = (row, column, count = 1, wide = 1) => ({
      createTextFinder: value => {
        const finder = {
          matchEntireCell: () => finder, matchCase: () => finder, useRegularExpression: () => finder,
          findNext() {
            const relative = rows.slice(row - 1, row - 1 + count).findIndex(item => item[column - 1] === value);
            return relative < 0 ? null : { getRow: () => row + relative };
          }
        };
        return finder;
      },
      getValues: () => rows.slice(row - 1, row - 1 + count).map(item => item.slice(column - 1, column - 1 + wide)),
      getValue: () => rows[row - 1]?.[column - 1],
      setValues: values => values.forEach((item, index) => { rows[row + index - 1] = item; })
    });
    return {
      appendRow: row => rows.push(row), deleteRow: row => rows.splice(row - 1, 1),
      getLastRow: () => rows.length, getRange: range
    };
  }
  const database = {
    getId: () => 'sheet',
    getSheetByName: name => tables.get(name),
    insertSheet: name => { const value = sheet(); tables.set(name, value); return value; }
  };
  const sandbox = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props.get(key), setProperty: (key, value) => props.set(key, value) }) },
    Utilities: {
      getUuid: randomUUID,
      computeHmacSha256Signature: (data, key) => createHmac('sha256', key).update(data).digest(),
      base64EncodeWebSafe: data => Buffer.from(data).toString('base64url'),
      base64Encode: data => Buffer.from(data).toString('base64'),
      base64Decode: data => Buffer.from(data, 'base64'),
      newBlob: bytes => ({ getBytes: () => bytes })
    },
    SpreadsheetApp: { openById: () => database, create: () => database, flush: () => {} },
    DriveApp: {
      createFolder: () => ({ getId: () => 'folder' }),
      getFolderById: () => ({ createFile: blob => {
        const id = randomUUID();
        const file = { getId: () => id, getBlob: () => blob, setTrashed: () => files.delete(id) };
        files.set(id, file);
        return file;
      } }),
      getFileById: id => files.get(id)
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    MailApp: { sendEmail: (email, subject, body) => mail.push({ email, subject, body }) },
    ContentService: { createTextOutput: body => ({ setMimeType: () => body }), MimeType: { JSON: 'json' } }
  });
  vm.runInContext(code, sandbox);
  sandbox.setupJournal();
  return {
    mail, sandbox,
    rpc(action, data = {}, token, secret = props.get('JOURNAL_API_SECRET')) {
      return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action, data, token, secret }) } }));
    }
  };
}
