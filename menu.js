import { autoUpdate, computePosition, flip, offset, shift } from 'https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.7.1/+esm';

export class Menu {
  static menus = [];

  constructor(root, options, submenu = false, contextMenu = false) {
    this.rootElement = root;
    this.defaults = {
      selector: {
        trigger: '[data-menu-trigger]',
        list: '[role="menu"]',
        item: '[role^="menuitem"]',
      },
      animation: {
        duration: 300,
      },
      delay: 300,
      popover: {
        menu: {
          middleware: [flip(), offset(), shift()],
          placement: 'bottom-start',
        },
        submenu: {
          middleware: [flip(), offset(), shift()],
          placement: 'right-start',
        },
        transformOrigin: true,
      },
    };
    this.settings = {
      ...this.defaults,
      ...options,
      selector: {
        ...this.defaults.selector,
        ...options?.selector,
      },
      animation: {
        ...this.defaults.animation,
        ...options?.animation,
      },
      popover: {
        ...this.defaults.popover,
        ...options?.popover,
        menu: {
          ...this.defaults.popover.menu,
          ...options?.popover?.menu,
        },
        submenu: {
          ...this.defaults.popover.submenu,
          ...options?.popover?.submenu,
        },
      },
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings.animation.duration = 0;
    }
    this.isSubmenu = submenu;
    this.isContextMenu = contextMenu;
    this.triggerElement = this.rootElement.querySelector(this.settings.selector[!this.isSubmenu ? 'trigger' : 'item']);
    this.listElement = this.rootElement.querySelector(this.settings.selector.list);
    this.itemElements = [...this.listElement.querySelectorAll(`${this.settings.selector.item}:not(:scope ${this.settings.selector.list} *)`)];
    this.itemElementsByInitial = {};
    if (this.itemElements.length) {
      this.itemElements.forEach(item => {
        const initial = item.textContent.trim().charAt(0).toLowerCase();
        if (/\S/.test(initial)) {
          item.ariaKeyshortcuts = initial;
          (this.itemElementsByInitial[initial] ||= []).push(item);
        }
      });
    }
    this.checkboxItemElements = this.itemElements.filter(item => item.role === 'menuitemcheckbox');
    this.radioItemElements = this.itemElements.filter(item => item.role === 'menuitemradio');
    this.radioItemElementsByGroup = new Map();
    if (this.radioItemElements.length) {
      this.radioItemElements.forEach(item => {
        let group = item.closest('[role="group"]');
        if (!group || !this.rootElement.contains(group)) {
          group = this.rootElement;
        }
        (this.radioItemElementsByGroup.get(group) ?? this.radioItemElementsByGroup.set(group, []).get(group)).push(item);
      });
    }
    this.animation = null;
    this.submenus = [];
    this.submenuTimer = 0;
    if (!this.isContextMenu) {
      this.popoverReferenceElement = this.triggerElement;
    }
    this.cleanupPopover = null;
    this.handleOutsidePointerDown = this.handleOutsidePointerDown.bind(this);
    this.handleRootFocusOut = this.handleRootFocusOut.bind(this);
    this.handleTriggerClick = this.handleTriggerClick.bind(this);
    this.handleTriggerKeyDown = this.handleTriggerKeyDown.bind(this);
    this.handleListKeyDown = this.handleListKeyDown.bind(this);
    this.handleItemPointerLeave = this.handleItemPointerLeave.bind(this);
    this.handleItemPointerOver = this.handleItemPointerOver.bind(this);
    this.handleCheckboxItemClick = this.handleCheckboxItemClick.bind(this);
    this.handleRadioItemClick = this.handleRadioItemClick.bind(this);
    this.initialize();
  }

  initialize() {
    if ((this.isContextMenu && !this.triggerElement) || !this.listElement || !this.itemElements.length) {
      return;
    }
    document.addEventListener('pointerdown', this.handleOutsidePointerDown);
    this.rootElement.addEventListener('focusout', this.handleRootFocusOut);
    if (!this.isContextMenu && this.triggerElement) {
      const id = Math.random().toString(36).slice(-8);
      this.triggerElement.setAttribute('aria-controls', (this.listElement.id ||= `menu-list-${id}`));
      this.triggerElement.ariaExpanded = 'false';
      this.triggerElement.ariaHasPopup = 'menu';
      this.triggerElement.id ||= `menu-trigger-${id}`;
      this.triggerElement.tabIndex = this.isFocusable(this.triggerElement) && !this.isSubmenu ? 0 : -1;
      if (!this.isFocusable(this.triggerElement)) {
        this.triggerElement.style.setProperty('pointer-events', 'none');
      }
      this.triggerElement.addEventListener('click', this.handleTriggerClick);
      this.triggerElement.addEventListener('keydown', this.handleTriggerKeyDown);
      this.listElement.setAttribute('aria-labelledby', `${this.listElement.getAttribute('aria-labelledby') || ''} ${this.triggerElement.id}`.trim());
    }
    this.listElement.addEventListener('keydown', this.handleListKeyDown);
    this.itemElements.forEach(item => {
      const root = item.parentElement;
      if (root.querySelector(this.settings.selector.list)) {
        this.submenus.push(new Menu(root, this.settings, true));
      }
      item.addEventListener('pointerleave', this.handleItemPointerLeave);
      item.addEventListener('pointerover', this.handleItemPointerOver);
    });
    if (this.checkboxItemElements.length) {
      this.checkboxItemElements.forEach(item => {
        item.addEventListener('click', this.handleCheckboxItemClick);
      });
    }
    if (this.radioItemElements.length) {
      this.radioItemElements.forEach(item => {
        item.addEventListener('click', this.handleRadioItemClick);
      });
    }
    this.resetTabIndex();
    if (this.isSubmenu) {
      return;
    }
    Menu.menus.push(this);
    this.rootElement.setAttribute('data-menu-initialized', '');
  }

