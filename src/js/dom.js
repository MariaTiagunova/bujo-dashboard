export const h = (tag, attrs, ...children) => {
  const el = document.createElement(tag);
  const props = attrs || {};
  Object.keys(props).forEach((name) => {
    const value = props[name];
    if (value === null || value === undefined || value === false) {
      return;
    }
    if (name === 'className') {
      el.className = value;
    } else if (name === 'text') {
      el.appendChild(document.createTextNode(String(value)));
    } else {
      el.setAttribute(name, value === true ? '' : String(value));
    }
  });
  appendChildren(el, children);
  return el;
};

const appendChildren = (el, children) => {
  children.forEach((child) => {
    if (child === null || child === undefined || child === false) {
      return;
    }
    if (Array.isArray(child)) {
      appendChildren(el, child);
    } else if (typeof child === 'object') {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  });
};

export const byId = (id) => document.getElementById(id);

export const replaceContent = (el, ...children) => {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
  appendChildren(el, children);
};

export const toggleClass = (el, name, on) => {
  const classes = el.className.split(/\s+/).filter((item) => item && item !== name);
  if (on) {
    classes.push(name);
  }
  el.className = classes.join(' ');
};

// Element.closest is not available in old e-reader browsers.
export const findActionTarget = (start, root) => {
  let node = start;
  while (node && node !== root) {
    if (node.getAttribute && node.getAttribute('data-action')) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
};

// The hidden attribute is not supported in all old e-reader browsers, so inline display is used.
export const setShown = (el, shown) => {
  el.style.display = shown ? '' : 'none';
};

export const isShown = (el) => el.style.display !== 'none';
