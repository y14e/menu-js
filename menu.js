import { arrow, autoUpdate, computePosition, flip, offset, shift } from 'https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.7.6/+esm';

export default class Menu {
  static menus = [];

  constructor(root, options = {}, submenu = false) {
    if (!root) {
      throw new Error('Root element missing.');
    }
    this.rootElement = root;
    this.defaults = {
      animation: { duration: 300 },
      delay: 200,
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
      animation: { ...this.defaults.animation, ...(options.animation ?? {}) },
      popover: {
        ...this.defaults.popover,
        ...(options.popover ?? {}),
        menu: { ...this.defaults.popover.menu, ...(options.popover?.menu ?? {}) },
        submenu: { ...this.defaults.popover.submenu, ...(options.popover?.submenu ?? {}) },
      },
      selector: { ...this.defaults.selector, ...(options.selector ?? {}) },
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings.animation.duration = 0;
    }
    this.isSubmenu = submenu;
    const { selector } = this.settings;
    this.triggerElement = this.rootElement.querySelector(selector[!this.isSubmenu ? 'trigger' : 'item']);
    const list = this.rootElement.querySelector(selector.list);
    if (!list) {
      throw new Error('List element missing.');
    }
    this.listElement = list;
    this.itemElements = this.listElement.querySelectorAll(`${selector.item}:not(:scope ${selector.list} *)`);
    if (this.itemElements.length === 0) {
      throw new Error('Item elements missing.');
    }
    this.itemElementsByFirstChar = {};
    for (const item of this.itemElements) {
      const shortcuts = item.getAttribute('aria-keyshortcuts');
      const keys = (shortcuts?.split(/\s+/) ?? [item.textContent.trim()[0]])
        .filter((key) => {
          return /^\S$/i.test(key);
        })
        .map((key) => {
          return key.toLowerCase();
        });
      for (const key of keys) {
        let items = this.itemElementsByFirstChar[key];
        if (!items) {
          items = this.itemElementsByFirstChar[key] = [];
        }
        items.push(item);
      }
      const first = keys[0];
      if (!shortcuts && first) {
        item.setAttribute('aria-keyshortcuts', first);
      }
    }
    this.checkboxItemElements = [];
    this.radioItemElements = [];
    for (const item of this.itemElements) {
      const role = item.getAttribute('role');
      if (role === 'menuitemcheckbox') {
        this.checkboxItemElements.push(item);
      } else if (role === 'menuitemradio') {
        this.radioItemElements.push(item);
      }
    }
    this.radioItemElementsByGroup = new Map();
    for (const item of this.radioItemElements) {
      let group = item.closest(selector.group);
      if (!group || !this.rootElement.contains(group)) {
        group = this.rootElement;
      }
      const items = this.radioItemElementsByGroup.get(group) ?? [];
      items.push(item);
      this.radioItemElementsByGroup.set(group, items);
    }
    const settings = this.settings.popover[!this.isSubmenu ? 'menu' : 'submenu'];
    if (settings.arrow) {
      this.arrowElement = document.createElement('div');
      this.arrowElement.setAttribute('data-menu-arrow', '');
      this.listElement.appendChild(this.arrowElement);
      settings.middleware.push(arrow({ element: this.arrowElement }));
    } else {
      this.arrowElement = null;
    }
    this.eventController = new AbortController();
    this.animation = null;
    this.submenus = [];
    this.destroyed = false;
    this.cleanupPopover = null;
    this.initialize();
  }

  open() {
    this.toggle(true);
  }

  close() {
    this.toggle(false);
  }

  async destroy(force = false) {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.clearSubmenuTimer();
    this.eventController.abort();
    this.cleanupPopover?.();
    this.cleanupPopover = null;
    Menu.menus = Menu.menus.filter((menu) => {
      return menu !== this;
    });
    this.rootElement.removeAttribute('data-menu-initialized');
    await Promise.all(
      this.submenus.map((submenu) => {
        return submenu.destroy();
      }),
    );
    if (!this.animation) {
      return;
    }
    if (!force) {
      try {
        await this.animation.finished;
      } catch {}
    }
    this.animation.cancel();
  }

