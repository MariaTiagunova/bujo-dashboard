const TIMEOUT_MS = 25000;
let jsonpCounter = 0;

// A blocked CORS response looks like a network error, but the server can still do the action.
// Only actions that give the same result when they run two times can use the JSONP retry.
const RETRY_SAFE_ACTIONS = ['config', 'ping', 'dashboard', 'setTask', 'resetReminders', 'listDevices', 'revokeDevice', 'signOut', 'listCalendars', 'setCalendars'];
const PUBLIC_ACTIONS = ['config', 'signIn', 'pair'];

// A plain Error with a flag. Subclasses of Error do not work correctly after the ES5 transpile.
// The code "auth" tells the page that this device is not signed in.
export const apiError = (message, { network = false, code = '' } = {}) => {
  const error = new Error(message);
  error.network = network;
  error.code = code;
  return error;
};

const unwrap = (response) => {
  if (!response || typeof response !== 'object') {
    throw apiError('The server sent an incorrect response.');
  }
  if (!response.ok) {
    throw apiError(response.error || 'The server sent an error.', { code: response.code || '' });
  }
  return response.data;
};

// The body is text/plain. This prevents a CORS preflight request, and Apps Script cannot answer a preflight.
const sendXhr = (url, payload) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (callback, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        callback(value);
      }
    };
    const timer = setTimeout(() => {
      xhr.abort();
      finish(reject, apiError('The request timed out.', { network: true }));
    }, TIMEOUT_MS);

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) {
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(reject, apiError(xhr.status ? `HTTP ${xhr.status}` : 'Network error', { network: xhr.status === 0 }));
        return;
      }
      try {
        finish(resolve, JSON.parse(xhr.responseText));
      } catch {
        finish(reject, apiError('The response is not JSON. Check the Web App URL and the access settings.'));
      }
    };
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    xhr.send(JSON.stringify(payload));
  });

// Old e-reader browsers can block cross-origin XHR. A script tag (JSONP) has no CORS rules.
const sendJsonp = (url, payload) =>
  new Promise((resolve, reject) => {
    jsonpCounter += 1;
    const callbackName = `__bujoJsonp${Date.now()}${jsonpCounter}`;
    const script = document.createElement('script');
    const separator = url.indexOf('?') === -1 ? '?' : '&';
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };

    window[callbackName] = (response) => {
      cleanup();
      resolve(response);
    };
    script.onerror = () => {
      cleanup();
      reject(apiError('Network error', { network: true }));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(apiError('The request timed out.', { network: true }));
    }, TIMEOUT_MS);

    script.src = `${url}${separator}callback=${callbackName}&payload=${encodeURIComponent(JSON.stringify(payload))}`;
    document.getElementsByTagName('head')[0].appendChild(script);
  });

export class Api {
  #transport = typeof XMLHttpRequest === 'undefined' ? 'jsonp' : 'xhr';

  constructor(getSettings) {
    this.getSettings = getSettings;
  }

  async call(action, params = {}) {
    const { apiUrl, deviceToken } = this.getSettings();
    if (!apiUrl) {
      throw apiError('Open Settings and add the Web App URL.');
    }
    const isPublic = PUBLIC_ACTIONS.includes(action);
    if (!isPublic && !deviceToken) {
      throw apiError('Open Settings and sign in.', { code: 'auth' });
    }
    const payload = isPublic ? { ...params, action } : { ...params, action, deviceToken };
    if (this.#transport === 'jsonp') {
      return unwrap(await sendJsonp(apiUrl, payload));
    }
    try {
      return unwrap(await sendXhr(apiUrl, payload));
    } catch (error) {
      if (!error || !error.network || !RETRY_SAFE_ACTIONS.includes(action)) {
        throw error;
      }
      const result = unwrap(await sendJsonp(apiUrl, payload));
      this.#transport = 'jsonp';
      return result;
    }
  }

  dashboard(days) {
    return this.call('dashboard', { days });
  }

  setTask(list, id, done) {
    return this.call('setTask', { list, id, done });
  }

  addTask(list, title) {
    return this.call('addTask', { list, title });
  }

  resetReminders() {
    return this.call('resetReminders');
  }

  ping() {
    return this.call('ping');
  }

  config() {
    return this.call('config');
  }

  signIn(idToken, label) {
    return this.call('signIn', { idToken, label });
  }

  pair(code, label) {
    return this.call('pair', { code, label });
  }

  createPairingCode() {
    return this.call('createPairingCode');
  }

  listDevices() {
    return this.call('listDevices');
  }

  revokeDevice(id) {
    return this.call('revokeDevice', { id });
  }

  signOut() {
    return this.call('signOut');
  }

  createEvent(event) {
    return this.call('createEvent', event);
  }

  listCalendars() {
    return this.call('listCalendars');
  }

  setCalendars(ids) {
    return this.call('setCalendars', { ids });
  }
}
