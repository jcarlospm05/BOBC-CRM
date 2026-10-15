const ANDROID_ORIGIN = 'https://appassets.androidplatform.net';
const MAX_NATIVE_BYTES = 32 * 1024 * 1024;

function blobBase64(blob, environment) {
  return new Promise((resolve, reject) => {
    const reader = new environment.FileReader();
    reader.onerror = () => reject(new Error('No se pudo preparar el archivo para guardar'));
    reader.onabort = () => reject(new Error('Se interrumpió la preparación del archivo'));
    reader.onload = () => {
      const match = /^data:[^,]*;base64,([A-Za-z0-9+/=]*)$/.exec(String(reader.result));
      if (match) resolve(match[1]);
      else reject(new Error('No se pudo codificar el archivo para guardar'));
    };
    reader.readAsDataURL(blob);
  });
}

// The injected Android bridge belongs only to the app's bundled HTTPS origin.
// A factory keeps native pending state local and allows transport tests without
// claiming that a mocked callback verifies Android's document picker.
export function createFileDownloader(environment = globalThis) {
  let pending = false, sequence = 0;
  return async function downloadBlob(blob, name) {
    const bridge = environment.location?.origin === ANDROID_ORIGIN
      && typeof environment.BobcAndroid?.saveFile === 'function'
      ? environment.BobcAndroid : null;
    if (!bridge) {
      const url = environment.URL.createObjectURL(blob);
      try {
        const link = environment.document.createElement('a');
        link.href = url;
        link.download = name;
        link.hidden = true;
        environment.document.body?.appendChild(link);
        try { link.click(); } finally { link.remove?.(); }
      } finally {
        environment.setTimeout(() => environment.URL.revokeObjectURL(url), 3000);
      }
      // Browsers do not report whether the user kept a started download.
      return {native: false, started: true, saved: false};
    }
    if (pending) throw new Error('Ya hay un archivo pendiente de guardar. Termina o cancela esa operación.');
    if (blob.size > MAX_NATIVE_BYTES) throw new Error('El archivo supera el límite de 32 MiB para guardar en Android.');
    const mime = blob.type.split(';')[0].toLowerCase();
    if (!((mime === 'application/json' && /\.json$/i.test(name))
      || (mime === 'text/csv' && /\.csv$/i.test(name)))) {
      throw new Error('Android sólo permite exportar archivos JSON o CSV del CRM.');
    }
    pending = true;
    try {
      const base64 = await blobBase64(blob, environment);
      const requestId = environment.crypto?.randomUUID?.()
        || 'bobc-save-' + Date.now() + '-' + (++sequence);
      return await new Promise((resolve, reject) => {
        const onResult = event => {
          const result = event.detail;
          if (!result || result.requestId !== requestId) return;
          environment.removeEventListener('bobc-file-result', onResult);
          if (result.success === true) resolve({native: true, saved: true});
          else if (result.cancelled === true) resolve({native: true, saved: false, cancelled: true});
          else reject(new Error(typeof result.error === 'string' && result.error
            ? result.error : 'No se pudo guardar el archivo'));
        };
        environment.addEventListener('bobc-file-result', onResult);
        try { bridge.saveFile(base64, name, mime, requestId); }
        catch (error) {
          environment.removeEventListener('bobc-file-result', onResult);
          reject(error);
        }
      });
    } finally {
      pending = false;
    }
  };
}

export const downloadBlob = createFileDownloader();