  initialize() {
    const { signal } = this.eventController;
    document.addEventListener('pointerdown', this.handleOutsidePointerDown, { signal });
    this.rootElement.addEventListener('focusin', this.handleRootFocusIn, { signal });
    this.rootElement.addEventListener('focusout', this.handleRootFocusOut, { signal });
    if (this.triggerElement) {
      const id = Math.random().toString(36).slice(-8);
      this.listElement.id ||= `menu-list-${id}`;
      this.triggerElement.setAttribute('aria-controls', this.listElement.id);
      this.triggerElement.setAttribute('aria-expanded', 'false');
      this.triggerElement.setAttribute('aria-haspopup', 'true');
      this.triggerElement.id ||= `menu-trigger-${id}`;
      this.triggerElement.setAttribute('tabindex', this.isFocusable(this.triggerElement) && !this.isSubmenu ? '0' : '-1');
      if (!this.isFocusable(this.triggerElement)) {
        this.triggerElement.style.setProperty('pointer-events', 'none');
      }
      this.triggerElement.addEventListener('click', this.handleTriggerClick, { signal });
      this.triggerElement.addEventListener('keydown', this.handleTriggerKeyDown, { signal });
      this.listElement.setAttribute('aria-labelledby', `${this.listElement.getAttribute('aria-labelledby') ?? ''} ${this.triggerElement.id}`.trim());
    }
    this.listElement.setAttribute('role', 'menu');
    this.listElement.addEventListener('keydown', this.handleListKeyDown, { signal });
    for (const item of this.itemElements) {
      const parent = item.parentElement;
      if (!(parent instanceof HTMLElement)) {
        return;
      }
      if (parent.querySelector(this.settings.selector.list)) {
        this.submenus.push(new Menu(parent, this.settings, true));
      }
      if (
        [this.checkboxItemElements, this.radioItemElements].every((list) => {
          return !list.includes(item);
        })
      ) {
        item.setAttribute('role', 'menuitem');
      }
      item.addEventListener('blur', this.handleItemBlur, { signal });
      item.addEventListener('focus', this.handleItemFocus, { signal });
      item.addEventListener('pointerenter', this.handleItemPointerEnter, { signal });
      item.addEventListener('pointerleave', this.handleItemPointerLeave, { signal });
    }
    for (const item of this.checkboxItemElements) {
      item.setAttribute('role', 'menuitemcheckbox');
      item.addEventListener('click', this.handleCheckboxItemClick, { signal });
    }
    for (const item of this.radioItemElements) {
      item.setAttribute('role', 'menuitemradio');
      item.addEventListener('click', this.handleRadioItemClick, { signal });
    }
    this.resetTabIndex();
    if (!this.isSubmenu) {
      this.rootElement.setAttribute('data-menu-initialized', '');
    }
    Menu.menus.push(this);
  }

  handleOutsidePointerDown = (event) => {
    if (event.composedPath().includes(this.rootElement) || !this.triggerElement) {
      return;
    }
    this.resetTabIndex();
    this.close();
  };

