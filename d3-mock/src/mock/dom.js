class Style {
  constructor() {
    this._properties = {};
  }

  setProperty(name, value) {
    this._properties[name] = value;
  }
}

class Element {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.style = new Style();
    this._listeners = {};
  }

  addEventListener(type, listener) {
    if (!this._listeners[type]) {
      this._listeners[type] = [];
    }
    this._listeners[type].push(listener);
  }


  appendChild(child) {
    this.children.push(child);
    return child;
  }

  insertBefore(newNode, referenceNode) {
    if (referenceNode == null) {
      this.appendChild(newNode);
      return newNode;
    }
    const index = this.children.indexOf(referenceNode);
    if (index > -1) {
      this.children.splice(index, 0, newNode);
    } else {
      this.appendChild(newNode);
    }
    return newNode;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }

  compareDocumentPosition(other) {
    // A simplified mock implementation.
    // It doesn't accurately reflect the node positions but provides the necessary API.
    // DOCUMENT_POSITION_FOLLOWING = 4
    return 4;
  }
}

class Document {
  constructor() {
    this.body = new Element(this, 'body');
  }

  createElementNS(namespace, tagName) {
    return new Element(this, tagName);
  }

  createElement(tagName) {
    return new Element(this, tagName);
  }
}

class Body extends Element {
  constructor(ownerDocument) {
    super(ownerDocument, 'body');
  }
}