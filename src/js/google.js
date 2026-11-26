const GIS_URL = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 15000;
let loading = null;

const currentGis = () => {
  const google = window.google;
  return google && google.accounts && google.accounts.id ? google.accounts.id : null;
};

// Old e-reader browsers cannot run the Google script. Then the promise is rejected, and the page offers a pairing code.
const loadGoogleIdentity = () => {
  if (currentGis()) {
    return Promise.resolve(currentGis());
  }
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => {
        clearTimeout(timer);
        loading = null;
        reject(new Error('Google sign-in does not work in this browser.'));
      };
      const timer = setTimeout(fail, LOAD_TIMEOUT_MS);
      script.onload = () => {
        if (!currentGis()) {
          fail();
          return;
        }
        clearTimeout(timer);
        resolve(currentGis());
      };
      script.onerror = fail;
      script.async = true;
      script.src = GIS_URL;
      document.getElementsByTagName('head')[0].appendChild(script);
    });
  }
  return loading;
};

export const renderGoogleButton = (container, clientId, onCredential) =>
  loadGoogleIdentity().then((gis) => {
    gis.initialize({
      client_id: clientId,
      callback: (response) => onCredential(response && response.credential),
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    gis.renderButton(container, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular' });
  });