  handleRootFocusIn = (event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && this.rootElement.contains(related) && this.rootElement.contains(this.getActiveElement())) {
      return;
    }
    this.resetTabIndex(true);
  };

  handleRootFocusOut = (event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && this.rootElement.contains(related)) {
      return;
    }
    this.resetTabIndex();
    this.close();
  };

  handleTriggerClick = (event) => {
    event.preventDefault();
    this.toggle(!this.isSubmenu ? this.triggerElement?.getAttribute('aria-expanded') !== 'true' : event.currentTarget === this.triggerElement);
  };

  handleTriggerKeyDown = (event) => {
    const { key } = event;
    if (!['Enter', ' ', ...(!this.isSubmenu ? ['ArrowUp', 'ArrowDown'] : ['ArrowRight'])].includes(key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.open();
    const focusables = [];
    for (const item of this.itemElements) {
      if (this.isFocusable(item)) {
        focusables.push(item);
      }
    }
    if (focusables.length === 0) {
      return;
    }
    let index = 0;
    switch (key) {
      case 'Enter':
      case ' ':
        this.triggerElement?.click();
        return;
      case 'ArrowUp':
        index = -1;
        break;
      case 'ArrowRight':
        return;
      case 'ArrowDown':
        index = 0;
        break;
    }
    focusables.at(index)?.focus();
  };

  handleListKeyDown = (event) => {
    const { shiftKey, key } = event;
    if (key === 'Tab' && ((!this.triggerElement && shiftKey) || !shiftKey)) {
      return;
    }
    if (!['Enter', 'Escape', ' ', 'End', 'Home', ...(this.isSubmenu ? ['ArrowLeft'] : []), 'ArrowUp', 'ArrowDown'].includes(key)) {
      const char = /^\S$/i.test(key);
      if (!char || !this.itemElementsByFirstChar[key.toLowerCase()]?.some(this.isFocusable)) {
        if (char) {
          event.stopPropagation();
        }
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    const focusables = [];
    for (const item of this.itemElements) {
      if (this.isFocusable(item)) {
        focusables.push(item);
      }
    }
    const active = this.getActiveElement();
    if (!active) {
      return;
    }
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
        newIndex = -1;
        break;
      case 'Home':
        newIndex = 0;
        break;
      case 'ArrowUp':
        newIndex = currentIndex - 1;
        break;
      case 'ArrowDown':
        newIndex = (currentIndex + 1) % focusables.length;
        break;
      default: {
        targetFocusables = this.itemElementsByFirstChar[key.toLowerCase()].filter(this.isFocusable);
        const foundIndex = targetFocusables.findIndex((focusable) => {
          return focusables.indexOf(focusable) > currentIndex;
        });
        newIndex = foundIndex !== -1 ? foundIndex : 0;
      }
    }
    targetFocusables.at(newIndex)?.focus();
  };

  handleItemBlur = (event) => {
    const item = event.currentTarget;
    if (!(item instanceof HTMLElement)) {
      return;
    }
    item.setAttribute('tabindex', '-1');
  };

  handleItemFocus = (event) => {
    const item = event.currentTarget;
    if (!(item instanceof HTMLElement)) {
      return;
    }
    item.setAttribute('tabindex', '0');
  };

  handleItemPointerEnter = (event) => {
    this.clearSubmenuTimer();
    const item = event.currentTarget;
    if (!(item instanceof HTMLElement)) {
      return;
    }
    this.submenuTimer = setTimeout(() => {
      for (const submenu of this.submenus) {
        submenu.toggle(submenu.triggerElement === item);
      }
      item.setAttribute('tabindex', '0');
      item.focus();
    }, this.settings.delay);
  };

  handleItemPointerLeave = () => {
    this.clearSubmenuTimer();
  };

  handleCheckboxItemClick = (event) => {
    const item = event.currentTarget;
    if (!(item instanceof HTMLElement)) {
      return;
    }
    item.setAttribute('aria-checked', String(item.getAttribute('aria-checked') === 'false'));
  };

  handleRadioItemClick = (event) => {
    const item = event.currentTarget;
    if (!(item instanceof HTMLElement)) {
      return;
    }
    const group = item.closest(this.settings.selector.group) ?? this.rootElement;
    if (!(group instanceof HTMLElement)) {
      return;
    }
    const items = this.radioItemElementsByGroup.get(group);
    if (!items) {
      return;
    }
    for (const i of items) {
      i.setAttribute('aria-checked', String(i === item));
    }
  };

  toggle(open) {
    if (String(open) === this.triggerElement?.getAttribute('aria-expanded')) {
      return;
    }
    if (this.triggerElement) {
      requestAnimationFrame(() => {
        this.triggerElement?.setAttribute('aria-expanded', String(open));
      });
    }
    if (open) {
      for (const menu of Menu.menus.filter((m) => {
        return !m.rootElement.contains(this.rootElement);
      })) {
        menu.close();
      }
      this.listElement.style.setProperty('display', 'block');
      this.listElement.style.setProperty('opacity', '0');
      if (this.triggerElement) {
        this.updatePopover();
      }
      for (const item of this.itemElements) {
        if (this.isFocusable(item)) {
          item.focus();
          break;
        }
      }
    } else {
      this.clearSubmenuTimer();
      for (const submenu of this.submenus) {
        submenu.close();
      }
      if (this.triggerElement && this.rootElement.contains(this.getActiveElement())) {
        this.triggerElement.focus();
      }
    }
    if (!this.triggerElement) {
      return;
    }
    if (!open) {
      this.cleanupPopover?.();
      this.cleanupPopover = null;
    }
    const opacity = getComputedStyle(this.listElement).getPropertyValue('opacity');
    this.animation?.cancel();
    this.animation = this.listElement.animate({ opacity: open ? [opacity, '1'] : [opacity, '0'] }, { duration: this.settings.animation.duration, easing: 'ease' });
    const cleanupAnimation = () => {
      this.animation = null;
    };
    this.animation.addEventListener('cancel', cleanupAnimation);
    this.animation.addEventListener('finish', () => {
      cleanupAnimation();
      if (!open) {
        this.listElement.removeAttribute('data-menu-placement');
        this.listElement.style.setProperty('display', 'none');
        this.listElement.style.removeProperty('left');
        this.listElement.style.removeProperty('top');
        this.listElement.style.removeProperty('transform-origin');
        if (this.arrowElement) {
          this.arrowElement.style.removeProperty('left');
          this.arrowElement.style.removeProperty('rotate');
          this.arrowElement.style.removeProperty('top');
        }
      }
      this.listElement.style.removeProperty('opacity');
    });
  }

  clearSubmenuTimer() {
    if (this.submenuTimer !== undefined) {
      clearTimeout(this.submenuTimer);
      this.submenuTimer = undefined;
    }
  }

  getActiveElement() {
    let active = document.activeElement;
    while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active instanceof HTMLElement ? active : null;
  }

  isFocusable(element) {
    return element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled');
  }

  resetTabIndex(force = false) {
    if (this.triggerElement || force) {
      for (const item of this.itemElements) {
        item.setAttribute('tabindex', '-1');
      }
    } else {
      let found = false;
      for (const item of this.itemElements) {
        if (!found && this.isFocusable(item)) {
          item.setAttribute('tabindex', '0');
          found = true;
        } else {
          item.setAttribute('tabindex', '-1');
        }
      }
    }
  }

  updatePopover() {
    if (!this.triggerElement) {
      return;
    }
    const compute = () => {
      computePosition(this.triggerElement, this.listElement, this.settings.popover[!this.isSubmenu ? 'menu' : 'submenu']).then(({ x: listX, y: listY, placement, middlewareData }) => {
        this.listElement.style.setProperty('left', `${listX}px`);
        this.listElement.style.setProperty('top', `${listY}px`);
        this.listElement.setAttribute('data-menu-placement', placement);
        if (this.settings.popover.transformOrigin) {
          this.listElement.style.setProperty(
            'transform-origin',
            { top: '50% 100%', 'top-start': '0 100%', 'top-end': '100% 100%', right: '0 50%', 'right-start': '0 0', 'right-end': '0 100%', bottom: '50% 0', 'bottom-start': '0 0', 'bottom-end': '100% 0', left: '100% 50%', 'left-start': '100% 0', 'left-end': '100% 100%' }[placement],
          );
        }
        if (!this.arrowElement) {
          return;
        }
        const data = middlewareData.arrow;
        if (!data) {
          return;
        }
        const { x: arrowX, y: arrowY } = data;
        this.arrowElement.style.setProperty('left', arrowX != null ? `${arrowX}px` : '');
        this.arrowElement.style.setProperty('top', arrowY != null ? `${arrowY - this.arrowElement.offsetHeight / 2}px` : '');
        const side = placement.split('-')[0];
        if (!side) {
          return;
        }
        const style = { top: { position: 'bottom', rotate: '225deg' }, right: { position: 'left', rotate: '315deg' }, bottom: { position: 'top', rotate: '45deg' }, left: { position: 'right', rotate: '135deg' } }[side];
        if (!style) {
          return;
        }
        this.arrowElement.style.setProperty(style.position, `${this.arrowElement.offsetWidth / -2}px`);
        this.arrowElement.style.setProperty('rotate', style.rotate);
      });
    };
    compute();
    if (!this.cleanupPopover) {
      this.cleanupPopover = autoUpdate(this.triggerElement, this.listElement, compute);
    }
  }
}
