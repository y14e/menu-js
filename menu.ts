import { Middleware, Placement, VirtualElement, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';

type MenuOptions = {
  selector: {
    trigger: string;
    list: string;
    item: string;
  };
  animation: {
    duration: number;
  };
  delay: number;
  popover: {
    menu: Partial<MenuPopoverOptions>;
    submenu: Partial<MenuPopoverOptions>;
    transformOrigin: boolean;
  };
};

type MenuPopoverOptions = {
  middleware: Middleware[];
  placement: Placement;
};

export class Menu {
  protected rootElement: HTMLElement;
  private defaults: MenuOptions;
  private settings: MenuOptions;
  private isSubmenu: boolean;
  private isContextMenu: boolean;
  protected triggerElement: HTMLElement;
  protected listElement: HTMLElement;
  private itemElements: HTMLElement[];
  private itemElementsByInitial!: Record<string, HTMLElement[]>;
  private checkboxItemElements!: HTMLElement[];
  private radioItemElements!: HTMLElement[];
  private radioItemElementsByGroup!: Map<HTMLElement, HTMLElement[]>;
  private animation!: Animation | null;
  private submenus!: Menu[];
  private submenuTimer!: number;
  private static menus: Menu[] = [];
  protected popoverReferenceElement!: Element | VirtualElement;
  private cleanupPopover!: Function | null;

  constructor(root: HTMLElement, options?: Partial<MenuOptions>, isSubmenu = false, isContextMenu = false) {
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
    this.isSubmenu = isSubmenu;
    this.isContextMenu = isContextMenu;
    this.triggerElement = this.rootElement.querySelector(this.settings.selector[!this.isSubmenu ? 'trigger' : 'item']) as HTMLElement;
    this.listElement = this.rootElement.querySelector(this.settings.selector.list) as HTMLElement;
    this.itemElements = [...this.listElement.querySelectorAll(`${this.settings.selector.item}:not(:scope ${this.settings.selector.list} *)`)] as HTMLElement[];
    if ((this.isContextMenu && !this.triggerElement) || !this.listElement || !this.itemElements.length) {
      return;
    }
    this.itemElementsByInitial = {};
    this.itemElements.forEach(item => {
      const initial = item.textContent!.trim().charAt(0).toLowerCase();
      if (/\S/.test(initial)) {
        item.setAttribute('aria-keyshortcuts', initial);
        (this.itemElementsByInitial[initial] ||= []).push(item);
      }
    });
    this.checkboxItemElements = this.itemElements.filter(item => item.getAttribute('role') === 'menuitemcheckbox');
    this.radioItemElements = this.itemElements.filter(item => item.getAttribute('role') === 'menuitemradio');
    this.radioItemElementsByGroup = new Map();
    if (this.radioItemElements.length) {
      this.radioItemElements.forEach(item => {
        let group = item.closest('[role="group"]') as HTMLElement;
        if (!group || !this.rootElement.contains(group)) {
          group = this.rootElement;
        }
        (this.radioItemElementsByGroup.get(group) ?? this.radioItemElementsByGroup.set(group, []).get(group))!.push(item);
      });
    }
    this.animation = null;
    this.submenus = [];
    this.submenuTimer = 0;
    if (!this.isContextMenu) {
      this.popoverReferenceElement = this.triggerElement;
    }
    this.cleanupPopover = null;
    document.addEventListener('pointerdown', this.handleOutsidePointerDown.bind(this));
    this.rootElement.addEventListener('focusout', this.handleRootFocusOut.bind(this));
    if (this.triggerElement) {
      this.triggerElement.setAttribute('tabindex', this.isFocusable(this.triggerElement) && !this.isSubmenu ? '0' : '-1');
      this.triggerElement.addEventListener('keydown', this.handleTriggerKeyDown.bind(this));
      if (!this.isContextMenu) {
        const id = Math.random().toString(36).slice(-8);
        this.triggerElement.setAttribute('aria-controls', (this.listElement.id ||= `menu-list-${id}`));
        this.triggerElement.setAttribute('aria-expanded', 'false');
        this.triggerElement.setAttribute('aria-haspopup', 'menu');
        this.triggerElement.setAttribute('id', this.triggerElement.getAttribute('id') || `menu-trigger-${id}`);
        if (!this.isFocusable(this.triggerElement)) {
          this.triggerElement.style.setProperty('pointer-events', 'none');
        }
        this.triggerElement.addEventListener('click', this.handleTriggerClick.bind(this));
        this.listElement.setAttribute('aria-labelledby', `${this.listElement.getAttribute('aria-labelledby') || ''} ${this.triggerElement.getAttribute('id')}`.trim());
      }
    }
    this.itemElements.forEach(item => {
      item.addEventListener('keydown', this.handleItemKeyDown.bind(this));
      const root = item.parentElement as HTMLElement;
      if (!root.querySelector(this.settings.selector.list)) {
        return;
      }
      this.submenus.push(new Menu(root, this.settings, true));
      item.addEventListener('pointerover', this.handleItemPointerOver.bind(this));
    });
    if (this.checkboxItemElements.length) {
      this.checkboxItemElements.forEach(item => {
        item.addEventListener('click', this.handleCheckboxItemClick.bind(this));
      });
    }
    if (this.radioItemElements.length) {
      this.radioItemElements.forEach(item => {
        item.addEventListener('click', this.handleRadioItemClick.bind(this));
      });
    }
    if (this.submenus.length) {
      this.submenus.forEach(submenu => {
        if (!this.isFocusable(submenu.triggerElement)) {
          return;
        }
        submenu.rootElement.addEventListener('pointerover', this.handleSubmenuPointerOver.bind(this));
        submenu.rootElement.addEventListener('pointerleave', this.handleSubmenuPointerLeave.bind(this));
        submenu.rootElement.addEventListener('click', this.handleSubmenuClick.bind(this));
      });
    }
    this.resetTabIndex();
    if (!this.isSubmenu) {
      Menu.menus.push(this);
      this.rootElement.setAttribute('data-menu-initialized', '');
    }
  }

  private isFocusable(element: HTMLElement): boolean {
    return element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled');
  }

  private resetTabIndex(): void {
    this.itemElements.forEach(item => {
      item.removeAttribute('tabindex');
    });
    this.itemElements.forEach(item => {
      item.setAttribute('tabindex', this.isFocusable(item) && this.itemElements.filter(this.isFocusable).findIndex(item => item.getAttribute('tabindex') === '0') === -1 ? '0' : '-1');
    });
  }

  private toggle(isOpen: boolean, isShiftF10 = false): void {
    if (this.triggerElement) {
      window.requestAnimationFrame(() => {
        if (!this.isContextMenu) {
          this.triggerElement.setAttribute('aria-expanded', String(isOpen));
        } else {
          if (isOpen) {
            this.listElement.setAttribute('data-context-menu-open', '');
          } else {
            this.listElement.removeAttribute('data-context-menu-open');
          }
        }
      });
    }
    if (isOpen) {
      Object.assign(this.listElement.style, {
        display: 'block',
        opacity: '0',
      });
      if (this.triggerElement) {
        if (this.isContextMenu && isShiftF10) {
          const { x, y } = this.triggerElement.getBoundingClientRect();
          this.popoverReferenceElement = {
            getBoundingClientRect() {
              return new DOMRect(x, y, 0, 0);
            },
          };
        }
        this.updatePopover();
      }
      if (this.submenus.length) {
        window.clearTimeout(this.submenuTimer);
        this.submenus.forEach(submenu => {
          submenu.close();
        });
      }
      Menu.menus
        .filter(menu => !menu.rootElement.contains(this.rootElement))
        .forEach(menu => {
          menu.close();
        });
    } else if (this.triggerElement && this.rootElement.contains(document.activeElement)) {
      this.triggerElement.focus();
    }
    const opacity = window.getComputedStyle(this.listElement).getPropertyValue('opacity');
    if (this.animation) {
      this.animation.cancel();
    }
    this.animation = this.listElement.animate(
      {
        opacity: isOpen ? [opacity, '1'] : [opacity, '0'],
      },
      {
        duration: this.settings.animation.duration,
        easing: 'ease',
      },
    );
    this.animation.addEventListener('finish', () => {
      this.animation = null;
      if (!isOpen) {
        this.listElement.removeAttribute('data-menu-placement');
        this.listElement.style.setProperty('display', 'none');
        if (this.settings.popover.transformOrigin) {
          this.listElement.style.removeProperty('transform-origin');
        }
      }
      this.listElement.style.removeProperty('opacity');
    });
    if (!isOpen && this.cleanupPopover) {
      this.cleanupPopover();
      this.cleanupPopover = null;
    }
  }

  private updatePopover(): void {
    const compute = () => {
      computePosition(this.popoverReferenceElement, this.listElement, this.settings.popover[!this.isSubmenu ? 'menu' : 'submenu']).then(({ x, y, placement }: { x: number; y: number; placement: Placement }) => {
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
      this.cleanupPopover = autoUpdate(this.triggerElement, this.listElement, compute);
    }
  }

  private handleOutsidePointerDown(event: PointerEvent): void {
    if (this[!this.isContextMenu ? 'rootElement' : 'listElement'].contains(event.target as HTMLElement) || !this.triggerElement) {
      return;
    }
    this.close();
  }

  private handleRootFocusOut(event: FocusEvent): void {
    if (!event.relatedTarget || this.rootElement.contains(event.relatedTarget as HTMLElement) || (!this.isContextMenu && this.triggerElement?.getAttribute('aria-expanded') !== 'true') || (!this.isContextMenu && this.listElement.hasAttribute('data-context-menu-open'))) {
      return;
    }
    if (this.triggerElement) {
      this.close();
    } else {
      this.resetTabIndex();
    }
  }

  private handleTriggerClick(event: MouseEvent): void {
    event.preventDefault();
    const isOpen = this.triggerElement.getAttribute('aria-expanded') === 'true' || this.listElement.hasAttribute('data-context-menu-open');
    if (!this.isSubmenu || (event instanceof PointerEvent && event.pointerType !== 'mouse')) {
      this.toggle(!isOpen);
    }
    const focusables = this.itemElements.filter(this.isFocusable);
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

  private handleTriggerKeyDown(event: KeyboardEvent): void {
    const { shiftKey, key } = event;

    const keys = ['Escape'];
    if (this.isSubmenu) {
      keys.push('ArrowRight');
    }
    keys.push(...(!this.isContextMenu ? ['Enter', ' ', 'ArrowUp', 'ArrowDown'] : ['F10']));
    if (!keys.includes(key)) {
      return;
    }
    event.preventDefault();
    if (!['Escape'].includes(key)) {
      if (this.isSubmenu && key !== 'ArrowRight') {
        return;
      }
      if (this.isContextMenu && (!shiftKey || key !== 'F10')) {
        return;
      }
      this.open(true);
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
      return;
    }
    this.close();
  }

  private handleItemPointerOver(event: PointerEvent): void {
    if (this.rootElement.querySelector(':focus-visible')) {
      (event.currentTarget as HTMLElement).focus();
    }
  }

  private handleItemKeyDown(event: KeyboardEvent): void {
    const { key, shiftKey } = event;
    if (!this.triggerElement && shiftKey && key === 'Tab') {
      return;
    }
    const keys = ['Enter', 'Escape', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'];
    if (this.isSubmenu) {
      keys.push('ArrowLeft');
    }
    if (!keys.includes(key) && (!shiftKey || key !== 'Tab') && (!/^\S$/i.test(key) || !this.itemElementsByInitial[key.toLowerCase()]?.filter(this.isFocusable).length)) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    const current = document.activeElement as HTMLElement;
    if (['Enter', ' '].includes(key)) {
      current.click();
      return;
    }
    if (['Tab', 'Escape'].includes(key) || (this.isSubmenu && key === 'ArrowLeft')) {
      this.close();
      return;
    }
    const focusables = this.itemElements.filter(this.isFocusable);
    if (['End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) {
      const currentIndex = focusables.indexOf(current);
      const length = focusables.length;
      let newIndex: number;
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
      if (!this.triggerElement) {
        focusables[currentIndex].setAttribute('tabindex', '-1');
        focusables[newIndex!].setAttribute('tabindex', '0');
      }
      focusables[newIndex!].focus();
      return;
    }
    const focusablesByInitial = this.itemElementsByInitial[key.toLowerCase()].filter(this.isFocusable);
    const index = focusablesByInitial.findIndex(focusable => focusables.indexOf(focusable) > focusables.indexOf(current));
    focusablesByInitial[index !== -1 ? index : 0].focus();
  }

  private handleCheckboxItemClick(event: MouseEvent): void {
    const item = event.currentTarget as HTMLElement;
    item.setAttribute('aria-checked', String(item.getAttribute('aria-checked') !== 'true'));
  }

  private handleRadioItemClick(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    this.radioItemElementsByGroup.get(target.closest('[role="group"]') || this.rootElement)!.forEach(item => {
      item.setAttribute('aria-checked', String(item === target));
    });
  }

  private handleSubmenuPointerOver(event: PointerEvent): void {
    window.clearTimeout(this.submenuTimer);
    const target = event.currentTarget;
    this.submenuTimer = window.setTimeout(() => {
      this.submenus.forEach(submenu => {
        if (submenu.rootElement === target) {
          submenu.open();
        } else {
          submenu.close();
        }
      });
    }, this.settings.delay);
  }

  private handleSubmenuPointerLeave(event: PointerEvent): void {
    window.clearTimeout(this.submenuTimer);
    if (!this.rootElement.contains(event.relatedTarget as HTMLElement)) {
      return;
    }
    this.submenuTimer = window.setTimeout(() => {
      this.submenus.forEach(submenu => {
        submenu.close();
      });
    }, this.settings.delay);
  }

  private handleSubmenuClick(event: MouseEvent): void {
    this.submenus.forEach(submenu => {
      if (submenu.rootElement === (event.currentTarget as HTMLElement)) {
        submenu.open();
      } else {
        submenu.close();
      }
    });
  }

  open(isShiftF10 = false): void {
    if ((!this.isContextMenu && (!this.triggerElement || this.triggerElement.getAttribute('aria-expanded') === 'true')) || (this.isContextMenu && this.listElement.hasAttribute('data-context-menu-open'))) {
      return;
    }
    this.toggle(true, isShiftF10);
  }

  close(): void {
    if ((!this.isContextMenu && (!this.triggerElement || this.triggerElement.getAttribute('aria-expanded') !== 'true')) || (this.isContextMenu && !this.listElement.hasAttribute('data-context-menu-open'))) {
      return;
    }
    this.toggle(false);
  }
}

export class ContextMenu extends Menu {
  private longPressTimer: number;

  constructor(root: HTMLElement, options?: Partial<MenuOptions>) {
    super(root, options, false, true);
    this.longPressTimer = 0;
    this.triggerElement.addEventListener('pointerdown', this.handleTriggerPointerDown.bind(this));
    ['pointercancel', 'pointerleave', 'pointerup'].forEach(name => {
      this.triggerElement.addEventListener(name, this.handleTriggerLongPressCancel.bind(this));
    });
    this.triggerElement.addEventListener('contextmenu', this.handleTriggerContextMenu.bind(this));
  }

  handleTriggerPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse') {
      return;
    }
    this.longPressTimer = window.setTimeout(() => {
      this.handleTriggerContextMenu(event);
    }, 500);
  }

  handleTriggerLongPressCancel() {
    window.clearTimeout(this.longPressTimer);
  }

  handleTriggerContextMenu(event: MouseEvent) {
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
}
