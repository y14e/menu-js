export class Menu {
  static hasOpen = {};

  constructor(root, options) {
    this.rootElement = root;
    if (this.rootElement.hasAttribute('data-menu-name')) {
      this.name = this.rootElement.getAttribute('data-menu-name') || '';
    }
    this.defaults = {
      selector: {
        button: '[data-menu-button]',
        list: '[role="menu"]',
        item: '[role="menuitem"]',
      },
      animation: {
        duration: 300,
      },
    };
    this.settings = {
      selector: { ...this.defaults.selector, ...options?.selector },
      animation: { ...this.defaults.animation, ...options?.animation },
    };
    this.buttonElement = this.rootElement.querySelector(this.settings.selector.button);
    this.listElement = this.rootElement.querySelector(this.settings.selector.list);
    this.itemElements = this.rootElement.querySelectorAll(this.settings.selector.item);
    if (!this.listElement || !this.itemElements.length) {
      return;
    }
    this.itemElementsByInitial = {};
    this.animation = null;
    this.handleOutsidePointerDown = this.handleOutsidePointerDown.bind(this);
    this.handleRootFocusOut = this.handleRootFocusOut.bind(this);
    this.handleButtonPointerOver = this.handleButtonPointerOver.bind(this);
    this.handleButtonClick = this.handleButtonClick.bind(this);
    this.handleButtonKeyDown = this.handleButtonKeyDown.bind(this);
    this.handleListKeyDown = this.handleListKeyDown.bind(this);
    if (this.name && this.isFocusable(this.buttonElement)) {
      Menu.hasOpen[this.name] ||= false;
    }
    this.initialize();
  }

  initialize() {
    document.addEventListener('pointerdown', this.handleOutsidePointerDown);
    this.rootElement.addEventListener('focusout', this.handleRootFocusOut);
    if (this.buttonElement) {
      const id = Math.random().toString(36).slice(-8);
      this.buttonElement.setAttribute('aria-controls', (this.listElement.id ||= `menu-list-${id}`));
      this.buttonElement.setAttribute('aria-expanded', 'false');
      this.buttonElement.setAttribute('aria-haspopup', 'menu');
      this.buttonElement.setAttribute('id', this.buttonElement.getAttribute('id') || `menu-button-${id}`);
      this.buttonElement.setAttribute('tabindex', this.isFocusable(this.buttonElement) ? '0' : '-1');
      if (!this.isFocusable(this.buttonElement)) {
        this.buttonElement.style.setProperty('pointer-events', 'none');
      }
      this.buttonElement.addEventListener('pointerover', this.handleButtonPointerOver);
      this.buttonElement.addEventListener('click', this.handleButtonClick);
      this.buttonElement.addEventListener('keydown', this.handleButtonKeyDown);
      this.listElement.setAttribute('aria-labelledby', `${this.listElement.getAttribute('aria-labelledby') || ''} ${this.buttonElement.getAttribute('id')}`.trim());
    }
    this.listElement.addEventListener('keydown', this.handleListKeyDown);
    this.itemElements.forEach(item => {
      const initial = item.textContent.trim().charAt(0).toLowerCase();
      if (/[a-z]/.test(initial)) {
        item.setAttribute('aria-keyshortcuts', initial);
        (this.itemElementsByInitial[initial] ||= []).push(item);
      }
    });
    this.resetTabIndex();
    this.rootElement.setAttribute('data-menu-initialized', '');
  }

  isFocusable(element) {
    return element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled');
  }

  resetTabIndex() {
    this.itemElements.forEach(item => {
      item.removeAttribute('tabindex');
    });
    this.itemElements.forEach(item => {
      item.setAttribute('tabindex', this.isFocusable(item) && [...this.itemElements].filter(this.isFocusable).findIndex(item => item.getAttribute('tabindex') === '0') === -1 ? '0' : '-1');
    });
  }

  toggle(isOpen) {
    if (this.name) {
      Menu.hasOpen[this.name] = isOpen;
    }
    window.requestAnimationFrame(() => {
      this.buttonElement.setAttribute('aria-expanded', String(isOpen));
    });
    if (isOpen) {
      Object.assign(this.listElement.style, {
        display: 'block',
        opacity: '0',
      });
    }
    const opacity = window.getComputedStyle(this.listElement).getPropertyValue('opacity');
    if (this.animation) {
      this.animation.cancel();
    }
    this.animation = this.listElement.animate({ opacity: isOpen ? [opacity, '1'] : [opacity, '0'] }, { duration: this.settings.animation.duration, easing: 'ease' });
    this.animation.addEventListener('finish', () => {
      this.animation = null;
      if (!isOpen) {
        this.listElement.style.setProperty('display', 'none');
      }
      this.listElement.style.removeProperty('opacity');
    });
  }

  handleOutsidePointerDown(event) {
    if (this.rootElement.contains(event.target) || !this.buttonElement) {
      return;
    }
    this.close();
  }

  handleRootFocusOut(event) {
    if (!event.relatedTarget || (this.buttonElement && this.buttonElement.getAttribute('aria-expanded') !== 'true')) {
      return;
    }
    if (!this.rootElement.contains(event.relatedTarget)) {
      if (this.buttonElement) {
        this.close();
      } else {
        this.resetTabIndex();
      }
    }
  }

  handleButtonPointerOver(event) {
    if (event.pointerType !== 'mouse' || !this.name || !Menu.hasOpen[this.name]) {
      return;
    }
    this.buttonElement.focus();
    this.open();
  }

  handleButtonClick(event) {
    event.preventDefault();
    const isOpen = this.buttonElement.getAttribute('aria-expanded') === 'true';
    this.toggle(!isOpen);
    const focusables = [...this.itemElements].filter(this.isFocusable);
    if (!focusables.length) {
      return;
    }
    if (!isOpen) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          focusables[0].focus();
        });
      });
    }
  }

  handleButtonKeyDown(event) {
    const { key } = event;
    if (!['Enter', 'Escape', ' ', 'ArrowUp', 'ArrowDown'].includes(key)) {
      return;
    }
    event.preventDefault();
    if (!['Escape'].includes(key)) {
      this.open();
      const focusables = [...this.itemElements].filter(this.isFocusable);
      if (!focusables.length) {
        return;
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          focusables[key !== 'ArrowUp' ? 0 : focusables.length - 1].focus();
        });
      });
      return;
    }
    this.close();
  }

  handleListKeyDown(event) {
    const { key, shiftKey } = event;
    if (!this.buttonElement && shiftKey && key === 'Tab') {
      return;
    }
    function isAlpha(value) {
      return /^[a-z]$/i.test(value);
    }
    if (!(['Enter', 'Escape', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key) || (shiftKey && key === 'Tab') || (isAlpha(key) && this.itemElementsByInitial[key.toLowerCase()]?.filter(this.isFocusable).length))) {
      return;
    }
    event.preventDefault();
    const active = document.activeElement;
    if (['Enter', ' '].includes(key)) {
      active.click();
      return;
    }
    if (['Tab', 'Escape'].includes(key)) {
      this.close();
      return;
    }
    const focusables = [...this.itemElements].filter(this.isFocusable);
    if (['End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) {
      const currentIndex = focusables.indexOf(active);
      const length = focusables.length;
      let newIndex;
      switch (key) {
        case 'End':
          newIndex = length - 1;
          break;
        case 'Home':
          newIndex = 0;
          break;
        case 'ArrowUp':
          newIndex = (currentIndex - 1 + length) % length;
          break;
        case 'ArrowDown':
          newIndex = (currentIndex + 1) % length;
          break;
      }
      if (!this.buttonElement) {
        focusables[currentIndex].setAttribute('tabindex', '-1');
        focusables[newIndex].setAttribute('tabindex', '0');
      }
      focusables[newIndex].focus();
      return;
    }
    const focusablesByInitial = this.itemElementsByInitial[key.toLowerCase()].filter(this.isFocusable);
    const index = focusablesByInitial.findIndex(item => focusables.indexOf(item) > focusables.indexOf(active));
    focusablesByInitial[index !== -1 ? index : 0].focus();
  }

  open() {
    if (!this.buttonElement || this.buttonElement.getAttribute('aria-expanded') === 'true') {
      return;
    }
    this.toggle(true);
  }

  close() {
    if (!this.buttonElement || this.buttonElement.getAttribute('aria-expanded') !== 'true') {
      return;
    }
    this.toggle(false);
    if (this.buttonElement && this.rootElement.contains(document.activeElement)) {
      this.buttonElement.focus();
    }
  }
}