  isFocusable(element) {
    return element.ariaDisabled !== 'true' && !element.hasAttribute('disabled');
  }

  resetTabIndex() {
    const focusable = this.itemElements.find(item => this.isFocusable(item));
    this.itemElements.forEach(item => (item.tabIndex = item === focusable ? 0 : -1));
  }

  toggle(open) {
    if ((open && ((!this.isContextMenu && (!this.triggerElement || this.triggerElement.ariaExpanded === 'true')) || (this.isContextMenu && this.listElement.hasAttribute('data-context-menu-open')))) || (!open && ((!this.isContextMenu && (!this.triggerElement || this.triggerElement.ariaExpanded === 'false')) || (this.isContextMenu && !this.listElement.hasAttribute('data-context-menu-open'))))) {
      return;
    }
    if (this.triggerElement) {
      window.requestAnimationFrame(() => {
        if (!this.isContextMenu) {
          this.triggerElement.ariaExpanded = String(open);
        } else {
          if (open) {
            this.listElement.setAttribute('data-context-menu-open', '');
          } else {
            this.listElement.removeAttribute('data-context-menu-open');
          }
        }
      });
    }
    if (open) {
      Object.assign(this.listElement.style, {
        display: 'block',
        opacity: '0',
      });
      if (this.triggerElement) {
        this.updatePopover();
      }
      Menu.menus
        .filter(menu => !menu.rootElement.contains(this.rootElement))
        .forEach(menu => {
          menu.close();
        });
      const focusables = this.itemElements.filter(this.isFocusable);
      if (focusables.length) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            focusables[0].focus();
          });
        });
      }
    } else {
      if (this.submenus.length) {
        window.clearTimeout(this.submenuTimer);
        this.submenus.forEach(submenu => {
          submenu.close();
        });
      }
      if (this.triggerElement && this.rootElement.contains(document.activeElement)) {
        this.triggerElement.focus();
      }
    }
    const opacity = window.getComputedStyle(this.listElement).getPropertyValue('opacity');
    if (this.animation) {
      this.animation.cancel();
    }
    this.animation = this.listElement.animate(
      {
        opacity: open ? [opacity, '1'] : [opacity, '0'],
      },
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
        if (this.settings.popover.transformOrigin) {
          this.listElement.style.removeProperty('transform-origin');
        }
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
      computePosition(this.popoverReferenceElement, this.listElement, this.settings.popover[!this.isSubmenu ? 'menu' : 'submenu']).then(({ x, y, placement }) => {
        Object.assign(this.listElement.style, {
          left: `${x}px`,
          top: `${y}px`,
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
      });
    };
    compute();
    if (!this.cleanupPopover) {
      this.cleanupPopover = autoUpdate(this.popoverReferenceElement, this.listElement, compute);
    }
  }

  handleOutsidePointerDown(event) {
    if (this[!this.isContextMenu ? 'rootElement' : 'listElement'].contains(event.target) || !this.triggerElement) {
      return;
    }
    this.close();
  }

  handleRootFocusOut(event) {
    if (!event.relatedTarget || this.rootElement.contains(event.relatedTarget) || (!this.isContextMenu && !!this.triggerElement && this.triggerElement.ariaExpanded === 'false') || (!this.isContextMenu && this.listElement.hasAttribute('data-context-menu-open'))) {
      return;
    }
    this.resetTabIndex();
    if (this.triggerElement) {
      this.close();
    }
  }

  handleTriggerClick(event) {
    event.preventDefault();
    if (!this.isSubmenu) {
      const open = this.triggerElement.ariaExpanded === 'true' || this.listElement.hasAttribute('data-context-menu-open');
      if (!this.isSubmenu || event.pointerType !== 'mouse') {
        this.toggle(!open);
      }
      return;
    }
    this.toggle(this.triggerElement === event.currentTarget);
  }

  handleTriggerKeyDown(event) {
    const { key } = event;
    if (!['Enter', 'Escape', ' ', ...(!this.isSubmenu ? ['ArrowUp', 'ArrowDown'] : ['ArrowRight'])].includes(key)) {
      return;
    }
    event.preventDefault();
    if (['Escape'].includes(key)) {
      this.close();
      return;
    }
    this.open();
    const focusables = this.itemElements.filter(this.isFocusable);
    const length = focusables.length;
    if (!length) {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusables[this.isContextMenu || key !== 'ArrowUp' ? 0 : length - 1].focus();
      });
    });
  }

  handleListKeyDown(event) {
    const { shiftKey, key } = event;
    if (!this.triggerElement && shiftKey && key === 'Tab') {
      return;
    }
    const keys = ['Tab', 'Enter', 'Escape', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'];
    if (this.isSubmenu) {
      keys.push('ArrowLeft');
    }
    if (!keys.includes(key) && !(shiftKey && key === 'Tab') && !(/^\S$/i.test(key) && this.itemElementsByInitial[key.toLowerCase()]?.filter(this.isFocusable).length)) {
      return;
    }
    if (!shiftKey) {
      if (key === 'Tab') {
        return;
      }
      event.stopPropagation();
    }
    event.preventDefault();
    const current = document.activeElement;
    if (['Enter', ' '].includes(key)) {
      current.click();
      return;
    }
    if (['Tab', 'Escape', 'ArrowLeft'].includes(key)) {
      this.close();
      return;
    }
    const focusables = this.itemElements.filter(this.isFocusable);
    const currentIndex = focusables.indexOf(current);
    focusables[currentIndex].tabIndex = -1;
    let targetFocusables;
    let newIndex;
    if (['End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) {
      targetFocusables = focusables;
      const length = focusables.length;
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
    } else {
      targetFocusables = this.itemElementsByInitial[key.toLowerCase()].filter(this.isFocusable);
      const foundIndex = targetFocusables.findIndex(focusable => focusables.indexOf(focusable) > currentIndex);
      newIndex = foundIndex !== -1 ? foundIndex : 0;
    }
    const focusable = targetFocusables[newIndex];
    focusable.tabIndex = 0;
    focusable.focus();
  }

  handleItemPointerLeave() {
    window.clearTimeout(this.submenuTimer);
  }

  handleItemPointerOver(event) {
    window.clearTimeout(this.submenuTimer);
    const focusables = this.itemElements.filter(this.isFocusable);
    if (!focusables.length) {
      return;
    }
    const target = event.currentTarget;
    focusables.forEach(focusable => {
      focusable.tabIndex = focusable === target ? 0 : -1;
    });
    this.submenuTimer = window.setTimeout(() => {
      if (this.submenus.length) {
        this.submenus.forEach(submenu => {
          if (submenu.triggerElement === target) {
            submenu.open();
          } else {
            submenu.close();
          }
        });
      }
      target.focus();
    }, this.settings.delay);
  }

  handleCheckboxItemClick(event) {
    const item = event.currentTarget;
    item.ariaChecked = String(item.ariaChecked === 'false');
  }

  handleRadioItemClick(event) {
    const target = event.currentTarget;
    this.radioItemElementsByGroup.get(target.closest('[role="group"]') || this.rootElement).forEach(item => {
      item.ariaChecked = String(item === target);
    });
  }

  open() {
    this.toggle(true);
  }

  close() {
    this.toggle(false);
  }
}

export class ContextMenu extends Menu {
  constructor(root, options) {
    super(root, options, false, true);
    this.longPressTimer = 0;
    this.handleTriggerContextMenu = this.handleTriggerContextMenu.bind(this);
    this.handleTriggerLongPressCancel = this.handleTriggerLongPressCancel.bind(this);
    this.handleTriggerPointerDown = this.handleTriggerPointerDown.bind(this);
    this.triggerElement.addEventListener('pointerdown', this.handleTriggerPointerDown);
    ['pointercancel', 'pointerleave', 'pointerup'].forEach(name => {
      this.triggerElement.addEventListener(name, this.handleTriggerLongPressCancel);
    });
    this.triggerElement.addEventListener('contextmenu', this.handleTriggerContextMenu);
  }

  handleTriggerContextMenu(event) {
    event.preventDefault();
    if (this.listElement.hasAttribute('data-context-menu-open')) {
      return;
    }
    const { clientX: x, clientY: y } = event;
    this.popoverReferenceElement = {
      getBoundingClientRect() {
        return new DOMRect(x, y, 0, 0);
      },
    };
    super.open();
  }

  handleTriggerLongPressCancel() {
    window.clearTimeout(this.longPressTimer);
  }

  handleTriggerPointerDown(event) {
    /*
    if (event.pointerType === 'mouse') {
      return;
    }
    */
    this.longPressTimer = window.setTimeout(() => {
      this.handleTriggerContextMenu(event);
    }, 500);
  }
}
