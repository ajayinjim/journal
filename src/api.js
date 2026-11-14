export async function api(action, data = {}) {
  const response = await fetch('/.netlify/functions/journal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data })
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Connect the Apps Script deployment using the deployment guide.'); }
  if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
  return result.data;
}

export function b64bytes(base64) {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

export function savePdf(bytes, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function sendFile(call, kind, file) {
  if (!file?.size || file.size > 4 * 1024 * 1024 || !/\.pdf$/i.test(file.name)) {
    throw new Error('Choose a PDF of up to 4 MiB for each requested file.');
  }
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Unable to read ' + file.name));
    reader.readAsDataURL(file);
  });
  return call('upload', { kind, name: file.name, base64: data });
}
