import { arrow, autoUpdate, computePosition, flip, offset, shift } from 'https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.7.4/+esm';

export default class Menu {
  static menus = [];

  constructor(root, options, submenu = false) {
    if (!root) return;
    this.rootElement = root;
    this.defaults = {
      animation: { duration: 300 },
      delay: 300,
      popover: {
        menu: {
          arrow: true,
          middleware: [flip(), offset(), shift()],
          placement: 'bottom-start',
        },
        submenu: {
          arrow: true,
          middleware: [flip(), offset(), shift()],
          placement: 'right-start',
        },
        transformOrigin: true,
      },
      selector: {
        checkboxItem: '[role="menuitemcheckbox"]',
        group: '[role="group"]',
        item: '[role^="menuitem"]',
        list: '[role="menu"]',
        radioItem: '[role="menuitemradio"]',
        trigger: '[data-menu-trigger]',
      },
    };
    this.settings = {
      ...this.defaults,
      ...options,
      animation: { ...this.defaults.animation, ...options?.animation },
      popover: {
        ...this.defaults.popover,
        ...options?.popover,
        menu: { ...this.defaults.popover.menu, ...options?.popover?.menu },
        submenu: { ...this.defaults.popover.submenu, ...options?.popover?.submenu },
      },
      selector: { ...this.defaults.selector, ...options?.selector },
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.settings.animation.duration = 0;
    this.isSubmenu = submenu;
    this.triggerElement = this.rootElement.querySelector(this.settings.selector[!this.isSubmenu ? 'trigger' : 'item']);
    this.listElement = this.rootElement.querySelector(this.settings.selector.list);
    this.itemElements = [...this.listElement.querySelectorAll(`${this.settings.selector.item}:not(:scope ${this.settings.selector.list} *)`)];
    this.itemElementsByInitial = {};
    this.itemElements.forEach(item => {
      const initial = item.textContent.trim().charAt(0).toLowerCase();
      if (/\S/.test(initial)) {
        item.setAttribute('aria-keyshortcuts', initial);
        (this.itemElementsByInitial[initial] ||= []).push(item);
      }
    });
    this.checkboxItemElements = this.itemElements.filter(item => item.getAttribute('role') === 'menuitemcheckbox');
    this.radioItemElements = this.itemElements.filter(item => item.getAttribute('role') === 'menuitemradio');
    this.radioItemElementsByGroup = new Map();
    this.radioItemElements.forEach(item => {
      let group = item.closest(this.settings.selector.group);
      if (!group || !this.rootElement.contains(group)) group = this.rootElement;
      (this.radioItemElementsByGroup.get(group) || this.radioItemElementsByGroup.set(group, []).get(group)).push(item);
    });
    const setting = this.settings.popover[!this.isSubmenu ? 'menu' : 'submenu'];
    if (setting.arrow) {
      this.arrowElement = document.createElement('div');
      this.arrowElement.setAttribute('data-menu-arrow', '');
      this.listElement.appendChild(this.arrowElement);
      setting.middleware.push(arrow({ element: this.arrowElement }));
    } else {
      this.arrowElement = null;
    }
    this.animation = null;
    this.submenus = [];
    this.submenuTimer = 0;
    this.eventController = new AbortController();
    this.destroyed = false;
    this.cleanupPopover = null;
    this.handleOutsidePointerDown = this.handleOutsidePointerDown.bind(this);
    this.handleRootFocusIn = this.handleRootFocusIn.bind(this);
    this.handleRootFocusOut = this.handleRootFocusOut.bind(this);
    this.handleTriggerClick = this.handleTriggerClick.bind(this);
    this.handleTriggerKeyDown = this.handleTriggerKeyDown.bind(this);
    this.handleListKeyDown = this.handleListKeyDown.bind(this);
    this.handleItemBlur = this.handleItemBlur.bind(this);
    this.handleItemFocus = this.handleItemFocus.bind(this);
    this.handleItemPointerEnter = this.handleItemPointerEnter.bind(this);
    this.handleItemPointerLeave = this.handleItemPointerLeave.bind(this);
    this.handleCheckboxItemClick = this.handleCheckboxItemClick.bind(this);
    this.handleRadioItemClick = this.handleRadioItemClick.bind(this);
    this.initialize();
  }

  initialize() {
    if (!this.listElement || !this.itemElements.length) return;
    const { signal } = this.eventController;
    document.addEventListener('pointerdown', this.handleOutsidePointerDown, { signal });
    this.rootElement.addEventListener('focusin', this.handleRootFocusIn, { signal });
    this.rootElement.addEventListener('focusout', this.handleRootFocusOut, { signal });
    if (this.triggerElement) {
      const id = Math.random().toString(36).slice(-8);
      this.triggerElement.setAttribute('aria-controls', (this.listElement.id ||= `menu-list-${id}`));
      this.triggerElement.setAttribute('aria-expanded', 'false');
      this.triggerElement.setAttribute('aria-haspopup', 'true');
      this.triggerElement.id ||= `menu-trigger-${id}`;
      this.triggerElement.setAttribute('tabindex', this.isFocusable(this.triggerElement) && !this.isSubmenu ? '0' : '-1');
      if (!this.isFocusable(this.triggerElement)) this.triggerElement.style.setProperty('pointer-events', 'none');
      this.triggerElement.addEventListener('click', this.handleTriggerClick, { signal });
      this.triggerElement.addEventListener('keydown', this.handleTriggerKeyDown, { signal });
      this.listElement.setAttribute('aria-labelledby', `${this.listElement.getAttribute('aria-labelledby') || ''} ${this.triggerElement.id}`.trim());
    }
    this.listElement.setAttribute('role', 'menu');
    this.listElement.addEventListener('keydown', this.handleListKeyDown, { signal });
    this.itemElements.forEach(item => {
      const parent = item.parentElement;
      if (parent.querySelector(this.settings.selector.list)) this.submenus.push(new Menu(parent, this.settings, true));
      if ([this.checkboxItemElements, this.radioItemElements].every(list => !list.includes(item))) item.setAttribute('role', 'menuitem');
      item.addEventListener('blur', this.handleItemBlur, { signal });
      item.addEventListener('focus', this.handleItemFocus, { signal });
      item.addEventListener('pointerenter', this.handleItemPointerEnter, { signal });
      item.addEventListener('pointerleave', this.handleItemPointerLeave, { signal });
    });
    this.checkboxItemElements.forEach(item => {
      item.setAttribute('role', 'menuitemcheckbox');
      item.addEventListener('click', this.handleCheckboxItemClick, { signal });
    });
    this.radioItemElements.forEach(item => {
      item.setAttribute('role', 'menuitemradio');
      item.addEventListener('click', this.handleRadioItemClick, { signal });
    });
    this.resetTabIndex();
    if (!this.isSubmenu) this.rootElement.setAttribute('data-menu-initialized', '');
    Menu.menus.push(this);
  }

  getActiveElement() {
    let active = document.activeElement;
    while (active && active.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  isFocusable(element) {
    return element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled');
  }

  resetTabIndex(force = false) {
    if (this.triggerElement || force) {
      this.itemElements.forEach(item => item.setAttribute('tabindex', '-1'));
    } else {
      const first = this.itemElements.find(item => this.isFocusable(item));
      this.itemElements.forEach(item => item.setAttribute('tabindex', item === first ? '0' : '-1'));
    }
  }

  toggle(open) {
    if (open.toString() === this.triggerElement?.getAttribute('aria-expanded')) return;
    if (this.triggerElement) window.requestAnimationFrame(() => this.triggerElement.setAttribute('aria-expanded', String(open)));
    if (open) {
      Menu.menus.filter(menu => !menu.rootElement.contains(this.rootElement)).forEach(menu => menu.close());
      Object.assign(this.listElement.style, {
        display: 'block',
        opacity: '0',
      });
      if (this.triggerElement) this.updatePopover();
      const focusable = this.itemElements.find(this.isFocusable);
      if (focusable) focusable.focus();
    } else {
      window.clearTimeout(this.submenuTimer);
      this.submenus.forEach(submenu => submenu.close());
      if (this.triggerElement && this.rootElement.contains(this.getActiveElement())) this.triggerElement.focus();
    }
    if (!this.triggerElement) return;
    const opacity = window.getComputedStyle(this.listElement).getPropertyValue('opacity');
    this.animation?.cancel();
    this.animation = this.listElement.animate(
      { opacity: open ? [opacity, '1'] : [opacity, '0'] },
      {
        duration: this.settings.animation.duration,
        easing: 'ease',
      },
    );
    this.animation.addEventListener('finish', () => {
      this.animation = null;
      if (!open) {
        this.listElement.removeAttribute('data-menu-placement');
        this.listElement.style.setProperty('display', 'none');
        ['left', 'top', 'transform-origin'].forEach(name => this.listElement.style.removeProperty(name));
        if (this.arrowElement) ['left', 'rotate', 'top'].forEach(name => this.arrowElement.style.removeProperty(name));
      }
      this.listElement.style.removeProperty('opacity');
    });
    if (!open && this.cleanupPopover) {
      this.cleanupPopover();
      this.cleanupPopover = null;
    }
  }

  updatePopover() {
    const compute = () => {
      computePosition(this.triggerElement, this.listElement, this.settings.popover[!this.isSubmenu ? 'menu' : 'submenu']).then(({ x: listX, y: listY, placement, middlewareData }) => {
        Object.assign(this.listElement.style, {
          left: `${listX}px`,
          top: `${listY}px`,
        });
        this.listElement.setAttribute('data-menu-placement', placement);
        if (this.settings.popover.transformOrigin) {
          this.listElement.style.setProperty(
            'transform-origin',
            {
              top: '50% 100%',
              'top-start': '0 100%',
              'top-end': '100% 100%',
              right: '0 50%',
              'right-start': '0 0',
              'right-end': '0 100%',
              bottom: '50% 0',
              'bottom-start': '0 0',
              'bottom-end': '100% 0',
              left: '100% 50%',
              'left-start': '100% 0',
              'left-end': '100% 100%',
            }[placement],
          );
        }
        if (!this.arrowElement) return;
        const { x: arrowX, y: arrowY } = middlewareData.arrow;
        const side = placement.split('-')[0];
        Object.assign(this.arrowElement.style, {
          left: arrowX ? `${arrowX}px` : '',
          rotate: `${side === 'top' ? 225 : side === 'right' ? 315 : side === 'bottom' ? 45 : 135}deg`,
          top: arrowY ? `${arrowY - this.arrowElement.offsetHeight / 2}px` : '',
          [{
            top: 'bottom',
            right: 'left',
            bottom: 'top',
            left: 'right',
          }[side]]: `${this.arrowElement.offsetWidth / -2}px`,
        });
      });
    };
    compute();
    if (!this.cleanupPopover) this.cleanupPopover = autoUpdate(this.triggerElement, this.listElement, compute);
  }

  handleOutsidePointerDown(event) {
    if (event.composedPath().includes(this.rootElement) || !this.triggerElement) return;
    this.resetTabIndex();
    this.close();
  }

  handleRootFocusIn(event) {
    if (this.rootElement.contains(event.relatedTarget) && this.rootElement.contains(this.getActiveElement())) return;
    this.resetTabIndex(true);
  }

  handleRootFocusOut(event) {
    if (this.rootElement.contains(event.relatedTarget)) return;
    this.resetTabIndex();
    this.close();
  }

  handleTriggerClick(event) {
    event.preventDefault();
    if (!this.isSubmenu) {
      const open = this.triggerElement.getAttribute('aria-expanded') === 'true';
      if (!this.isSubmenu || (event instanceof PointerEvent && event.pointerType !== 'mouse')) this.toggle(!open);
    } else {
      this.toggle(this.triggerElement === event.currentTarget);
    }
  }

  handleTriggerKeyDown(event) {
    const { key } = event;
    if (!['Enter', ' ', ...(!this.isSubmenu ? ['ArrowUp', 'ArrowDown'] : ['ArrowRight'])].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.open();
    const focusables = this.itemElements.filter(this.isFocusable);
    const length = focusables.length;
    if (!length) return;
    let index = 0;
    switch (key) {
      case 'Enter':
      case ' ':
        this.triggerElement.click();
        return;
      case 'ArrowUp':
        index = length - 1;
        break;
      case 'ArrowRight':
        return;
      case 'ArrowDown':
        index = 0;
        break;
    }
    focusables[index].focus();
  }

  handleListKeyDown(event) {
    const { shiftKey, key } = event;
    if (!this.triggerElement && shiftKey && key === 'Tab') return;
    const keys = new Set(['Tab', 'Enter', 'Escape', ' ', 'End', 'Home', ...(this.isSubmenu ? ['ArrowLeft'] : []), 'ArrowUp', 'ArrowDown']);
    const isCharKey = /^\S$/i.test(key);
    if ((!keys.has(key) && !isCharKey) || (isCharKey && !this.itemElementsByInitial[key.toLowerCase()]?.some(this.isFocusable))) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!shiftKey && key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    const focusables = this.itemElements.filter(this.isFocusable);
    const length = focusables.length;
    const active = this.getActiveElement();
    const currentIndex = focusables.indexOf(active);
    let newIndex = currentIndex;
    let targetFocusables = focusables;
    switch (key) {
      case 'Tab':
      case 'Escape':
      case 'ArrowLeft':
        this.close();
        return;
      case 'Enter':
      case ' ':
        active.click();
        return;
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
      default:
        targetFocusables = this.itemElementsByInitial[key.toLowerCase()].filter(this.isFocusable);
        const foundIndex = targetFocusables.findIndex(focusable => focusables.indexOf(focusable) > currentIndex);
        newIndex = foundIndex !== -1 ? foundIndex : 0;
    }
    targetFocusables[newIndex].focus();
  }

  handleItemBlur(event) {
    event.currentTarget.setAttribute('tabindex', '-1');
  }

  handleItemFocus(event) {
    event.currentTarget.setAttribute('tabindex', '0');
  }

  handleItemPointerEnter(event) {
    window.clearTimeout(this.submenuTimer);
    const item = event.currentTarget;
    this.submenuTimer = window.setTimeout(() => {
      this.submenus.forEach(submenu => submenu.toggle(submenu.triggerElement === item));
      item.setAttribute('tabindex', '0');
      item.focus();
    }, this.settings.delay);
  }

  handleItemPointerLeave() {
    window.clearTimeout(this.submenuTimer);
  }

  handleCheckboxItemClick(event) {
    const item = event.currentTarget;
    item.setAttribute('aria-checked', String(item.getAttribute('aria-checked') === 'false'));
  }

  handleRadioItemClick(event) {
    const item = event.currentTarget;
    this.radioItemElementsByGroup.get(item.closest(this.settings.selector.group) || this.rootElement).forEach(_item => _item.setAttribute('aria-checked', String(_item === item)));
  }

  open() {
    this.toggle(true);
  }

  close() {
    this.toggle(false);
  }

  destroy() {
    if (this.destroyed) return;
    this.rootElement.removeAttribute('data-menu-initialized');
    this.submenus.forEach(submenu => {
      submenu.close();
      submenu.destroy();
    });
    this.submenus = [];
    this.close();
    this.eventController.abort();
    this.destroyed = true;
  }
}
