import presetEnv from '@babel/preset-env';
import polyfillCorejs3 from 'babel-plugin-polyfill-corejs3';

// The polyfill plugin cannot see the type of a value. It adds iterator helper polyfills for every
// call of forEach, map or filter, but this project calls these methods on arrays only.
const NOT_USED = [/^esnext\./, /^es\.iterator\./, /^es\.weak-map\.get-or-insert/, /^web\.dom-collections\.iterator$/];

export default {
  assumptions: {
    iterableIsArray: true,
    setSpreadProperties: true,
    privateFieldsAsProperties: true,
    setPublicClassFields: true,
    setClassMethods: true,
    noDocumentAll: true,
  },
  presets: [[presetEnv, { modules: false }]],
  plugins: [[polyfillCorejs3, { method: 'usage-global', version: '3.51', exclude: NOT_USED }]],
};
